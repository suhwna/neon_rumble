const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { FIGHTERS, STAGES, DEFAULT_RULES } = require('./content');
const { TICK_RATE, normalizeRules, createWorld, stepWorld, publicSnapshot, trainingCommand, forfeitPlayer } = require('./engine');
const { StatsStore } = require('./store');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 64 * 1024 });
const rooms = new Map();
const queue = [];
const startedAt = Date.now();
const secret = loadSecret();
const queueWaitMs = Math.max(100, Number(process.env.NEON_QUEUE_WAIT_MS) || 20_000);
const countdownTicks = Math.max(1, Number(process.env.NEON_COUNTDOWN_TICKS) || 180);
const reconnectGraceMs = Math.max(100, Number(process.env.NEON_RECONNECT_MS) || 30_000);
const store = new StatsStore(process.env.NEON_DB_PATH || path.join(__dirname, 'neon-rumble.sqlite'));
let tickCostTotal = 0, tickCostSamples = 0, tickCostMax = 0;
const recentTickCosts = [];

function loadSecret() {
  if (process.env.NEON_SECRET) return process.env.NEON_SECRET;
  const filename = path.join(__dirname, '.neon-secret');
  try { return fs.readFileSync(filename, 'utf8').trim(); }
  catch {
    const value = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(filename, value, { encoding: 'utf8', mode: 0o600 });
    return value;
  }
}

app.get('/socket-client.js', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js')));
app.get('/content.js', (_req, res) => res.sendFile(path.join(__dirname, 'content.js')));
app.get('/healthz', (_req, res) => {
  const players = [...rooms.values()].reduce((sum, room) => sum + room.slots.length, 0);
  const sorted = [...recentTickCosts].sort((a, b) => a - b);
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0;
  res.json({ ok: true, uptime: Math.floor((Date.now() - startedAt) / 1000), rooms: rooms.size, players, queued: queue.length, tickAvgMs: tickCostSamples ? +(tickCostTotal / tickCostSamples).toFixed(3) : 0, tickP95Ms: +p95.toFixed(3), tickMaxMs: +tickCostMax.toFixed(3) });
});
app.use(express.static(__dirname));

function sign(value) { return `${value}.${crypto.createHmac('sha256', secret).update(value).digest('base64url')}`; }
function verify(token) {
  if (typeof token !== 'string') return null;
  const split = token.lastIndexOf('.'); if (split < 1) return null;
  const value = token.slice(0, split), signature = token.slice(split + 1);
  const expected = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return value;
}
function nickname(value) { return String(value || 'RUMBLER').replace(/[^\p{L}\p{N}_ -]/gu, '').trim().slice(0, 16) || 'RUMBLER'; }
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code;
  do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(code));
  return code;
}
function identityRequired(socket, reply) {
  if (socket.data.identity) return true;
  reply?.({ ok: false, error: '사용자 초기화가 필요합니다.' }); return false;
}
function slotToken(room, slot) { return sign(`${room.code}:${slot.clientId}:${slot.index}`); }
function emptyInput(seq = 0) { return { seq, clientTime: 0, buttons: 0, pressedButtons: 0, horizontal: 0, vertical: 0 }; }
function defaultSelection(index) { return FIGHTERS[index % FIGHTERS.length].id; }

function createRoom(owner, options = {}) {
  const code = makeCode();
  const room = {
    code, ownerClientId: owner.clientId, quick: !!options.quick,
    rules: normalizeRules({ ...(options.rules || DEFAULT_RULES), items: false }), slots: [],
    inputs: {}, world: null, warmupWorld: null, playing: false, recorded: false, createdAt: Date.now()
  };
  rooms.set(code, room); return room;
}

function addSlot(room, socket, selection = {}) {
  const used = new Set(room.slots.map(slot => slot.index));
  const index = [0, 1, 2, 3].find(value => !used.has(value));
  if (index == null) return null;
  const slot = {
    index, socketId: socket.id, clientId: socket.data.identity.clientId,
    nickname: socket.data.identity.nickname, characterId: selection.characterId || defaultSelection(index),
    palette: Number.isInteger(Number(selection.palette)) ? clampInt(selection.palette, 0, 3) : index,
    team: Number.isInteger(Number(selection.team)) ? clampInt(selection.team, 0, 1) : index % 2,
    ready: room.quick, disconnectedAt: null, lastSeq: 0, inputCount: 0, inputWindow: Date.now()
  };
  room.slots.push(slot); room.inputs[index] = emptyInput(); socket.join(room.code);
  socket.data.roomCode = room.code; socket.data.role = 'player';
  return slot;
}

