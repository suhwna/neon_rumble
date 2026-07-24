const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const root = path.join(__dirname, '..');
const port = 43000 + Math.floor(Math.random() * 1000);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-server-'));
let child;
const clients = [];

function ack(socket, event, payload) {
  return new Promise(resolve => payload === undefined ? socket.emit(event, resolve) : socket.emit(event, payload, resolve));
}

function once(socket, event, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeout);
    socket.once(event, value => { clearTimeout(timer); resolve(value); });
  });
}

async function connect(name) {
  const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  await once(socket, 'connect');
  const identity = await ack(socket, 'identity:init', { nickname: name, characterId: 'volt', palette: 0 });
  assert.equal(identity.ok, true);
  return { socket, identity };
}

test.before(async () => {
  child = spawn(process.execPath, ['server.js', String(port)], {
    cwd: root,
    env: { ...process.env, NEON_SECRET: 'integration-secret', NEON_DB_PATH: path.join(tempDir, 'test.sqlite'), NEON_QUEUE_WAIT_MS: '100', NEON_COUNTDOWN_TICKS: '3', NEON_RECONNECT_MS: '500' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 4000);
    child.once('exit', code => reject(new Error(`server exited ${code}`)));
    child.stdout.on('data', data => { if (String(data).includes('running on')) { clearTimeout(timer); resolve(); } });
  });
});