function publicRoom(room) {
  return {
    code: room.code, ownerClientId: room.ownerClientId, playing: room.playing, quick: room.quick,
    rules: room.rules,
    players: room.slots.map(slot => ({ index: slot.index, clientId: slot.clientId, nickname: slot.nickname, characterId: slot.characterId, palette: slot.palette, team: slot.team, ready: slot.ready, connected: !!slot.socketId })),
  };
}
function publicRoomDirectory() {
  return [...rooms.values()]
    .filter(room => !room.quick && !room.playing && room.rules.mode !== 'training' && room.slots.some(slot => slot.socketId))
    .sort((first, second) => second.createdAt - first.createdAt)
    .map(room => {
      const connected = room.slots.filter(slot => slot.socketId);
      return {
        code: room.code,
        mode: room.rules.mode,
        stageId: room.rules.stageId,
        hazards: room.rules.hazards,
        playerCount: connected.length,
        capacity: 4,
        owner: connected.find(slot => slot.clientId === room.ownerClientId)?.nickname || connected[0]?.nickname || 'HOST',
        players: connected.map(slot => slot.nickname)
      };
    });
}
function emitRoom(room) {
  io.to(room.code).emit('room:state', publicRoom(room));
  io.emit('rooms:changed');
}

function refreshWarmup(room) {
  if (!room || room.playing || room.quick || room.rules.mode === 'training') return;
  const roster = room.slots.map(slot => ({
    slot: slot.index, clientId: slot.clientId, nickname: slot.nickname, characterId: slot.characterId,
    palette: slot.palette, team: slot.team
  }));
  if (roster.length === 1) roster.push({ slot: roster[0].slot === 0 ? 1 : 0, clientId: 'cpu:warmup', nickname: 'BOT', characterId: 'bolt', palette: 0, team: 1 });
  room.warmupWorld = createWorld({
    rules: { ...room.rules, mode: 'training', items: false, hazards: false },
    roster,
    seed: Date.now(),
    cpu: 'dummy'
  });
  room.warmupWorld.phase = 'active';
  room.warmupWorld.countdown = 0;
  for (const slot of room.slots) room.inputs[slot.index] = emptyInput(slot.lastSeq);
}

function updateWorldFighter(world, room, slot) {
  const player = world?.players.find(item => item.clientId === slot.clientId);
  const fighter = FIGHTERS.find(item => item.id === slot.characterId);
  if (!player || !fighter) return false;
  const previousHeight = player.height;
  const feetY = player.y + previousHeight / 2;

  if (player.grabbing != null) {
    const target = world.players.find(item => item.i === player.grabbing);
    if (target) target.grabbedBy = null;
  }
  if (player.grabbedBy != null) {
    const grabber = world.players.find(item => item.i === player.grabbedBy);
    if (grabber) grabber.grabbing = null;
  }
  Object.assign(player, {
    characterId: fighter.id, palette: slot.palette, team: slot.team,
    width: fighter.width, height: fighter.height, y: feetY - fighter.height / 2,
    action: null, actionName: 'idle', charge: null, actionBuffer: null,
    grabbing: null, grabbedBy: null, grabFrames: 0, pendingThrow: null,
    hitstop: 0, stun: 0, shielding: false, shieldStun: 0, shieldDropLag: 0,
    dodgeFrames: 0, landingLag: 0, invincible: 30
  });
  world.entities = world.entities.filter(entity => entity.owner !== player.i);
  room.inputs[slot.index] = emptyInput(slot.lastSeq);
  return true;
}

function updateWarmupFighter(room, slot) {
  if (!updateWorldFighter(room?.warmupWorld, room, slot)) refreshWarmup(room);
}

function updateWarmupRules(room, previousStageId) {
  const world = room?.warmupWorld;
  if (!world) return refreshWarmup(room);
  world.rules = normalizeRules({ ...room.rules, mode: 'training', items: false, hazards: false });
  if (previousStageId === room.rules.stageId) return;
  const stage = STAGES.find(item => item.id === room.rules.stageId) || STAGES[0];
  world.stage = { id: stage.id, name: stage.name, color: stage.color };
  world.platforms = stage.platforms.map(platform => ({ ...platform, baseX: platform.x, baseY: platform.y }));
  world.hazards = [];
  world.items = [];
  for (const player of world.players) {
    player.grounded = false;
    player.platformId = null;
    player.ledge = null;
    player.invincible = Math.max(player.invincible || 0, 30);
  }
}

function removeWarmupPlayer(world, player) {
  for (const other of world.players) {
    if (other.grabbedBy === player.i) other.grabbedBy = null;
    if (other.grabbing === player.i) other.grabbing = null;
  }
  world.entities = world.entities.filter(entity => entity.owner !== player.i);
  world.players.splice(world.players.indexOf(player), 1);
}

function syncWarmupRoster(room) {
  const world = room?.warmupWorld;
  if (!world) return refreshWarmup(room);
  const roster = room.slots.map(slot => ({
    slot: slot.index, clientId: slot.clientId, nickname: slot.nickname, characterId: slot.characterId,
    palette: slot.palette, team: slot.team
  }));
  if (roster.length === 1) {
    const occupied = new Set(roster.map(entry => entry.slot));
    const botSlot = [0, 1, 2, 3].find(index => !occupied.has(index)) ?? 1;
    roster.push({ slot: botSlot, clientId: 'cpu:warmup', nickname: 'BOT', characterId: 'bolt', palette: 0, team: 1 });
  }
  const wantedIds = new Set(roster.map(entry => entry.clientId));
  for (const player of [...world.players]) if (!wantedIds.has(player.clientId)) removeWarmupPlayer(world, player);
  for (const [index, entry] of roster.entries()) {
    if (world.players.some(player => player.clientId === entry.clientId)) continue;
    const temporary = createWorld({ rules: world.rules, roster: [entry], seed: Date.now() + index, cpu: 'dummy' });
    const player = temporary.players[0];
    player.x = 460 + entry.slot * 120;
    player.y = 220;
    player.face = entry.slot < 2 ? 1 : -1;
    player.invincible = 90;
    world.players.push(player);
  }
  world.players.sort((first, second) => first.i - second.i);
  for (const slot of room.slots) if (!room.inputs[slot.index]) room.inputs[slot.index] = emptyInput(slot.lastSeq);
}

function startRoom(room) {
  if (room.playing || room.slots.length < (room.rules.mode === 'training' ? 1 : 2)) return false;
  const roster = room.slots.map(slot => ({ slot: slot.index, clientId: slot.clientId, nickname: slot.nickname, characterId: slot.characterId, palette: slot.palette, team: slot.team }));
  if (room.rules.mode === 'training' && roster.length === 1) roster.push({ slot: 1, clientId: 'cpu:training', nickname: 'BOT', characterId: 'blaze', palette: 0, team: 1 });
  room.world = createWorld({ rules: room.rules, roster, seed: Date.now(), cpu: 'dummy' });
  room.warmupWorld = null;
  room.world.countdown = countdownTicks;
  room.playing = true; room.recorded = false;
  for (const slot of room.slots) room.inputs[slot.index] = emptyInput(slot.lastSeq);
  io.to(room.code).emit('match:start', { room: publicRoom(room), snapshot: publicSnapshot(room.world) }); emitRoom(room); return true;
}

function finishRoom(room) {
  if (!room.playing || room.world.phase !== 'ended') return;
  room.playing = false;
  if (!room.recorded) {
    room.recorded = true;
    try { store.recordMatch(room.code, room.world, room.slots); } catch (error) { console.error('stats record failed', error); }
  }
  for (const slot of room.slots) slot.ready = false;
  refreshWarmup(room);
  io.to(room.code).emit('match:end', { winner: room.world.winner, snapshot: publicSnapshot(room.world) }); emitRoom(room);
}

function removeFromQueue(clientId) {
  for (let index = queue.length - 1; index >= 0; index--) if (queue[index].clientId === clientId) queue.splice(index, 1);
}

function createQuickMatch(entries) {
  const hostEntry = entries[0], hostSocket = io.sockets.sockets.get(hostEntry.socketId);
  if (!hostSocket) return;
  const room = createRoom(hostEntry, { quick: true, rules: { ...DEFAULT_RULES, mode: 'stock', stocks: 3, timeSeconds: 420, items: false, hazards: false } });
  for (const entry of entries) {
    const socket = io.sockets.sockets.get(entry.socketId); if (!socket) continue;
    socket.data.identity = entry;
    const slot = addSlot(room, socket, { characterId: entry.characterId, palette: entry.palette });
    socket.emit('match:found', { code: room.code, index: slot.index, resumeToken: slotToken(room, slot) });
  }
  if (room.slots.length >= 2) startRoom(room); else rooms.delete(room.code);
}