test.after(async () => {
  for (const socket of clients) socket.close();
  if (child && child.exitCode == null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('four players, validated input, reconnect, and owner transfer', async () => {
  const p1 = await connect('Alpha');
  const created = await ack(p1.socket, 'room:create', { characterId: 'volt', rules: { mode: 'stock', stageId: 'neon-deck' } });
  assert.equal(created.ok, true);
  const resume = { code: created.code, resumeToken: created.resumeToken };

  const players = [p1];
  for (const [index, name] of ['Bravo', 'Charlie', 'Delta'].entries()) {
    const player = await connect(name); players.push(player);
    const joined = await ack(player.socket, 'room:join', { code: created.code, characterId: ['blaze', 'bolt', 'nova'][index] });
    assert.equal(joined.ok, true);
    assert.equal((await ack(player.socket, 'player:select', { characterId: ['blaze', 'bolt', 'nova'][index], palette: index + 1, team: index % 2, ready: true })).ok, true);
  }
  assert.equal((await ack(p1.socket, 'player:select', { characterId: 'volt', palette: 0, team: 0, ready: true })).ok, true);

  const startedEvent = once(p1.socket, 'match:start');
  assert.equal((await ack(p1.socket, 'room:start')).ok, true);
  const started = await startedEvent;
  assert.equal(started.snapshot.players.length, 4);
  assert.deepEqual(started.snapshot.players.map(player => player.nickname).sort(), ['Alpha', 'Bravo', 'Charlie', 'Delta']);

  const watcher = await connect('Watcher');
  const watched = await ack(watcher.socket, 'room:join', { code: created.code, spectator: true });
  assert.equal(watched.ok, false);
  assert.equal(watched.error, '관전 기능은 지원하지 않습니다.');

  p1.socket.emit('input:frame', { seq: 1, clientTime: 10, buttons: 0, horizontal: 1, vertical: 0 });
  p1.socket.emit('input:frame', { seq: 2, clientTime: 11, buttons: 0, horizontal: 8, vertical: 0 });
  let snapshot;
  for (let tries = 0; tries < 8; tries++) {
    snapshot = await once(p1.socket, 'state:snapshot');
    if (snapshot.ackSeq['0'] >= 1) break;
  }
  assert.equal(snapshot.ackSeq['0'], 1);
  assert.equal(typeof snapshot.serverTime, 'number');

  const ownerChange = once(players[1].socket, 'room:state');
  p1.socket.disconnect();
  const changed = await ownerChange;
  assert.equal(changed.ownerClientId, players[1].identity.clientId);

  const resumedClient = await connect('Alpha');
  // Resume requires the same signed anonymous identity.
  const reidentified = await ack(resumedClient.socket, 'identity:init', { clientId: p1.identity.clientId, token: p1.identity.token, nickname: 'Alpha' });
  assert.equal(reidentified.clientId, p1.identity.clientId);
  const resumed = await ack(resumedClient.socket, 'room:resume', resume);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.index, 0);
  assert.equal(resumed.lastSeq, 1);
  resumedClient.socket.emit('input:frame', { seq: resumed.lastSeq + 1, clientTime: 20, buttons: 0, horizontal: -1, vertical: 0 });
  let resumedSnapshot;
  for (let tries = 0; tries < 8; tries++) {
    resumedSnapshot = await once(resumedClient.socket, 'state:snapshot');
    if (resumedSnapshot.ackSeq['0'] >= resumed.lastSeq + 1) break;
  }
  assert.equal(resumedSnapshot.ackSeq['0'], resumed.lastSeq + 1);
});

test('room directory lists waiting rooms and the lobby provides live sparring', async () => {
  const host = await connect('LobbyHost');
  const created = await ack(host.socket, 'room:create', {
    characterId: 'nova',
    rules: { mode: 'stock', stageId: 'sky-rail', items: true, hazards: true }
  });
  assert.equal(created.ok, true);
  assert.equal(created.snapshot.rules.mode, 'training');
  assert.equal(created.snapshot.players.length, 2);
  assert.ok(created.snapshot.players.some(player => player.clientId === 'cpu:warmup'));

  const browser = await connect('RoomBrowser');
  const directory = await ack(browser.socket, 'rooms:list');
  const listed = directory.rooms.find(entry => entry.code === created.code);
  assert.equal(listed.playerCount, 1);
  assert.equal(listed.owner, 'LobbyHost');
  assert.equal(listed.stageId, 'sky-rail');

  host.socket.emit('input:frame', { seq: 1, clientTime: 1, buttons: 0, horizontal: 1, vertical: 0 });
  let snapshot;
  for (let tries = 0; tries < 8; tries++) {
    snapshot = await once(host.socket, 'state:snapshot');
    if (snapshot.ackSeq['0'] >= 1) break;
  }
  for (let frame = 0; frame < 10; frame++) snapshot = await once(host.socket, 'state:snapshot');
  host.socket.emit('input:frame', { seq: 2, clientTime: 2, buttons: 0, horizontal: 0, vertical: 0 });
  for (let tries = 0; tries < 8; tries++) {
    snapshot = await once(host.socket, 'state:snapshot');
    if (snapshot.ackSeq['0'] >= 2) break;
  }
  const hostXBeforeJoin = snapshot.players.find(player => player.i === 0).x;

  const joined = await ack(browser.socket, 'room:join', {
    code: created.code, characterId: 'bolt', palette: 2
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.snapshot.players.length, 2);
  assert.ok(joined.snapshot.players.every(player => player.clientId !== 'cpu:warmup'));
  const hostXAfterJoin = joined.snapshot.players.find(player => player.i === 0).x;
  assert.ok(Math.abs(hostXAfterJoin - hostXBeforeJoin) < 35, 'joining the lobby must not reset an existing player position');

  host.socket.emit('input:frame', { seq: 3, clientTime: 3, buttons: 0, horizontal: 1, vertical: 0 });
  for (let tries = 0; tries < 8; tries++) {
    snapshot = await once(host.socket, 'state:snapshot');
    if (snapshot.ackSeq['0'] >= 3) break;
  }
  assert.equal(snapshot.ackSeq['0'], 3);

  for (let frame = 0; frame < 10; frame++) snapshot = await once(host.socket, 'state:snapshot');
  host.socket.emit('input:frame', { seq: 4, clientTime: 4, buttons: 0, horizontal: 0, vertical: 0 });
  for (let tries = 0; tries < 8; tries++) {
    snapshot = await once(host.socket, 'state:snapshot');
    if (snapshot.ackSeq['0'] >= 4) break;
  }
  const hostXBeforeSelection = snapshot.players.find(player => player.i === 0).x;
  assert.equal((await ack(browser.socket, 'player:select', {
    characterId: 'nova', palette: 3, team: 1, ready: false
  })).ok, true);
  let selectionSnapshot;
  for (let tries = 0; tries < 8; tries++) {
    selectionSnapshot = await once(host.socket, 'state:snapshot');
    if (selectionSnapshot.players.find(player => player.i === joined.index)?.characterId === 'nova') break;
  }
  const hostXAfterSelection = selectionSnapshot.players.find(player => player.i === 0).x;
  assert.ok(Math.abs(hostXAfterSelection - hostXBeforeSelection) < 35, 'another player selection must not reset the host position');

  assert.equal((await ack(host.socket, 'room:configure', {
    stageId: 'reactor-core', stocks: 5, items: false, hazards: false
  })).ok, true);
  let configuredSnapshot;
  for (let tries = 0; tries < 8; tries++) {
    configuredSnapshot = await once(host.socket, 'state:snapshot');
    if (configuredSnapshot.stage.id === 'reactor-core') break;
  }
  const hostXAfterConfigure = configuredSnapshot.players.find(player => player.i === 0).x;
  assert.ok(Math.abs(hostXAfterConfigure - hostXAfterSelection) < 35, 'changing room rules must preserve sparring positions');

  assert.equal((await ack(host.socket, 'room:leave')).ok, true);
  assert.equal((await ack(browser.socket, 'room:leave')).ok, true);
});

test('an empty disconnected room is hidden immediately and removed after reconnect grace', async () => {
  const host = await connect('ClosingHost');
  const created = await ack(host.socket, 'room:create', {
    characterId: 'volt',
    rules: { mode: 'stock', stageId: 'neon-deck' }
  });
  assert.equal(created.ok, true);

  host.socket.disconnect();
  const observer = await connect('DirectoryObserver');
  const directory = await ack(observer.socket, 'rooms:list');
  assert.equal(directory.rooms.some(room => room.code === created.code), false);

  await new Promise(resolve => setTimeout(resolve, 2200));
  const expired = await ack(observer.socket, 'room:join', { code: created.code, characterId: 'bolt' });
  assert.equal(expired.ok, false);
  assert.equal(expired.error, '존재하지 않는 방입니다.');
});

test('public queue starts a server-owned match with two players after the wait window', async () => {
  const q1 = await connect('QueueOne');
  const q2 = await connect('QueueTwo');
  const found1 = once(q1.socket, 'match:found');
  const found2 = once(q2.socket, 'match:found');
  assert.equal((await ack(q1.socket, 'queue:join', { characterId: 'bolt' })).ok, true);
  assert.equal((await ack(q2.socket, 'queue:join', { characterId: 'nova' })).ok, true);
  const [match1, match2] = await Promise.all([found1, found2]);
  assert.equal(match1.code, match2.code);
  const health = await fetch(`http://127.0.0.1:${port}/healthz`).then(response => response.json());
  assert.equal(health.ok, true);
  assert.equal(typeof health.tickP95Ms, 'number');
});

test('leaving training removes the room slot and prevents automatic resume', async () => {
  const trainee = await connect('SoloTrainee');
  const created = await ack(trainee.socket, 'room:create', {
    characterId: 'nova',
    rules: { mode: 'training', stageId: 'neon-deck', items: false, hazards: false }
  });
  assert.equal(created.ok, true);
  const startedEvent = once(trainee.socket, 'match:start');
  assert.equal((await ack(trainee.socket, 'room:start')).ok, true);
  const started = await startedEvent;
  const before = started.snapshot.players.find(player => player.i === created.index);
  assert.equal((await ack(trainee.socket, 'player:select', {
    characterId: 'blaze', palette: 2, team: 0
  })).ok, true);
  let changed;
  for (let tries = 0; tries < 8; tries++) {
    changed = await once(trainee.socket, 'state:snapshot');
    if (changed.players.find(player => player.i === created.index)?.characterId === 'blaze') break;
  }
  const after = changed.players.find(player => player.i === created.index);
  assert.equal(after.characterId, 'blaze');
  assert.equal(after.palette, 2);
  assert.ok(Math.abs(after.x - before.x) < 10, 'changing a training fighter must preserve position');
  assert.ok(Math.abs((after.y + after.height / 2) - (before.y + before.height / 2)) < 1, 'changing fighter height must preserve feet position');
  assert.equal((await ack(trainee.socket, 'room:leave')).ok, true);
  const resumed = await ack(trainee.socket, 'room:resume', { code: created.code, resumeToken: created.resumeToken });
  assert.equal(resumed.ok, false);
});