setInterval(() => {
  const active = queue.filter(entry => io.sockets.sockets.has(entry.socketId));
  queue.splice(0, queue.length, ...active);
  while (queue.length >= 4) createQuickMatch(queue.splice(0, 4));
  if (queue.length >= 2 && Date.now() - queue[0].joinedAt >= queueWaitMs) createQuickMatch(queue.splice(0, Math.min(4, queue.length)));
  queue.forEach((entry, index) => io.to(entry.socketId).emit('queue:state', { position: index + 1, elapsedMs: Date.now() - entry.joinedAt }));
}, 1000);

setInterval(() => {
  const players = [...rooms.values()].reduce((sum, room) => sum + room.slots.length, 0);
  const sorted = [...recentTickCosts].sort((a, b) => a - b);
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0;
  console.log(`[health] rooms=${rooms.size} players=${players} queued=${queue.length} tickP95=${p95.toFixed(3)}ms`);
}, 30_000);

setInterval(() => {
  const begin = performance.now();
  for (const room of rooms.values()) {
    if (room.playing && room.world) {
      stepWorld(room.world, room.inputs);
      const snapshot = publicSnapshot(room.world);
      for (const slot of room.slots) if (slot.socketId) io.to(slot.socketId).volatile.emit('state:snapshot', snapshot);
      for (const input of Object.values(room.inputs)) input.pressedButtons = 0;
      finishRoom(room);
    } else if (room.warmupWorld) {
      stepWorld(room.warmupWorld, room.inputs);
      if (room.warmupWorld.tick % 2 === 0) {
        const snapshot = publicSnapshot(room.warmupWorld);
        for (const slot of room.slots) if (slot.socketId) io.to(slot.socketId).volatile.emit('state:snapshot', snapshot);
      }
      for (const input of Object.values(room.inputs)) input.pressedButtons = 0;
    }
  }
  const cost = performance.now() - begin;
  tickCostTotal += cost; tickCostSamples += 1; tickCostMax = Math.max(tickCostMax, cost);
  recentTickCosts.push(cost); if (recentTickCosts.length > 3600) recentTickCosts.shift();
  if (tickCostSamples > 3600) { tickCostTotal /= 2; tickCostSamples /= 2; tickCostMax *= 0.95; }
}, 1000 / TICK_RATE);

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    let warmupChanged = false;
    for (const slot of [...room.slots]) {
      if (!slot.disconnectedAt || now - slot.disconnectedAt < reconnectGraceMs) continue;
      if (room.playing && room.world) {
        forfeitPlayer(room.world, slot.index);
        if (!room.slots.some(other => other.socketId)) { room.world.phase = 'ended'; room.world.winner = null; }
      }
      delete room.inputs[slot.index];
      room.slots.splice(room.slots.indexOf(slot), 1);
      warmupChanged = warmupChanged || !room.playing;
    }
    if (warmupChanged) syncWarmupRoster(room);
    if (!room.slots.length) rooms.delete(room.code);
    else emitRoom(room);
  }
}, 1000);

io.on('connection', socket => {
  socket.on('identity:init', (payload, reply) => {
    const signedId = verify(payload?.token);
    const requested = String(payload?.clientId || '');
    const clientId = signedId && signedId === requested ? requested : crypto.randomUUID();
    const name = nickname(payload?.nickname);
    socket.data.identity = { clientId, nickname: name, characterId: FIGHTERS.some(item => item.id === payload?.characterId) ? payload.characterId : 'volt', palette: Number(payload?.palette) || 0 };
    const stats = store.ensurePlayer(clientId, name);
    reply?.({ ok: true, clientId, nickname: name, token: sign(clientId), stats });
  });

  socket.on('room:create', (payload, reply) => {
    if (!identityRequired(socket, reply)) return;
    const room = createRoom(socket.data.identity, { rules: payload?.rules });
    const slot = addSlot(room, socket, payload || {}); slot.ready = room.rules.mode === 'training';
    syncWarmupRoster(room);
    reply?.({ ok: true, code: room.code, index: slot.index, resumeToken: slotToken(room, slot), room: publicRoom(room), snapshot: room.warmupWorld ? publicSnapshot(room.warmupWorld) : null }); emitRoom(room);
  });

  socket.on('room:join', (payload, reply) => {
    if (!identityRequired(socket, reply)) return;
    const room = rooms.get(String(payload?.code || '').toUpperCase());
    if (!room) return reply?.({ ok: false, error: '존재하지 않는 방입니다.' });
    if (payload?.spectator) return reply?.({ ok: false, error: '관전 기능은 지원하지 않습니다.' });
    if (room.playing) return reply?.({ ok: false, error: '이미 진행 중인 경기입니다.' });
    const existing = room.slots.find(slot => slot.clientId === socket.data.identity.clientId);
    if (existing) return reply?.({ ok: false, error: '이미 참가한 방입니다.' });
    const slot = addSlot(room, socket, payload || {});
    if (!slot) return reply?.({ ok: false, error: '방이 가득 찼습니다.' });
    syncWarmupRoster(room);
    reply?.({ ok: true, code: room.code, index: slot.index, resumeToken: slotToken(room, slot), room: publicRoom(room), snapshot: room.warmupWorld ? publicSnapshot(room.warmupWorld) : null }); emitRoom(room);
  });

  socket.on('room:resume', (payload, reply) => {
    if (!identityRequired(socket, reply)) return;
    const room = rooms.get(String(payload?.code || '').toUpperCase());
    const value = verify(payload?.resumeToken);
    const slot = room?.slots.find(item => `${room.code}:${item.clientId}:${item.index}` === value && item.clientId === socket.data.identity.clientId);
    if (!room || !slot || (slot.disconnectedAt && Date.now() - slot.disconnectedAt > reconnectGraceMs)) return reply?.({ ok: false, error: '재접속 시간이 만료되었습니다.' });
    slot.socketId = socket.id; slot.disconnectedAt = null; socket.join(room.code); socket.data.roomCode = room.code; socket.data.role = 'player';
    if (!room.playing && !room.warmupWorld) refreshWarmup(room);
    reply?.({ ok: true, index: slot.index, lastSeq: slot.lastSeq, room: publicRoom(room), snapshot: room.playing && room.world ? publicSnapshot(room.world) : room.warmupWorld ? publicSnapshot(room.warmupWorld) : null }); emitRoom(room);
  });

  socket.on('room:configure', (rules, reply) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.playing || room.ownerClientId !== socket.data.identity?.clientId) return reply?.({ ok: false, error: '설정 권한이 없습니다.' });
    const previousStageId = room.rules.stageId;
    room.rules = normalizeRules({ ...room.rules, ...rules, items: false });
    updateWarmupRules(room, previousStageId);
    reply?.({ ok: true, rules: room.rules }); emitRoom(room);
  });

  socket.on('player:select', (payload, reply) => {
    const room = rooms.get(socket.data.roomCode); const slot = room?.slots.find(item => item.socketId === socket.id);
    const trainingChange = room?.playing && room.rules.mode === 'training';
    if (!room || !slot || (room.playing && !trainingChange)) return reply?.({ ok: false });
    const previousCharacter = slot.characterId, previousPalette = slot.palette, previousTeam = slot.team;
    if (FIGHTERS.some(item => item.id === payload?.characterId)) slot.characterId = payload.characterId;
    slot.palette = clampInt(payload?.palette, 0, 3); slot.team = clampInt(payload?.team, 0, 1);
    const changedSelection = previousCharacter !== slot.characterId || previousPalette !== slot.palette || previousTeam !== slot.team;
    if (!trainingChange) slot.ready = !!payload?.ready;
    socket.data.identity.characterId = slot.characterId; socket.data.identity.palette = slot.palette;
    if (changedSelection) {
      if (trainingChange) updateWorldFighter(room.world, room, slot);
      else updateWarmupFighter(room, slot);
    }
    reply?.({ ok: true }); emitRoom(room);
  });

  socket.on('room:start', reply => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.ownerClientId !== socket.data.identity?.clientId || room.slots.length < (room?.rules.mode === 'training' ? 1 : 2)) return reply?.({ ok: false, error: '시작할 수 없습니다.' });
    if (!room.slots.every(slot => slot.ready)) return reply?.({ ok: false, error: '모든 플레이어가 준비해야 합니다.' });
    reply?.({ ok: startRoom(room) });
  });

  socket.on('queue:join', (payload, reply) => {
    if (!identityRequired(socket, reply)) return;
    removeFromQueue(socket.data.identity.clientId);
    const entry = { ...socket.data.identity, socketId: socket.id, joinedAt: Date.now(), characterId: FIGHTERS.some(item => item.id === payload?.characterId) ? payload.characterId : socket.data.identity.characterId, palette: clampInt(payload?.palette, 0, 3) };
    queue.push(entry); reply?.({ ok: true, position: queue.length });
  });
  socket.on('queue:leave', reply => { if (socket.data.identity) removeFromQueue(socket.data.identity.clientId); reply?.({ ok: true }); });
  socket.on('rooms:list', reply => reply?.({ ok: true, rooms: publicRoomDirectory() }));

  socket.on('room:leave', reply => {
    if (socket.data.identity) removeFromQueue(socket.data.identity.clientId);
    const room = rooms.get(socket.data.roomCode);
    if (!room) {
      socket.data.roomCode = null; socket.data.role = null;
      return reply?.({ ok: true });
    }
    const slot = room.slots.find(item => item.socketId === socket.id || item.clientId === socket.data.identity?.clientId);
    if (slot) {
      if (room.playing && room.world) forfeitPlayer(room.world, slot.index);
      delete room.inputs[slot.index];
      room.slots.splice(room.slots.indexOf(slot), 1);
    }
    if (room.ownerClientId === socket.data.identity?.clientId) {
      const next = room.slots.find(item => item.socketId) || room.slots[0];
      room.ownerClientId = next?.clientId || null;
    }
    socket.leave(room.code);
    socket.data.roomCode = null; socket.data.role = null;
    if (!room.slots.length) rooms.delete(room.code);
    else { syncWarmupRoster(room); emitRoom(room); }
    reply?.({ ok: true });
  });

  socket.on('input:frame', payload => {
    const room = rooms.get(socket.data.roomCode); const slot = room?.slots.find(item => item.socketId === socket.id);
    if (!room || (!room.playing && !room.warmupWorld) || !slot) return;
    const now = Date.now(); if (now - slot.inputWindow >= 1000) { slot.inputWindow = now; slot.inputCount = 0; }
    slot.inputCount += 1; if (slot.inputCount > 60) return;
    const seq = Number(payload?.seq);
    const buttons = Number(payload?.buttons), horizontal = Number(payload?.horizontal), vertical = Number(payload?.vertical);
    if (!Number.isSafeInteger(seq) || seq <= slot.lastSeq || !Number.isInteger(buttons) || buttons < 0 || buttons > 255 || !Number.isFinite(horizontal) || Math.abs(horizontal) > 1 || !Number.isFinite(vertical) || Math.abs(vertical) > 1) return;
    slot.lastSeq = seq;
    const previous = room.inputs[slot.index] || emptyInput();
    const pressedButtons = (previous.pressedButtons || 0) | (buttons & ~previous.buttons);
    room.inputs[slot.index] = { seq, clientTime: Number(payload?.clientTime) || 0, buttons, pressedButtons, horizontal, vertical };
  });

  socket.on('training:command', (command, reply) => {
    const room = rooms.get(socket.data.roomCode);
    const slot = room?.slots.find(item => item.socketId === socket.id);
    if (room?.ownerClientId === socket.data.identity?.clientId && room.world && slot) {
      const accepted = trainingCommand(room.world, { ...(command || {}), player: slot.index });
      reply?.({ ok: accepted });
      return;
    }
    reply?.({ ok: false, error: '연습 명령을 사용할 수 없습니다.' });
  });
  socket.on('latency:ping', (clientTime, reply) => reply?.({ clientTime, serverTime: Date.now() }));
  socket.on('stats:get', reply => reply?.(socket.data.identity ? store.getPlayer(socket.data.identity.clientId) : null));

  socket.on('disconnect', () => {
    if (socket.data.identity) removeFromQueue(socket.data.identity.clientId);
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const slot = room.slots.find(item => item.socketId === socket.id);
    if (slot) { slot.socketId = null; slot.disconnectedAt = Date.now(); room.inputs[slot.index] = emptyInput(slot.lastSeq); }
    if (room.ownerClientId === socket.data.identity?.clientId) {
      const next = room.slots.find(item => item.socketId); if (next) room.ownerClientId = next.clientId;
    }
    emitRoom(room);
  });
});

function clampNumber(value, min, max) { value = Number(value); return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0; }
function clampInt(value, min, max) { return Math.round(clampNumber(value, min, max)); }

const port = Number(process.env.PORT || process.argv[2]) || 4173;
server.listen(port, '0.0.0.0', () => console.log(`NEON RUMBLE running on http://localhost:${port}`));

function shutdown() { try { store.close(); } finally { server.close(() => process.exit(0)); } }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
