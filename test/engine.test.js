const test = require('node:test');
const assert = require('node:assert/strict');
const { BUTTONS, FIGHTERS, STAGES, ITEMS } = require('../content');
const { BLAST_MARGIN_X, BLAST_TOP, createWorld, stepWorld, publicSnapshot, trainingCommand, forfeitPlayer } = require('../engine');

function worldWith(rules = {}) {
  const world = createWorld({ rules: { mode: 'stock', stocks: 3, timeSeconds: 420, ...rules }, seed: 42, roster: [
    { slot: 0, clientId: 'p1', characterId: 'volt', palette: 0, team: 0 },
    { slot: 1, clientId: 'p2', characterId: 'blaze', palette: 1, team: 1 }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const platform = world.platforms[0];
  world.players.forEach((player, index) => {
    player.x = 600 + index * 60; player.y = platform.y - player.height / 2;
    player.grounded = true; player.invincible = 0;
  });
  return world;
}

function frame(seq, buttons = 0, horizontal = 0, vertical = 0) { return { seq, clientTime: seq, buttons, horizontal, vertical }; }
function tap(seq, button, buttons = 0, horizontal = 0, vertical = 0) {
  return { ...frame(seq, buttons, horizontal, vertical), pressedButtons: button };
}

function launchTowardFloor(world, player, speed = 240) {
  const platform = world.platforms[0];
  player.y = platform.y - player.height / 2 - 2; player.vy = speed; player.vx = 120;
  player.grounded = false; player.platformId = null; player.stun = 12; player.tumbling = true;
  player.action = null; player.actionName = 'tumble'; player.lastInput = frame(0);
}

test('every fighter move has coherent frame data and character overrides refresh derived timing', () => {
  for (const fighter of FIGHTERS) for (const [name, move] of Object.entries(fighter.moves)) {
    assert.ok(Number.isFinite(move.startup) && move.startup >= 0, `${fighter.id}.${name} startup`);
    assert.ok(Number.isFinite(move.active) && move.active > 0, `${fighter.id}.${name} active`);
    assert.ok(Number.isFinite(move.recovery) && move.recovery >= 0, `${fighter.id}.${name} recovery`);
    assert.ok(Number.isFinite(move.cancelWindow) && move.cancelWindow >= 0 && move.cancelWindow <= move.recovery, `${fighter.id}.${name} cancel window`);
    assert.ok(Number.isFinite(move.landingLag) && move.landingLag >= 4, `${fighter.id}.${name} landing lag`);
    assert.ok(Number.isFinite(move.hitstop) && move.hitstop >= 3 && move.hitstop <= 9, `${fighter.id}.${name} hitstop`);
    assert.ok(Number.isFinite(move.knockbackGrowth) && move.knockbackGrowth >= 0, `${fighter.id}.${name} knockback growth`);
  }
  assert.equal(FIGHTERS[0].moves.specialNeutral.landingLag, Math.round(FIGHTERS[0].moves.specialNeutral.recovery * .55));
  assert.equal(FIGHTERS[1].moves.specialNeutral.landingLag, Math.round(FIGHTERS[1].moves.specialNeutral.recovery * .55));
  assert.notEqual(FIGHTERS[0].moves.specialNeutral.landingLag, FIGHTERS[1].moves.specialNeutral.landingLag);
});

test('fighter normals have distinct frame signatures, motion identities, and archetype balance bands', () => {
  const normalNames = ['groundNeutral','groundJab2','groundJab3','groundSide','groundUp','groundDown','dashAttack','airNeutral','airForward','airBack','airUp','airDown'];
  for (const fighter of FIGHTERS) {
    for (const name of normalNames) assert.ok(fighter.moves[name].motion, `${fighter.id}.${name} motion`);
  }
  for (const name of normalNames) {
    const signatures = new Set(FIGHTERS.map(fighter => { const move=fighter.moves[name]; return `${move.startup}/${move.active}/${move.recovery}/${move.damage}/${move.motion}`; }));
    assert.equal(signatures.size, 4, `${name} should differ for all fighters`);
  }
  const byId = Object.fromEntries(FIGHTERS.map(fighter => [fighter.id, fighter]));
  const average = (fighter, field, names=normalNames) => names.reduce((sum,name)=>sum+fighter.moves[name][field],0)/names.length;
  const aerials = ['airNeutral','airForward','airBack','airUp','airDown'];
  assert.ok(average(byId.volt,'startup') < average(byId.bolt,'startup'));
  assert.ok(average(byId.blaze,'damage') > average(byId.bolt,'damage') * 1.35);
  assert.ok(average(byId.blaze,'recovery') > average(byId.volt,'recovery') * 1.6);
  assert.ok(average(byId.nova,'landingLag',aerials) < average(byId.bolt,'landingLag',aerials));
  assert.ok(byId.blaze.weight > byId.volt.weight * 1.19);
  assert.ok(byId.blaze.weight < byId.volt.weight * 1.3, 'weight gap should not dominate launch outcomes');
  assert.ok(byId.volt.moves.specialNeutral.projectileCooldown >= 40);
  assert.ok(byId.nova.air <= 1.16);
  assert.ok(byId.bolt.moves.specialSide.recovery >= 17);
});

test('each fighter special kit exposes four distinct behaviors and animations', () => {
  for (const fighter of FIGHTERS) {
    const specials = ['specialNeutral','specialSide','specialUp','specialDown'].map(name=>fighter.moves[name]);
    assert.equal(new Set(specials.map(move=>move.motion)).size, 4, fighter.id);
    assert.ok(specials.some(move=>move.projectile));
    assert.ok(specials.some(move=>move.recoveryMove || move.teleportY));
    assert.ok(specials.some(move=>move.trap || move.counter || move.radial));
  }
});

test('damage builds an ultimate meter and Z plus X spends a full meter', () => {
  const world = worldWith(), attacker = world.players[0], target = world.players[1];
  attacker.ultimateMeter = 0; target.ultimateMeter = 0;
  stepWorld(world, { 0: tap(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 8; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(attacker.ultimateMeter > 0, 'dealing damage should build meter');
  assert.ok(target.ultimateMeter > 0, 'taking damage should build comeback meter');

  attacker.action = null; attacker.actionName = 'idle'; attacker.ultimateMeter = 100;
  stepWorld(world, { 0: frame(9, BUTTONS.ATTACK | BUTTONS.SPECIAL), 1: frame(9) });
  assert.equal(attacker.action?.name, 'ultimate');
  assert.equal(attacker.ultimateMeter, 0);
  assert.equal(world.entities[0]?.kind, 'ultimateVolt');
});

test('all four ultimates telegraph real avoidable geometry instead of auto-hitting', () => {
  const startupFrames = [];
  for (const fighter of FIGHTERS) {
    const world = worldWith(), attacker = world.players[0], target = world.players[1];
    attacker.characterId = fighter.id; attacker.width = fighter.width; attacker.height = fighter.height;
    attacker.ultimateMeter = 100; target.damage = 0;
    attacker.face = 1;
    target.x = 100; target.y = 200; target.grounded = false; target.platformId = null;
    stepWorld(world, { 0: frame(1, BUTTONS.ATTACK | BUTTONS.SPECIAL), 1: frame(1) });
    assert.equal(attacker.action?.name, 'ultimate', fighter.id);
    assert.equal(attacker.action?.move?.ultimateKind, fighter.id, fighter.id);
    startupFrames.push(attacker.action.startup);
    for (let seq = 2; seq <= 72; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
    assert.equal(target.damage, 0, `${fighter.id} ultimate should miss an opponent outside its visible path`);
  }
  assert.ok(Math.max(...startupFrames) - Math.min(...startupFrames) <= 3, 'ultimate startup spread should remain competitively readable');
});

test('training starts with a ready ultimate and reset restores it for repeat testing', () => {
  const world = createWorld({ rules: { mode: 'training' }, roster: [{ slot: 0, clientId: 'p1', characterId: 'nova' }] });
  assert.equal(world.players[0].ultimateMeter, 100);
  world.players[0].ultimateMeter = 0;
  assert.equal(trainingCommand(world, { type: 'reset' }), true);
  assert.equal(world.players[0].ultimateMeter, 100);
});

test('training can change only the bot fighter without moving either fighter', () => {
  const world = createWorld({ rules: { mode: 'training' }, roster: [
    { slot: 0, clientId: 'human', characterId: 'volt' },
    { slot: 1, clientId: 'cpu:training', characterId: 'blaze' }
  ] });
  const human = world.players[0], bot = world.players[1];
  human.x = 410; human.y = 260; human.damage = 47;
  bot.x = 835; bot.y = 318; bot.vx = -120; bot.vy = 75; bot.action = { name: 'specialSide' }; bot.actionName = 'specialSide';
  const humanBefore = { x: human.x, y: human.y, characterId: human.characterId, damage: human.damage };
  const botBefore = { x: bot.x, feetY: bot.y + bot.height / 2, vx: bot.vx, vy: bot.vy };
  world.entities.push({ id: 77, owner: bot.i, type: 'projectile' });

  assert.equal(trainingCommand(world, { type: 'bot-character', value: 'nova' }), true);
  const nova = FIGHTERS.find(fighter => fighter.id === 'nova');
  assert.deepEqual(
    { x: human.x, y: human.y, characterId: human.characterId, damage: human.damage },
    humanBefore
  );
  assert.equal(bot.characterId, 'nova');
  assert.equal(bot.width, nova.width);
  assert.equal(bot.height, nova.height);
  assert.equal(bot.x, botBefore.x);
  assert.equal(bot.y + bot.height / 2, botBefore.feetY);
  assert.equal(bot.vx, botBefore.vx);
  assert.equal(bot.vy, botBefore.vy);
  assert.equal(bot.action, null);
  assert.ok(!world.entities.some(entity => entity.owner === bot.i));
  assert.equal(trainingCommand(world, { type: 'bot-character', value: 'unknown' }), false);
  assert.equal(bot.characterId, 'nova');
});

test('ultimate hitboxes respect shields and startup resists ordinary interruption', () => {
  const guarded = worldWith(), caster = guarded.players[0], defender = guarded.players[1];
  caster.ultimateMeter = 100; defender.x = caster.x + 250;
  stepWorld(guarded, { 0: frame(1, BUTTONS.ATTACK | BUTTONS.SPECIAL), 1: frame(1, BUTTONS.SHIELD) });
  for (let seq = 2; seq <= 34; seq++) stepWorld(guarded, { 0: frame(seq), 1: frame(seq, BUTTONS.SHIELD) });
  assert.equal(defender.damage, 0);
  assert.ok(defender.shield < 50, 'a guarded ultimate should damage the shield');
  assert.ok(guarded.events.some(event => event.type === 'shield-hit' && event.ultimate), 'clients should receive an ultimate-specific impact event');

  const interrupted = worldWith(), target = interrupted.players[0], punisher = interrupted.players[1];
  target.ultimateMeter = 100;
  stepWorld(interrupted, { 0: frame(1, BUTTONS.ATTACK | BUTTONS.SPECIAL), 1: frame(1, BUTTONS.ATTACK) });
  for (let seq = 2; seq <= 10; seq++) stepWorld(interrupted, { 0: frame(seq), 1: frame(seq) });
  assert.equal(target.action?.name, 'ultimate');
  assert.ok(interrupted.entities.some(entity => entity.owner === target.i && entity.type === 'ultimate' && entity.life > 0));
  assert.ok(target.damage > 0, 'ultimate armor should preserve the move without negating incoming damage');
  assert.equal(target.stun, 0);
  assert.equal(target.grounded, true, 'armored impact must not detach the caster from the floor');
  assert.ok(target.ultimateMeter < 5, 'a committed ultimate spends its meter before normal comeback gain resumes');
});

test('ultimate activation is grounded-only and an airborne attempt preserves the meter', () => {
  const world = worldWith(), player = world.players[0];
  player.ultimateMeter = 100;
  player.grounded = false; player.platformId = null; player.coyoteFrames = 0; player.y = 300;
  stepWorld(world, { 0: frame(1, BUTTONS.ATTACK | BUTTONS.SPECIAL), 1: frame(1) });
  assert.notEqual(player.action?.name, 'ultimate');
  assert.equal(player.ultimateMeter, 100);
  assert.ok(!world.entities.some(entity => entity.owner === player.i && entity.type === 'ultimate'));
});

test('projectile specials define cadence limits and reject cooldown or field-limit spam', () => {
  for (const fighter of FIGHTERS) {
    const projectile = fighter.moves.specialNeutral;
    assert.ok(projectile.projectileCooldown >= 30, `${fighter.id} projectile cooldown`);
    assert.ok(projectile.maxActiveProjectiles >= 1 && projectile.maxActiveProjectiles <= 2, `${fighter.id} projectile cap`);
  }

  const world = createWorld({ rules: { mode: 'training', stocks: 3 }, roster: [
    { slot: 0, clientId: 'shooter', characterId: 'volt' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const player = world.players[0], platform = world.platforms[0];
  player.x = 300; player.y = platform.y - player.height / 2; player.grounded = true; player.invincible = 0;
  let seq = 1;
  stepWorld(world, { 0: tap(seq, BUTTONS.SPECIAL) });
  for (seq = 2; seq <= 21; seq++) stepWorld(world, { 0: frame(seq) });
  assert.equal(world.entities.filter(entity => entity.type === 'projectile').length, 1);
  assert.ok(player.projectileCooldown > 0);

  stepWorld(world, { 0: tap(++seq, BUTTONS.SPECIAL) });
  assert.equal(player.action, null);
  assert.ok(world.events.some(event => event.type === 'projectile-denied' && event.reason === 'cooldown'));

  while (player.projectileCooldown > 0) stepWorld(world, { 0: frame(++seq) });
  stepWorld(world, { 0: tap(++seq, BUTTONS.SPECIAL) });
  for (let count = 0; count <= FIGHTERS[0].moves.specialNeutral.startup; count++) stepWorld(world, { 0: frame(++seq) });
  assert.equal(world.entities.filter(entity => entity.type === 'projectile').length, 2);

  player.action = null; player.actionName = 'idle'; player.projectileCooldown = 0;
  stepWorld(world, { 0: tap(++seq, BUTTONS.SPECIAL) });
  assert.equal(player.action, null);
  assert.ok(world.events.some(event => event.type === 'projectile-denied' && event.reason === 'limit'));
});

test('opposing projectiles clash while friendly team projectiles pass through', () => {
  const equal = worldWith();
  equal.entities.push(
    { id: 80, type: 'projectile', owner: 0, kind: 'arc', x: 620, y: 250, vx: 120, vy: 0, damage: 8, kx: 250, ky: 100, life: 30, radius: 24, color: '#26d9ff', hitPlayers: [] },
    { id: 81, type: 'projectile', owner: 1, kind: 'star', x: 660, y: 250, vx: -120, vy: 0, damage: 8, kx: 250, ky: 100, life: 30, radius: 24, color: '#8b5cff', hitPlayers: [] }
  );
  stepWorld(equal, { 0: frame(1), 1: frame(1) });
  assert.equal(equal.entities.length, 0);
  const equalClash = equal.events.find(event => event.type === 'projectile-clash');
  assert.ok(equalClash); assert.equal(equalClash.winner, null);

  const strong = worldWith();
  strong.entities.push(
    { id: 82, type: 'projectile', owner: 0, kind: 'core', x: 620, y: 250, vx: 120, vy: 0, damage: 18, kx: 480, ky: 200, life: 30, radius: 42, color: '#ff3b69', hitPlayers: [] },
    { id: 83, type: 'projectile', owner: 1, kind: 'arc', x: 660, y: 250, vx: -120, vy: 0, damage: 5, kx: 120, ky: 60, life: 30, radius: 18, color: '#26d9ff', hitPlayers: [] }
  );
  stepWorld(strong, { 0: frame(1), 1: frame(1) });
  assert.equal(strong.entities.length, 1);
  assert.equal(strong.entities[0].owner, 0);
  assert.ok(strong.entities[0].damage < 18 && strong.entities[0].damage >= 9);
  assert.equal(strong.events.find(event => event.type === 'projectile-clash')?.winner, 0);

  const friendly = createWorld({ rules: { mode: 'team', teams: true, stocks: 3 }, seed: 5, roster: [
    { slot: 0, clientId: 'team-a', characterId: 'volt', team: 0 },
    { slot: 1, clientId: 'team-b', characterId: 'nova', team: 0 },
    { slot: 2, clientId: 'enemy', characterId: 'blaze', team: 1 }
  ] });
  friendly.phase = 'active'; friendly.countdown = 0;
  friendly.entities.push(
    { id: 84, type: 'projectile', owner: 0, kind: 'arc', x: 620, y: 250, vx: 120, vy: 0, damage: 8, kx: 250, ky: 100, life: 30, radius: 24, hitPlayers: [] },
    { id: 85, type: 'projectile', owner: 1, kind: 'star', x: 660, y: 250, vx: -120, vy: 0, damage: 8, kx: 250, ky: 100, life: 30, radius: 24, hitPlayers: [] }
  );
  stepWorld(friendly, { 0: frame(1), 1: frame(1), 2: frame(1) });
  assert.equal(friendly.entities.length, 2);
  assert.equal(friendly.events.some(event => event.type === 'projectile-clash'), false);
});

test('Volt down special is a bounded close-range sweep instead of a persistent mine', () => {
  const volt = FIGHTERS.find(fighter => fighter.id === 'volt');
  const move = volt.moves.specialDown;
  assert.equal(move.trap, null);
  assert.equal(move.trapOnly, false);
  assert.equal(move.low, true);
  assert.ok(move.damage <= 7);

  const useSweep = distance => {
    const world = worldWith(), attacker = world.players[0], target = world.players[1];
    attacker.x = 600; target.x = attacker.x + distance;
    stepWorld(world, { 0: frame(1, BUTTONS.DOWN | BUTTONS.SPECIAL, 0, 1), 1: frame(1) });
    for (let seq = 2; seq <= move.startup + 2; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
    return { world, target };
  };
  const close = useSweep(66);
  assert.ok(close.target.damage > 0, 'close target should be hit');
  assert.equal(close.world.entities.some(entity => entity.kind === 'static'), false);
  const far = useSweep(112);
  assert.equal(far.target.damage, 0, 'distant target should stay outside the visible sweep');
});

test('Bolt side and down specials use compact body and ground-only hitboxes', () => {
  const bolt = FIGHTERS.find(fighter => fighter.id === 'bolt');
  const world = createWorld({ rules: { mode: 'training', stocks: 3 }, roster: [
    { slot: 0, clientId: 'bolt', characterId: 'bolt' },
    { slot: 1, clientId: 'dummy', characterId: 'volt' }
  ] });
  world.phase = 'active';
  const player = world.players[0];

  const side = { ...bolt.moves.specialSide };
  player.action = { name: 'specialSide', move: side, frame: side.startup, startup: side.startup, hit: [] };
  player.actionName = 'specialSide';
  let box = publicSnapshot(world).players[0].actionHitbox;
  assert.equal(box.type, 'circle');
  assert.ok(box.radius <= 57, `wheel rush radius is too large: ${box.radius}`);

  const down = { ...bolt.moves.specialDown };
  player.action = { name: 'specialDown', move: down, frame: down.startup, startup: down.startup, hit: [] };
  player.actionName = 'specialDown';
  box = publicSnapshot(world).players[0].actionHitbox;
  assert.equal(box.type, 'box');
  assert.ok(box.w <= 170 && box.h <= 36, `quake should stay low and bounded: ${box.w}x${box.h}`);
  assert.ok(box.y > player.y, 'quake should be centered near the ground');
});

test('Nova can maintain only one gravity field and recasting relocates it', () => {
  const nova = FIGHTERS.find(fighter => fighter.id === 'nova');
  const world = createWorld({ rules: { mode: 'training', stocks: 3 }, roster: [
    { slot: 0, clientId: 'nova', characterId: 'nova' },
    { slot: 1, clientId: 'dummy', characterId: 'volt' }
  ] });
  world.phase = 'active';
  const player = world.players[0], move = nova.moves.specialDown;
  const deploy = (x, seq) => {
    player.x = x;
    player.action = { name: 'specialDown', move: { ...move }, frame: move.startup - 1, startup: move.startup, hit: [], activated: false };
    player.actionName = 'specialDown';
    stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  };
  deploy(500, 1);
  assert.equal(world.entities.filter(entity => entity.kind === 'gravity').length, 1);
  const id = world.entities[0].id, firstX = world.entities[0].x;
  deploy(720, 2);
  const fields = world.entities.filter(entity => entity.kind === 'gravity');
  assert.equal(fields.length, 1);
  assert.equal(fields[0].id, id);
  assert.notEqual(fields[0].x, firstX);
  assert.ok(world.events.some(event => event.type === 'trap-relocate'));
});

test('move frame data applies damage and hitstop only after startup', () => {
  const world = worldWith();
  stepWorld(world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  assert.equal(world.players[1].damage, 0);
  for (let seq = 2; seq <= 5; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(world.players[1].damage > 0);
  assert.ok(world.players[1].hitstop > 0);
});

test('same-frame direct attacks trade without player-slot priority', () => {
  const world = worldWith(), left = world.players[0], right = world.players[1];
  const move = { ...FIGHTERS.find(fighter => fighter.id === 'volt').moves.groundNeutral };
  left.x = 620; right.x = 666; left.face = 1; right.face = -1;
  left.action = { name: 'groundNeutral', move, frame: move.startup - 1, startup: move.startup, hit: [], activated: false };
  right.action = { name: 'groundNeutral', move: { ...move }, frame: move.startup - 1, startup: move.startup, hit: [], activated: false };
  left.actionName = right.actionName = 'groundNeutral';

  stepWorld(world, { 0: frame(1), 1: frame(1) });

  assert.ok(left.damage > 0, 'later slot must still hit the earlier slot');
  assert.ok(right.damage > 0, 'earlier slot must still hit the later slot');
  assert.equal(left.damage, right.damage);
});

test('releasing a held shield opens an order-independent five-frame parry with punish advantage', () => {
  const world = worldWith();
  const attacker = world.players[0], defender = world.players[1];
  for (let seq = 1; seq <= 3; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq, BUTTONS.SHIELD) });
  const shieldBeforeParry = defender.shield;
  const attack = { ...FIGHTERS[0].moves.groundNeutral };
  attacker.action = { name: 'groundNeutral', move: attack, frame: attack.startup - 1, startup: attack.startup, hit: [], activated: false };
  attacker.actionName = 'groundNeutral';
  stepWorld(world, { 0: frame(4), 1: frame(4) });
  assert.equal(defender.damage, 0);
  assert.ok(defender.shield >= shieldBeforeParry && defender.shield <= shieldBeforeParry + .1);
  assert.ok(attacker.hitstop >= 16);
  assert.ok(defender.hitstop >= 2);
  assert.equal(defender.shieldDropLag, 0);
  assert.equal(defender.actionName, 'parrySuccess');
  assert.ok(world.events.some(event => event.type === 'parry'));

  const reversed = worldWith(), first = reversed.players[0], second = reversed.players[1];
  for (let seq = 1; seq <= 3; seq++) stepWorld(reversed, { 0: frame(seq, BUTTONS.SHIELD), 1: frame(seq) });
  const reverseAttack = { ...FIGHTERS[1].moves.groundNeutral };
  second.action = { name: 'groundNeutral', move: reverseAttack, frame: reverseAttack.startup - 1, startup: reverseAttack.startup, hit: [], activated: false };
  second.actionName = 'groundNeutral';
  stepWorld(reversed, { 0: frame(4), 1: frame(4) });
  assert.equal(first.damage, 0);
  assert.ok(second.hitstop >= 16);
  assert.ok(reversed.events.some(event => event.type === 'parry' && event.player === first.i));
});

test('a fresh shield press blocks but does not parry, while shield shifting moves the shield hurtbox', () => {
  const world = worldWith(), attacker = world.players[0], defender = world.players[1];
  const attack = { ...FIGHTERS[0].moves.groundNeutral };
  attacker.action = { name: 'groundNeutral', move: attack, frame: attack.startup - 1, startup: attack.startup, hit: [], activated: false };
  attacker.actionName = 'groundNeutral';
  stepWorld(world, { 0: frame(1), 1: frame(1, BUTTONS.SHIELD) });
  assert.equal(defender.damage, 0);
  assert.ok(defender.shield < 50);
  assert.ok(defender.shieldStun > 0);
  assert.ok(world.events.some(event => event.type === 'shield-hit'));
  assert.ok(!world.events.some(event => event.type === 'parry'));

  defender.shieldStun = 0; defender.hitstop = 0; attacker.hitstop = 0; attacker.action = null;
  stepWorld(world, { 0: frame(2), 1: frame(2, BUTTONS.SHIELD | BUTTONS.SPECIAL) });
  stepWorld(world, { 0: frame(3), 1: frame(3, BUTTONS.RIGHT | BUTTONS.SHIELD | BUTTONS.SPECIAL, 1) });
  const shieldHurtbox = publicSnapshot(world).players.find(player => player.i === defender.i).hurtboxes[0];
  assert.ok(defender.shieldOffsetX > 0);
  assert.ok(shieldHurtbox.x > defender.x);
});

test('a depleted shifted shield can be poked through an exposed body hurtbox', () => {
  const world = worldWith(), attacker = world.players[0], defender = world.players[1];
  defender.shielding = true; defender.actionName = 'shield'; defender.shield = 0.061;
  defender.shieldOffsetY = -9;
  const exposedLegY = defender.y + defender.height * .28 + Math.max(10, defender.width * .23) - 0.05;
  world.entities.push({
    id: world.nextEntityId++, type: 'projectile', kind: 'shieldPokeTest', owner: attacker.i,
    x: defender.x, y: exposedLegY, vx: 0, vy: 0, radius: 0.1,
    damage: 4, kx: 150, ky: 80, hitstop: 4, life: 5, arm: 0, hitPlayers: []
  });
  stepWorld(world, { 0: frame(1), 1: frame(1, BUTTONS.SHIELD) });
  assert.ok(defender.damage > 0);
  assert.equal(defender.shielding, false);
  assert.ok(world.events.some(event => event.type === 'hit' && event.player === defender.i));
  assert.ok(!world.events.some(event => event.type === 'shield-hit' && event.player === defender.i));
});

test('shield cancel up attacks, dash grabs, and angled side attacks use distinct frame data', () => {
  const upSmashWorld = worldWith(), upSmash = upSmashWorld.players[0];
  for (let seq = 1; seq <= 3; seq++) stepWorld(upSmashWorld, { 0: frame(seq, BUTTONS.SHIELD), 1: frame(seq) });
  stepWorld(upSmashWorld, { 0: frame(4, BUTTONS.UP | BUTTONS.SHIELD | BUTTONS.ATTACK, 0, -1), 1: frame(4) });
  assert.equal(upSmash.action?.name, 'groundUp');
  assert.equal(upSmash.action?.variant, 'smash');
  assert.equal(upSmash.shielding, false);

  const dashWorld = worldWith(), dasher = dashWorld.players[0];
  dasher.movementState = 'dash'; dasher.dashFrames = 5; dasher.dashDirection = 1; dasher.vx = 420;
  stepWorld(dashWorld, { 0: frame(1, BUTTONS.GRAB, 1), 1: frame(1) });
  assert.equal(dasher.action?.name, 'grab');
  assert.equal(dasher.action?.variant, 'dash');
  assert.equal(dasher.action?.move.startup, 7);
  assert.ok(dasher.action?.move.grabReach > 58);

  const angleWorld = worldWith(), angler = angleWorld.players[0];
  stepWorld(angleWorld, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.UP | BUTTONS.ATTACK, 1, -1), 1: frame(1) });
  stepWorld(angleWorld, { 0: frame(2, BUTTONS.RIGHT | BUTTONS.UP, 1, -1), 1: frame(2) });
  assert.equal(angler.action?.name, 'groundSide');
  assert.equal(angler.action?.variant, 'tilt');
  assert.equal(angler.action?.move.angleShift, -1);
  assert.ok(angler.action?.move.hitboxShiftY < 0);

  const shieldGrabWorld = worldWith(), shieldGrabber = shieldGrabWorld.players[0];
  for (let seq = 1; seq <= 3; seq++) stepWorld(shieldGrabWorld, { 0: frame(seq, BUTTONS.SHIELD), 1: frame(seq) });
  stepWorld(shieldGrabWorld, { 0: frame(4, BUTTONS.SHIELD | BUTTONS.GRAB), 1: frame(4) });
  assert.equal(shieldGrabber.action?.name, 'grab');
  assert.equal(shieldGrabber.action?.variant, 'shield');
});

test('shield-break stun can be mashed down without changing ordinary hitstun', () => {
  const mashed = worldWith(), dizzy = mashed.players[0];
  dizzy.stun = 60; dizzy.dizzyFrames = 60;
  stepWorld(mashed, { 0: frame(1, BUTTONS.ATTACK | BUTTONS.SPECIAL, 1, -1), 1: frame(1) });
  assert.ok(dizzy.stun < 55);
  assert.ok(mashed.events.some(event => event.type === 'stun-mash' && event.player === dizzy.i));

  const ordinary = worldWith(), hit = ordinary.players[0];
  hit.stun = 60; hit.dizzyFrames = 0;
  stepWorld(ordinary, { 0: frame(1, BUTTONS.ATTACK | BUTTONS.SPECIAL, 1, -1), 1: frame(1) });
  assert.equal(hit.stun, 59);
});

test('jumping above an opponent performs a footstool without spending an air jump', () => {
  const world = worldWith(), jumper = world.players[0], target = world.players[1];
  jumper.grounded = false; jumper.platformId = null; jumper.coyoteFrames = 0; jumper.jumps = 1;
  target.grounded = false; target.platformId = null; target.action = null; target.stun = 0;
  jumper.x = target.x = 640; target.y = 400; jumper.y = target.y - target.height / 2 - jumper.height / 2 + 4;
  stepWorld(world, { 0: frame(1, BUTTONS.UP, 0, -1), 1: frame(1) });
  assert.ok(jumper.vy < -500);
  assert.equal(jumper.jumps, 1);
  assert.equal(jumper.actionName, 'footstool');
  assert.ok(target.tumbling);
  assert.ok(target.stun >= 17);
  assert.ok(world.events.some(event => event.type === 'footstool'));
});

test('a new ledge grab trumps the current holder instead of being blocked', () => {
  const world = worldWith(), holder = world.players[0], challenger = world.players[1], platform = world.platforms[0];
  const ledgeX = platform.x;
  holder.grounded = false; holder.platformId = null; holder.ledge = { platformId: platform.id, x: ledgeX, y: platform.y, face: 1 };
  holder.x = ledgeX - 16; holder.y = platform.y + 20; holder.invincible = 20; holder.ledgeInvincible = 20;
  challenger.grounded = false; challenger.platformId = null; challenger.coyoteFrames = 0; challenger.ledge = null;
  challenger.x = ledgeX; challenger.y = platform.y + 8; challenger.vx = 0; challenger.vy = 20; challenger.ledgeGrabs = 0;
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.equal(holder.ledge, null);
  assert.equal(holder.actionName, 'ledgeTrumped');
  assert.ok(challenger.ledge);
  assert.equal(challenger.ledge.platformId, platform.id);
  assert.ok(world.events.some(event => event.type === 'ledge-trump'));
});

test('two-player itemless matches apply the Ultimate-style 1.2 damage multiplier only to damage', () => {
  const duel = worldWith(), duelTarget = duel.players[1];
  duel.entities.push({ id: 900, type: 'projectile', owner: 0, kind: 'duel-test', x: duelTarget.x, y: duelTarget.y, vx: 0, vy: 0, damage: 10, kx: 1, ky: 1, life: 5, radius: 30, hitPlayers: [] });
  stepWorld(duel, { 0: frame(1), 1: frame(1) });
  assert.equal(duelTarget.damage, 12.6);

  const group = createWorld({ rules: { mode: 'stock', stocks: 3, items: false }, roster: [
    { slot: 0, clientId: 'p0', characterId: 'volt' },
    { slot: 1, clientId: 'p1', characterId: 'blaze' },
    { slot: 2, clientId: 'p2', characterId: 'nova' }
  ] });
  group.phase = 'active'; group.countdown = 0;
  const groupTarget = group.players[1];
  group.players.forEach(player => { player.invincible = 0; player.grounded = false; player.y = 350; });
  group.players[0].x = 400; groupTarget.x = 650; group.players[2].x = 1000;
  group.entities.push({ id: 901, type: 'projectile', owner: 0, kind: 'group-test', x: groupTarget.x, y: groupTarget.y, vx: 0, vy: 0, damage: 10, kx: 1, ky: 1, life: 5, radius: 30, hitPlayers: [] });
  stepWorld(group, { 0: frame(1), 1: frame(1), 2: frame(1) });
  assert.equal(groupTarget.damage, 10.5);
});

test('fighters lingering outside the camera take magnifying-glass damage outside training', () => {
  const world = worldWith(), player = world.players[0];
  player.x = -60; player.y = 250; player.vx = 0; player.vy = 0; player.grounded = false; player.platformId = null;
  for (let seq = 1; seq <= 60; seq++) {
    player.y = 250; player.vy = 0;
    stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  }
  assert.equal(player.damage, 1);
  assert.ok(world.events.some(event => event.type === 'offscreen-damage'));
});

test('charged side attack scales above its base damage', () => {
  const normal = worldWith();
  stepWorld(normal, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(1) });
  stepWorld(normal, { 0: frame(2, BUTTONS.RIGHT, 1), 1: frame(2) });
  for (let seq = 3; seq < 35; seq++) stepWorld(normal, { 0: frame(seq), 1: frame(seq) });
  const normalDamage = normal.players[1].damage;

  const charged = worldWith();
  stepWorld(charged, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(1) });
  for (let seq = 2; seq <= 35; seq++) stepWorld(charged, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(seq) });
  const chargingSnapshot = publicSnapshot(charged).players[0];
  assert.ok(chargingSnapshot.chargeFrames >= 10);
  stepWorld(charged, { 0: frame(36, BUTTONS.RIGHT, 1), 1: frame(36) });
  assert.ok(publicSnapshot(charged).players[0].chargeScale > 1);
  for (let seq = 37; seq < 75; seq++) stepWorld(charged, { 0: frame(seq), 1: frame(seq) });
  assert.ok(charged.players[1].damage > normalDamage);
});

test('short attack taps create tilts, holding Z creates a smash, and X remains a special', () => {
  const jab = worldWith();
  stepWorld(jab, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  assert.equal(jab.players[0].action, null, 'grounded Z waits briefly to distinguish a jab from a smash hold');
  stepWorld(jab, { 0: frame(2), 1: frame(2) });
  assert.equal(jab.players[0].action?.name, 'groundNeutral');
  assert.equal(jab.players[0].action?.variant, 'normal');

  const tilt = worldWith();
  stepWorld(tilt, { 0: frame(1, BUTTONS.DOWN, 0, 1), 1: frame(1) });
  for (let seq = 2; seq <= 8; seq++) {
    stepWorld(tilt, { 0: frame(seq, BUTTONS.DOWN | BUTTONS.ATTACK, 0, 1), 1: frame(seq) });
    assert.equal(tilt.players[0].action, null, 'a seven-frame down Z hold must remain eligible for tilt');
  }
  stepWorld(tilt, { 0: frame(9, BUTTONS.DOWN, 0, 1), 1: frame(9) });
  assert.equal(tilt.players[0].action?.name, 'groundDown');
  assert.equal(tilt.players[0].action?.variant, 'tilt');
  assert.equal(tilt.players[0].action?.move.staleKey, 'groundDown:tilt');
  assert.equal(tilt.players[0].action?.move.chargeable, false);

  const sideTilt = worldWith();
  for (let seq = 1; seq <= 13; seq++) {
    stepWorld(sideTilt, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(seq) });
    assert.equal(sideTilt.players[0].action, null, 'a thirteen-frame Z hold must not charge accidentally');
  }
  stepWorld(sideTilt, { 0: frame(14, BUTTONS.RIGHT, 1), 1: frame(14) });
  assert.equal(sideTilt.players[0].action?.name, 'groundSide');
  assert.equal(sideTilt.players[0].action?.variant, 'tilt');

  const smash = worldWith();
  stepWorld(smash, { 0: frame(1, BUTTONS.DOWN | BUTTONS.ATTACK, 0, 1), 1: frame(1) });
  for (let seq = 2; seq <= 13; seq++) stepWorld(smash, { 0: frame(seq, BUTTONS.DOWN | BUTTONS.ATTACK, 0, 1), 1: frame(seq) });
  assert.equal(smash.players[0].action, null);
  stepWorld(smash, { 0: frame(14, BUTTONS.DOWN | BUTTONS.ATTACK, 0, 1), 1: frame(14) });
  assert.equal(smash.players[0].action?.name, 'groundDown');
  assert.equal(smash.players[0].action?.variant, 'smash');
  assert.equal(smash.players[0].action?.move.staleKey, 'groundDown:smash');
  assert.equal(smash.players[0].action?.move.chargeable, true);
  assert.equal(smash.players[0].action?.charging, true);
  assert.ok(smash.players[0].action.move.damage > tilt.players[0].action.move.damage);
  assert.equal(publicSnapshot(smash).players[0].actionVariant, 'smash');

  const neutralSmash = worldWith();
  for (let seq = 1; seq <= 14; seq++) {
    stepWorld(neutralSmash, { 0: frame(seq, BUTTONS.ATTACK), 1: frame(seq) });
  }
  assert.equal(neutralSmash.players[0].action?.name, 'groundSide');
  assert.equal(neutralSmash.players[0].action?.variant, 'smash');
  assert.equal(neutralSmash.players[0].action?.charging, true);

  const dashAttack = worldWith(), dasher = dashAttack.players[0];
  dasher.movementState = 'dash'; dasher.dashFrames = 6; dasher.dashDirection = 1; dasher.vx = 430;
  stepWorld(dashAttack, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(1) });
  assert.equal(dasher.action?.name, 'dashAttack');
  assert.equal(dasher.action?.frame, 0, 'dash Z must be created on the press frame without a hold gate');

  const specialButton = worldWith();
  stepWorld(specialButton, { 0: frame(1, BUTTONS.SPECIAL), 1: frame(1) });
  assert.equal(specialButton.players[0].action?.name, 'specialNeutral');
  assert.equal(specialButton.players[0].action?.variant, 'normal');
  for (let seq = 2; seq <= 8; seq++) stepWorld(specialButton, { 0: frame(seq, BUTTONS.SPECIAL), 1: frame(seq) });
  assert.equal(specialButton.players[0].action?.name, 'specialNeutral');
});

test('full smash charge caps at 1.4x and releases automatically', () => {
  const world = worldWith();
  const baseDamage = FIGHTERS[0].moves.groundSide.damage;
  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(1) });
  for (let seq = 2; seq <= 100; seq++) {
    stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(seq) });
    if (world.players[0].action?.charged) break;
  }
  const action = world.players[0].action;
  assert.ok(action);
  assert.equal(action.variant, 'smash');
  assert.equal(action.charged, true);
  assert.equal(action.charging, false);
  assert.equal(action.chargeScale, 1.4);
  assert.ok(Math.abs(action.move.damage - baseDamage * 1.4) < 1e-9);
});

test('ground attacks keep jab, tilt, smash, and dash-attack roles distinct', () => {
  for (const fighter of FIGHTERS) {
    const jab = fighter.moves.groundNeutral;
    const side = fighter.moves.groundSide;
    const dash = fighter.moves.dashAttack;
    assert.ok(jab.startup < side.startup, `${fighter.id} jab should start before side smash`);
    assert.ok(jab.damage < side.damage, `${fighter.id} jab should be weaker than side smash`);
    assert.ok(dash.dash === 'attack', `${fighter.id} dash attack should carry forward`);
    assert.ok(dash.active >= 5, `${fighter.id} dash attack should have a lasting hitbox`);
    assert.ok(dash.recovery >= 10, `${fighter.id} dash attack should be punishable on whiff`);
  }

  const world = worldWith();
  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT, 1), 1: frame(1) });
  stepWorld(world, { 0: frame(2, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(2) });
  stepWorld(world, { 0: frame(3, BUTTONS.RIGHT, 1), 1: frame(3) });
  const tilt = world.players[0].action;
  assert.equal(tilt?.variant, 'tilt');
  assert.ok(tilt.move.startup < FIGHTERS[0].moves.groundSide.startup);
  assert.ok(tilt.move.damage < FIGHTERS[0].moves.groundSide.damage);
  assert.ok(tilt.move.reachX < FIGHTERS[0].moves.groundSide.reachX);
});

test('aerial attacks preserve Ultimate-style directional roles', () => {
  for (const fighter of FIGHTERS) {
    const { airNeutral: nair, airForward: fair, airBack: bair, airUp: uair, airDown: dair } = fighter.moves;
    assert.equal(nair.radial, true, `${fighter.id} NAir should cover the body`);
    assert.ok(nair.active >= fair.active, `${fighter.id} NAir should linger at least as long as FAir`);
    assert.equal(bair.backward, true, `${fighter.id} BAir should strike behind`);
    assert.ok(bair.damage >= fair.damage, `${fighter.id} BAir should be a finisher`);
    assert.equal(uair.vertical, true, `${fighter.id} UAir should aim upward`);
    assert.ok(uair.ky > Math.abs(uair.kx), `${fighter.id} UAir should launch upward`);
    assert.equal(dair.downward, true, `${fighter.id} DAir should aim downward`);
    assert.equal(dair.meteor, true, `${fighter.id} DAir should meteor`);
    assert.ok(dair.recovery >= fair.recovery, `${fighter.id} DAir should carry greater commitment`);
    assert.ok(dair.landingLag >= nair.landingLag, `${fighter.id} DAir should have meaningful landing lag`);
  }
});

test('X selects four grounded and airborne specials while Z plus X stays ultimate', () => {
  const directions = [
    { buttons: BUTTONS.SPECIAL, horizontal: 0, vertical: 0, name: 'specialNeutral' },
    { buttons: BUTTONS.RIGHT | BUTTONS.SPECIAL, horizontal: 1, vertical: 0, name: 'specialSide' },
    { buttons: BUTTONS.UP | BUTTONS.SPECIAL, horizontal: 0, vertical: -1, name: 'specialUp' },
    { buttons: BUTTONS.DOWN | BUTTONS.SPECIAL, horizontal: 0, vertical: 1, name: 'specialDown' }
  ];
  for (const airborne of [false, true]) for (const direction of directions) {
    const world = worldWith(), player = world.players[0];
    if (airborne) {
      player.grounded = false; player.platformId = null; player.coyoteFrames = 0; player.y = 300;
    }
    stepWorld(world, { 0: frame(1, direction.buttons, direction.horizontal, direction.vertical), 1: frame(1) });
    assert.equal(player.action?.name, direction.name, `${airborne ? 'air' : 'ground'} ${direction.name}`);
    assert.equal(player.action?.startedAirborne, airborne);
  }

  const ultimate = worldWith(), player = ultimate.players[0];
  player.ultimateMeter = 100;
  stepWorld(ultimate, { 0: frame(1, BUTTONS.ATTACK | BUTTONS.SPECIAL), 1: frame(1) });
  assert.equal(player.action?.name, 'ultimate');
});

test('neutral specials support pre-input momentum reversal and post-input turnaround', () => {
  const reverse = worldWith(), reverser = reverse.players[0];
  reverser.grounded = false; reverser.platformId = null; reverser.coyoteFrames = 0;
  reverser.face = 1; reverser.vx = 260; reverser.y = 300;
  stepWorld(reverse, { 0: frame(1, BUTTONS.LEFT, -1), 1: frame(1) });
  stepWorld(reverse, { 0: frame(2, BUTTONS.SPECIAL), 1: frame(2) });
  assert.equal(reverser.action?.name, 'specialNeutral');
  assert.equal(reverser.action?.specialTurnaround, 'momentum');
  assert.equal(reverser.face, -1);
  assert.ok(reverser.vx < 0);
  assert.ok(reverse.events.some(event => event.type === 'special-turnaround' && event.kind === 'momentum'));

  const turnaround = worldWith(), turner = turnaround.players[0];
  turner.grounded = false; turner.platformId = null; turner.coyoteFrames = 0;
  turner.face = 1; turner.vx = 240; turner.y = 300;
  stepWorld(turnaround, { 0: frame(1, BUTTONS.SPECIAL), 1: frame(1) });
  stepWorld(turnaround, { 0: frame(2, BUTTONS.LEFT, -1), 1: frame(2) });
  assert.equal(turner.action?.name, 'specialNeutral');
  assert.equal(turner.action?.specialTurnaround, 'direction');
  assert.equal(turner.face, -1);
  assert.ok(turner.vx > 0, 'post-input turnaround should preserve momentum');
  assert.ok(turnaround.events.some(event => event.type === 'special-turnaround' && event.kind === 'direction'));
});

test('directional specials may turn during their first four startup frames', () => {
  const world = worldWith(), player = world.players[0];
  player.grounded = false; player.platformId = null; player.coyoteFrames = 0; player.face = 1; player.y = 300;
  stepWorld(world, { 0: frame(1, BUTTONS.UP | BUTTONS.SPECIAL, 0, -1), 1: frame(1) });
  assert.equal(player.action?.name, 'specialUp');
  stepWorld(world, { 0: frame(2, BUTTONS.LEFT, -1), 1: frame(2) });
  assert.equal(player.face, -1);
  assert.equal(player.action?.inputHorizontal, -1);
  assert.equal(player.action?.specialTurnaround, 'direction');
});

test('fast fall, air dodge, landing reset, and ledge grabbing work', () => {
  const world = worldWith();
  const player = world.players[0];
  player.grounded = false; player.y = 320; player.vy = 100;
  stepWorld(world, { 0: frame(1, BUTTONS.DOWN, 0, 1), 1: frame(1) });
  assert.equal(player.fastFalling, true);
  stepWorld(world, { 0: frame(2, BUTTONS.SHIELD | BUTTONS.RIGHT, 1), 1: frame(2) });
  assert.equal(player.airDodgeAvailable, false);
  assert.ok(player.invincible > 0);

  player.stun = 0; player.x = world.platforms[0].x - 8; player.y = world.platforms[0].y + 5; player.vy = 90; player.grounded = false;
  stepWorld(world, { 0: frame(3), 1: frame(3) });
  assert.ok(player.ledge);
});

test('platform drop starts only from a controllable platform stand and hitstun still lands', () => {
  const deliberate = worldWith(), dropper = deliberate.players[0];
  const upper = deliberate.platforms.find(platform => platform.passThrough);
  dropper.x = upper.x + upper.w / 2; dropper.y = upper.y - dropper.height / 2;
  dropper.grounded = true; dropper.platformId = upper.id; dropper.lastInput = frame(0);
  stepWorld(deliberate, { 0: frame(1, BUTTONS.DOWN, 0, 1), 1: frame(1) });
  assert.equal(dropper.grounded, false);
  assert.ok(dropper.dropThroughFrames > 0);
  assert.ok(dropper.y + dropper.height / 2 > upper.y);

  const hit = worldWith(), victim = hit.players[0];
  const hitPlatform = hit.platforms.find(platform => platform.passThrough);
  victim.x = hitPlatform.x + hitPlatform.w / 2;
  victim.y = hitPlatform.y - victim.height / 2 - 2;
  victim.grounded = false; victim.platformId = null; victim.vy = 240;
  victim.stun = 12; victim.tumbling = true; victim.actionName = 'tumble'; victim.lastInput = frame(0);
  stepWorld(hit, { 0: frame(1, BUTTONS.DOWN, 0, 1), 1: frame(1) });
  assert.equal(victim.grounded, true);
  assert.equal(victim.platformId, hitPlatform.id);
  assert.equal(victim.y, hitPlatform.y - victim.height / 2);
});

test('being hit while pressing down cannot slip a fighter through a platform by update order', () => {
  const world = worldWith(), victim = world.players[0], attacker = world.players[1];
  const upper = world.platforms.find(platform => platform.passThrough);
  victim.x = upper.x + upper.w / 2; victim.y = upper.y - victim.height / 2;
  victim.grounded = true; victim.platformId = upper.id; victim.lastInput = frame(0);
  attacker.x = victim.x + 58; attacker.y = upper.y - attacker.height / 2;
  attacker.grounded = true; attacker.platformId = upper.id; attacker.face = -1;
  const source = FIGHTERS.find(fighter => fighter.id === attacker.characterId).moves.groundNeutral;
  const move = { ...source, groundedFlinch: true, ky: 0, hitstun: 12 };
  attacker.action = { name: 'groundNeutral', move, frame: move.startup - 1, startup: move.startup, hit: [], activated: false };
  attacker.actionName = 'groundNeutral';

  stepWorld(world, { 0: frame(1, BUTTONS.DOWN, 0, 1), 1: frame(1) });
  assert.ok(victim.damage > 0);
  assert.equal(victim.dropThroughFrames, 0);
  assert.equal(victim.y, upper.y - victim.height / 2);
  assert.equal(victim.platformId, upper.id);
  stepWorld(world, { 0: frame(2, BUTTONS.DOWN, 0, 1), 1: frame(2) });
  assert.equal(victim.grounded, true);
  assert.equal(victim.y, upper.y - victim.height / 2);
});

test('jump-attack macros short hop into an aerial while directional up attacks stay grounded', () => {
  const hop = worldWith(), hopper = hop.players[0];
  stepWorld(hop, { 0: frame(1, BUTTONS.UP | BUTTONS.ATTACK), 1: frame(1) });
  assert.equal(hopper.actionName, 'jumpSquat'); assert.equal(hopper.jumpSquatFrames, 3); assert.equal(hopper.grounded, true);
  for (let seq = 2; seq <= 4; seq++) stepWorld(hop, { 0: frame(seq), 1: frame(seq) });
  assert.equal(hopper.action?.name, 'airNeutral'); assert.equal(hopper.grounded, false); assert.ok(hopper.vy < -400); assert.equal(hopper.jumps, 1);

  const upAttack = worldWith(), fighter = upAttack.players[0];
  stepWorld(upAttack, { 0: tap(1, BUTTONS.ATTACK, BUTTONS.UP, 0, -1), 1: frame(1) });
  assert.equal(fighter.action?.name, 'groundUp'); assert.equal(fighter.grounded, true); assert.equal(fighter.jumpBuffer, 0);
});

test('ground jumps use a three-frame squat and releasing jump during it creates a short hop', () => {
  const full = worldWith(), fullJumper = full.players[0];
  for (let seq = 1; seq <= 4; seq++) stepWorld(full, { 0: frame(seq, BUTTONS.UP), 1: frame(seq) });
  assert.equal(fullJumper.grounded, false); const fullVelocity = fullJumper.vy;

  const short = worldWith(), shortJumper = short.players[0];
  stepWorld(short, { 0: frame(1, BUTTONS.UP), 1: frame(1) });
  for (let seq = 2; seq <= 4; seq++) stepWorld(short, { 0: frame(seq), 1: frame(seq) });
  assert.equal(shortJumper.grounded, false); assert.ok(shortJumper.vy > fullVelocity); assert.ok(shortJumper.vy < -450);
});

test('aerial direction preserves facing and selects distinct forward and back aerials', () => {
  const back = worldWith(), backPlayer = back.players[0];
  backPlayer.grounded = false; backPlayer.y = 300; backPlayer.face = 1;
  stepWorld(back, { 0: frame(1, BUTTONS.LEFT | BUTTONS.ATTACK, -1), 1: frame(1) });
  assert.equal(backPlayer.action?.name, 'airBack'); assert.equal(backPlayer.face, 1);

  const forward = worldWith(), forwardPlayer = forward.players[0];
  forwardPlayer.grounded = false; forwardPlayer.y = 300; forwardPlayer.face = 1;
  stepWorld(forward, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(1) });
  assert.equal(forwardPlayer.action?.name, 'airForward'); assert.equal(forwardPlayer.face, 1);
});

test('repeated neutral attacks progress through a three-hit jab sequence', () => {
  const world = worldWith(), player = world.players[0];
  world.players[1].x = 900;
  stepWorld(world, { 0: tap(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 11; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(player.jabStep, 1); assert.ok(player.jabTimer > 0);
  stepWorld(world, { 0: tap(12, BUTTONS.ATTACK), 1: frame(12) });
  assert.equal(player.action?.name, 'groundJab2');
  for (let seq = 13; seq <= 23; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(player.jabStep, 2); assert.ok(player.jabTimer > 0);
  stepWorld(world, { 0: tap(24, BUTTONS.ATTACK), 1: frame(24) });
  assert.equal(player.action?.name, 'groundJab3');
});

test('jab starters cause grounded flinch while finishers launch and tumble', () => {
  const jab = worldWith(), jabTarget = jab.players[1];
  stepWorld(jab, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 4; seq++) stepWorld(jab, { 0: frame(seq), 1: frame(seq) });
  assert.equal(jabTarget.grounded, true);
  assert.equal(jabTarget.tumbling, false);
  assert.equal(jabTarget.vy, 0);
  assert.ok(Math.abs(jabTarget.vx) < 90);
  assert.ok(jabTarget.stun <= 10);

  const finisher = worldWith(), finisherTarget = finisher.players[1];
  finisher.players[0].jabStep = 2; finisher.players[0].jabTimer = 12;
  stepWorld(finisher, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 7; seq++) stepWorld(finisher, { 0: frame(seq), 1: frame(seq) });
  assert.equal(finisherTarget.grounded, false);
  assert.equal(finisherTarget.tumbling, true);
  assert.ok(Math.hypot(finisherTarget.vx, finisherTarget.vy) > 150);
});

test('grounded flinch settles into a braced hit pose instead of airborne tumble', () => {
  const world = worldWith(), target = world.players[1];
  let seq = 1;
  stepWorld(world, { 0: frame(seq, BUTTONS.ATTACK), 1: frame(seq) });
  while (!target.hitstop && seq < 10) {
    seq += 1;
    stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  }
  while (target.hitstop > 0) {
    seq += 1;
    stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  }
  seq += 1;
  stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(target.grounded, true);
  assert.equal(target.tumbling, false);
  assert.equal(target.actionName, 'groundHit');
});

test('jab knockback grows slowly with damage while strong attacks retain launch growth', () => {
  const lowJab = worldWith(), highJab = worldWith();
  highJab.players[1].damage = 120;
  for (const world of [lowJab, highJab]) {
    stepWorld(world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
    for (let seq = 2; seq <= 4; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  }
  const jabGrowth = Math.abs(highJab.players[1].vx) / Math.max(1, Math.abs(lowJab.players[1].vx));
  assert.ok(jabGrowth < 1.25);

  const lowStrong = worldWith(), highStrong = worldWith();
  highStrong.players[1].damage = 120;
  for (const world of [lowStrong, highStrong]) {
    stepWorld(world, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(1) });
    stepWorld(world, { 0: frame(2, BUTTONS.RIGHT, 1), 1: frame(2) });
    for (let seq = 3; seq <= 10; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  }
  const lowSpeed = Math.hypot(lowStrong.players[1].vx, lowStrong.players[1].vy);
  const highSpeed = Math.hypot(highStrong.players[1].vx, highStrong.players[1].vy);
  assert.ok(highSpeed > lowSpeed * 1.8);
});

test('high-damage strong hits emit a critical launch with extended hitstop', () => {
  const world = worldWith(), target = world.players[1];
  target.damage = 150;
  for (let seq = 1; seq <= 8; seq++) stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(seq) });
  stepWorld(world, { 0: frame(9, BUTTONS.RIGHT, 1), 1: frame(9) });
  for (let seq = 10; seq <= 16 && !world.events.some(event => event.type === 'hit' && event.player === target.i); seq++) {
    stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  }
  const hit = world.events.find(event => event.type === 'hit' && event.player === target.i);
  assert.ok(hit?.critical); assert.ok(hit.launchSpeed >= 720); assert.ok(Number.isFinite(hit.launchAngle));
  assert.ok(target.hitstop >= 8); assert.ok(target.launchDecay > 6);
});

test('high-percent finishers retain enough launch momentum to travel a visibly greater distance', () => {
  const launchAt = damage => {
    const world = worldWith(), target = world.players[1];
    target.damage = damage;
    for (let seq = 1; seq <= 11; seq++) stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(seq) });
    stepWorld(world, { 0: frame(12, BUTTONS.RIGHT, 1), 1: frame(12) });
    let seq = 13;
    while (seq <= 24 && !world.events.some(event => event.type === 'hit' && event.player === target.i)) {
      stepWorld(world, { 0: frame(seq), 1: frame(seq) }); seq += 1;
    }
    const hit = world.events.find(event => event.type === 'hit' && event.player === target.i);
    const startX = target.x;
    let farthestX = startX;
    let finisherFrames = 0;
    let maxAngleDrift = 0;
    const launchAngle = Math.atan2(target.vy, target.vx);
    for (let count = 0; count < 42; count++, seq++) {
      stepWorld(world, { 0: frame(seq), 1: frame(seq) });
      farthestX = Math.max(farthestX, target.x);
      if (target.criticalFlightFrames > 0 && target.hitstop === 0) {
        finisherFrames += 1;
        const angle = Math.atan2(target.vy, target.vx);
        maxAngleDrift = Math.max(maxAngleDrift, Math.abs(Math.atan2(Math.sin(angle - launchAngle), Math.cos(angle - launchAngle))));
      }
    }
    return { distance: farthestX - startX, launchSpeed: hit?.launchSpeed || 0, finisherFlight: hit?.finisherFlight, finisherFrames, maxAngleDrift };
  };
  const fresh = launchAt(0), high = launchAt(180);
  assert.ok(high.launchSpeed > 900, `expected a fast high-percent launch, got ${high.launchSpeed}`);
  assert.equal(high.finisherFlight, true);
  assert.ok(high.finisherFrames >= 8, `expected a sustained straight finisher burst, got ${high.finisherFrames} frames`);
  assert.ok(high.maxAngleDrift < 0.002, `expected the opening launch angle to stay straight, drifted ${high.maxAngleDrift}`);
  assert.ok(high.distance > 300, `expected travel above 300px, got ${high.distance}`);
  assert.ok(high.distance > fresh.distance * 1.65, `expected clear percent scaling: ${high.distance} vs ${fresh.distance}`);
});

test('expanded blast zones leave room to recover before a real knockout', () => {
  const world = worldWith(), player = world.players[0], stocks = player.stocks;
  player.grounded = false; player.platformId = null; player.coyoteFrames = 0; player.x = -250; player.y = 450; player.vx = 0; player.vy = 0;
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.equal(player.stocks, stocks); assert.equal(player.respawn, 0);
  player.x = -BLAST_MARGIN_X - 2;
  stepWorld(world, { 0: frame(2), 1: frame(2) });
  assert.equal(player.stocks, stocks - 1); assert.ok(player.respawn > 0);
});

test('the damage dealt by the current hit contributes to that hit knockback', () => {
  const launch = damage => {
    const world = worldWith(), attacker = world.players[0], target = world.players[1];
    attacker.x = 500; target.x = 700;
    target.grounded = false; target.platformId = null; target.damage = 0;
    world.entities.push({
      id: 700 + damage, type: 'projectile', owner: attacker.i, kind: `knockback-${damage}`,
      x: target.x, y: target.y, vx: 0, vy: 0, damage, kx: 300, ky: 150,
      knockbackGrowth: 1, life: 5, radius: 28, hitPlayers: []
    });
    stepWorld(world, { 0: frame(1), 1: frame(1) });
    return world.events.find(event => event.type === 'hit' && event.player === target.i)?.launchSpeed || 0;
  };
  assert.ok(launch(20) > launch(2) * 1.15);
});

test('upper blast-zone KOs deterministically choose star or screen styles with a longer delay', () => {
  for (const [roll, style] of [[.1, 'star'], [.5, 'screen'], [.9, 'blast']]) {
    const world = worldWith(), player = world.players[0];
    world.rng = () => roll;
    player.grounded = false; player.platformId = null; player.y = BLAST_TOP - 2; player.vy = -50;
    stepWorld(world, { 0: frame(1), 1: frame(1) });
    const ko = world.events.find(event => event.type === 'ko' && event.player === player.i);
    assert.equal(ko?.style, style);
    assert.equal(player.respawn, style === 'blast' ? 90 : 150);
  }
});

test('respawn uses a two-second platform whose remaining time is also invincibility', () => {
  const world = worldWith(), player = world.players[0];
  player.damage = 180; player.staleQueue = Array(9).fill('groundSide'); player.dodgeFatigue = 4;
  player.grounded = false; player.platformId = null; player.x = -BLAST_MARGIN_X - 2;
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  for (let seq = 2; seq <= 91; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(player.damage, 0);
  assert.equal(player.respawnPlatformFrames, 120);
  assert.equal(player.invincible, 120);
  assert.equal(player.staleQueue.length, 0);
  assert.equal(player.dodgeFatigue, 0);

  for (let seq = 92; seq <= 121; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(player.respawnPlatformFrames, 90);
  assert.equal(player.invincible, 90);
  stepWorld(world, { 0: frame(122, BUTTONS.RIGHT, 1), 1: frame(122) });
  assert.equal(player.respawnPlatformFrames, 0);
  assert.equal(player.grounded, false);
  assert.equal(player.invincible, 89);
});

test('an offstage fighter can steer an up special back toward the stage', () => {
  const world = worldWith(), player = world.players[0], stocks = player.stocks;
  player.grounded = false; player.platformId = null; player.coyoteFrames = 0; player.jumps = 1;
  player.x = -230; player.y = 560; player.vx = -35; player.vy = 90; player.face = -1;
  const startX = player.x, startY = player.y;
  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.UP | BUTTONS.SPECIAL, 1, -1), 1: frame(1) });
  for (let seq = 2; seq <= 44; seq++) stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT, 1), 1: frame(seq) });
  assert.ok(player.x > startX + 100); assert.ok(player.y < startY); assert.equal(player.stocks, stocks); assert.equal(player.recoveryAvailable, false);
});

test('aerial attacks preserve drift and fast fall but completed aerials do not leave stale landing lag', () => {
  const world = worldWith(), player = world.players[0], platform = world.platforms[0];
  player.grounded = false; player.platformId = null; player.y = 220; player.vy = -40; player.vx = 0;
  stepWorld(world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 7; seq++) stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT, 1), 1: frame(seq) });
  assert.equal(player.action?.name, 'airNeutral'); assert.ok(player.vx > 60);
  player.vy = 100;
  stepWorld(world, { 0: frame(8, BUTTONS.DOWN, 0, 1), 1: frame(8) });
  assert.equal(player.fastFalling, true);
  for (let seq = 9; seq <= 35; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(player.action, null); assert.equal(player.pendingLandingLag, 0);
  player.y = platform.y - player.height / 2 - 2; player.vy = 240; player.fastFalling = false;
  stepWorld(world, { 0: frame(36), 1: frame(36) });
  assert.equal(player.grounded, true); assert.ok(player.landingLag <= 4); assert.equal(player.actionName, 'landing');
});

test('aerials auto-cancel during their opening frames but retain move landing lag while active', () => {
  const early = worldWith(), earlyPlayer = early.players[0], platform = early.platforms[0];
  earlyPlayer.grounded = false; earlyPlayer.y = platform.y - earlyPlayer.height / 2 - 2; earlyPlayer.vy = 240;
  stepWorld(early, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  assert.equal(earlyPlayer.grounded, true); assert.ok(earlyPlayer.landingLag <= 4);

  const active = worldWith(), activePlayer = active.players[0], move = FIGHTERS[0].moves.airNeutral;
  activePlayer.grounded = false; activePlayer.y = active.platforms[0].y - activePlayer.height / 2 - 2; activePlayer.vy = 240;
  activePlayer.action = { name: 'airNeutral', move: { ...move }, frame: move.startup - 1, hit: [], startup: move.startup };
  activePlayer.actionName = 'airNeutral';
  stepWorld(active, { 0: frame(1), 1: frame(1) });
  assert.equal(activePlayer.grounded, true); assert.equal(activePlayer.landingLag, move.landingLag);
});

test('shield transitions directly into rolls and jumps without requiring a shield repress', () => {
  const rolling = worldWith(), roller = rolling.players[0];
  stepWorld(rolling, { 0: frame(1, BUTTONS.SHIELD), 1: frame(1) });
  stepWorld(rolling, { 0: frame(2, BUTTONS.SHIELD | BUTTONS.RIGHT, 1), 1: frame(2) });
  assert.equal(roller.actionName, 'roll'); assert.ok(roller.dodgeFrames > 0);

  const jumping = worldWith(), jumper = jumping.players[0];
  stepWorld(jumping, { 0: frame(1, BUTTONS.SHIELD), 1: frame(1) });
  stepWorld(jumping, { 0: frame(2, BUTTONS.SHIELD | BUTTONS.UP), 1: frame(2) });
  assert.equal(jumper.shielding, false); assert.equal(jumper.actionName, 'jumpSquat'); assert.equal(jumper.grounded, true);
  for (let seq = 3; seq <= 5; seq++) stepWorld(jumping, { 0: frame(seq, BUTTONS.UP), 1: frame(seq) });
  assert.equal(jumper.grounded, false); assert.ok(jumper.vy < -400);
});

test('shield uses 50 durability while preserving proportional shrink and regeneration', () => {
  const world = worldWith(), player = world.players[0];
  assert.equal(player.shield, 50);
  player.shield = 25;
  player.shielding = true;
  const shield = publicSnapshot(world).players[0].hurtboxes[0];
  const expectedScale = .58 + .42 * .5;
  assert.ok(Math.abs(shield.radius - Math.max(player.width * .9 + 15, player.height * .75 + 12) * expectedScale) < .001);
  player.shielding = false;
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.ok(player.shield > 25 && player.shield <= 50);

  player.shield = .05;
  stepWorld(world, { 0: frame(2, BUTTONS.SHIELD), 1: frame(2) });
  assert.equal(player.shielding, false);
  assert.ok(player.dizzyFrames > 0);
  const shieldBreak = world.events.find(event => event.type === 'shield-break');
  assert.ok(shieldBreak);
  assert.ok(Number.isFinite(shieldBreak.x) && Number.isFinite(shieldBreak.y));
  assert.ok(shieldBreak.radius >= player.height * .75);
});

test('shield and dodge inputs buffered during end lag execute on the first free frame', () => {
  const shield = worldWith(), defender = shield.players[0];
  defender.landingLag = 5;
  for (let seq = 1; seq <= 5; seq++) stepWorld(shield, { 0: frame(seq, BUTTONS.SHIELD), 1: frame(seq) });
  assert.equal(defender.landingLag, 0); assert.equal(defender.shielding, true);

  const dodge = worldWith(), dodger = dodge.players[0];
  dodger.landingLag = 5;
  for (let seq = 1; seq <= 5; seq++) stepWorld(dodge, { 0: frame(seq, BUTTONS.SHIELD | BUTTONS.DOWN, 0, 1), 1: frame(seq) });
  assert.equal(dodger.actionName, 'spotDodge'); assert.ok(dodger.dodgeFrames > 0);
});

test('shield just before a tumble landing performs neutral and directional techs', () => {
  const neutral = worldWith(), player = neutral.players[0];
  launchTowardFloor(neutral, player);
  stepWorld(neutral, { 0: frame(1, BUTTONS.SHIELD), 1: frame(1) });
  assert.equal(player.actionName, 'tech'); assert.equal(player.knockdownFrames, 0); assert.equal(player.stun, 0); assert.ok(player.invincible >= 14);
  assert.ok(neutral.events.some(event => event.type === 'tech' && event.direction === 0));

  const rolling = worldWith(), roller = rolling.players[0];
  launchTowardFloor(rolling, roller);
  stepWorld(rolling, { 0: frame(1, BUTTONS.SHIELD | BUTTONS.RIGHT, 1), 1: frame(1) });
  assert.equal(roller.actionName, 'techRoll'); assert.ok(roller.vx > 300); assert.ok(roller.dodgeFrames > 0);
});

test('an excessive floor impact is marked red and cannot be teched', () => {
  const world = worldWith(), player = world.players[0];
  launchTowardFloor(world, player, 760);
  player.vx = 240;
  stepWorld(world, { 0: frame(1, BUTTONS.SHIELD), 1: frame(1) });
  assert.equal(player.actionName, 'knockdown');
  assert.ok(player.knockdownFrames > 0);
  assert.ok(world.events.some(event => event.type === 'knockdown' && event.techable === false && event.color === 'red'));
});

test('a missed tech causes knockdown with roll, neutral, and attack get-up choices', () => {
  const rolling = worldWith(), roller = rolling.players[0];
  launchTowardFloor(rolling, roller);
  stepWorld(rolling, { 0: frame(1), 1: frame(1) });
  assert.equal(roller.actionName, 'knockdown'); assert.ok(roller.knockdownFrames > 0);
  stepWorld(rolling, { 0: frame(2, BUTTONS.LEFT, -1), 1: frame(2) });
  assert.equal(roller.actionName, 'getupRoll'); assert.ok(roller.vx < 0); assert.ok(roller.invincible >= 16);

  const attacking = worldWith(), attacker = attacking.players[0];
  launchTowardFloor(attacking, attacker);
  stepWorld(attacking, { 0: frame(1), 1: frame(1) });
  stepWorld(attacking, { 0: frame(2, BUTTONS.ATTACK), 1: frame(2) });
  assert.equal(attacker.actionName, 'getupAttack'); assert.equal(attacker.action?.name, 'getupAttack');
  assert.equal(attacker.action?.move?.radial, true); assert.ok(attacker.invincible >= 16);
});

test('get-up attack buffers held input, protects startup, and strikes on both sides', () => {
  const world = worldWith(), defender = world.players[0], opponent = world.players[1];
  defender.knockdownFrames = 30; defender.actionName = 'knockdown'; defender.tumbling = false;
  defender.x = 640; opponent.x = 585; opponent.invincible = 0;
  stepWorld(world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  assert.equal(defender.actionName, 'getupAttack');
  assert.ok(defender.invincible >= 16);
  for (let seq = 2; seq <= 6; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(opponent.damage > 0, 'the rear sweep creates space behind the waking fighter');
});

test('neutral get-up has enough invincibility to escape a meaty long-range hit', () => {
  const world = worldWith(), defender = world.players[0], attacker = world.players[1];
  defender.knockdownFrames = 30; defender.actionName = 'knockdown'; defender.x = 640;
  attacker.x = 760; attacker.face = -1;
  stepWorld(world, { 0: frame(1, BUTTONS.UP), 1: frame(1) });
  assert.equal(defender.actionName, 'getup');
  const damage = defender.damage;
  for (let seq = 2; seq <= 12; seq++) {
    world.entities.push({
      id: 2000 + seq, type: 'projectile', owner: attacker.i, kind: `meaty-${seq}`,
      x: defender.x, y: defender.y, vx: 0, vy: 0, damage: 4, kx: 180, ky: 80,
      life: 2, radius: 32, hitPlayers: []
    });
    stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  }
  assert.equal(defender.damage, damage);
});

test('down-shield spot dodges, repeated dodges gain recovery, and shield-attack grabs', () => {
  const dodges = worldWith(), player = dodges.players[0];
  stepWorld(dodges, { 0: frame(1, BUTTONS.SHIELD | BUTTONS.DOWN, 0, 1), 1: frame(1) });
  const firstFrames = player.dodgeFrames, firstInvincible = player.invincible;
  assert.equal(player.actionName, 'spotDodge');
  player.dodgeFrames = 0; player.invincible = 0;
  stepWorld(dodges, { 0: frame(2), 1: frame(2) });
  stepWorld(dodges, { 0: frame(3, BUTTONS.SHIELD | BUTTONS.DOWN, 0, 1), 1: frame(3) });
  assert.ok(player.dodgeFrames > firstFrames); assert.ok(player.invincible < firstInvincible);

  const grab = worldWith(), holder = grab.players[0];
  stepWorld(grab, { 0: frame(1, BUTTONS.SHIELD), 1: frame(1) });
  stepWorld(grab, { 0: frame(2, BUTTONS.SHIELD | BUTTONS.ATTACK), 1: frame(2) });
  assert.equal(holder.action?.name, 'grab'); assert.equal(holder.shielding, false);
});

test('items spawn with a two-item cap and stage platforms move deterministically', () => {
  const world = worldWith({ items: true, stageId: 'sky-rail' });
  world.nextItemTick = 1;
  const startX = world.platforms[1].x;
  for (let seq = 1; seq <= 10; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(world.items.length, 1);
  assert.notEqual(world.platforms[1].x, startX);
  world.nextItemTick = world.tick;
  stepWorld(world, { 0: frame(11), 1: frame(11) });
  world.nextItemTick = world.tick;
  stepWorld(world, { 0: frame(12), 1: frame(12) });
  assert.equal(world.items.length, 2);
});

test('balance pass keeps armored power and mobility rewards in separate fighter niches', () => {
  const byId = Object.fromEntries(FIGHTERS.map(fighter => [fighter.id, fighter]));
  assert.equal(byId.blaze.moves.groundSide.armor, undefined);
  assert.ok(byId.blaze.weight <= 1.1);
  assert.ok(byId.blaze.crowdWeight >= 1.1);
  assert.ok(byId.blaze.moves.specialSide.damage <= 17);
  assert.ok(byId.blaze.moves.specialSide.kx <= 450);
  assert.ok(byId.blaze.moves.specialSide.armorThreshold <= 9);
  assert.ok(byId.blaze.moves.specialDown.active <= 8);
  assert.ok(byId.blaze.moves.specialDown.recovery >= 27);
  assert.ok(byId.blaze.moves.specialDown.counterReach <= 135);
  assert.ok(byId.blaze.moves.specialUp.riseHorizontal >= 190);
  assert.ok(byId.blaze.moves.specialDown.counterMultiplier <= 1.1);
  assert.ok(byId.blaze.moves.specialDown.counterMinDamage <= 7);
  assert.ok(byId.volt.moves.specialSide.startup >= 6);
  assert.ok(byId.volt.moves.specialSide.recovery >= 17);
  assert.ok(byId.volt.moves.groundSide.damage >= 10);
  assert.ok(byId.volt.moves.specialNeutral.chainRadius <= 80);
  assert.ok(byId.volt.moves.specialNeutral.projectileCooldown >= 48);
  assert.ok(byId.volt.moves.groundNeutral.recovery >= 5);
  assert.ok(byId.volt.moves.groundJab2.recovery >= 5);
  assert.ok(byId.blaze.moves.dashAttack.startup <= 7);
  assert.ok(byId.blaze.moves.dashAttack.recovery <= 19);
  assert.equal(byId.blaze.moves.dashAttack.armorType, 'heavy');
  assert.ok(byId.blaze.moves.dashAttack.crowdArmorThreshold >= 12);
  assert.ok(byId.blaze.moves.dashAttack.crowdArmorStartupFrames >= 4);
  assert.ok(byId.blaze.moves.airNeutral.startup <= 7);
  assert.ok(byId.blaze.moves.airNeutral.landingLag <= 11);
  assert.equal(byId.blaze.moves.airNeutral.armorType, 'heavy');
  assert.ok(byId.blaze.moves.airNeutral.crowdArmorThreshold >= 10);
  assert.ok(byId.blaze.moves.airNeutral.crowdArmorStartupFrames >= 4);
  assert.ok(byId.bolt.moves.specialSide.kx <= 390);
  assert.ok(byId.bolt.moves.specialSide.recovery <= 17);
  assert.ok(byId.bolt.moves.specialSide.knockbackGrowth <= 1.03);
  assert.ok(byId.bolt.moves.specialDown.damage <= 12);
  assert.ok(byId.bolt.moves.specialDown.startup <= 9);
  assert.ok(byId.bolt.moves.specialDown.reachX <= 105);
  assert.ok(byId.bolt.moves.specialNeutral.returnDamageScale <= .65);
  assert.ok(byId.bolt.moves.specialNeutral.crowdDamageScale <= .84);
  assert.ok(byId.bolt.moves.specialUp.riseHorizontal >= 200);
  assert.ok(byId.bolt.speed >= 1.06);
  assert.ok(byId.bolt.air >= 1.04);
  assert.ok(byId.bolt.weight >= 1.07);
  assert.ok(byId.bolt.moves.dashAttack.recovery <= 12);
  assert.ok(byId.bolt.moves.airNeutral.recovery <= 11);
  assert.ok(byId.bolt.moves.airNeutral.damage >= 9.5);
  assert.ok(byId.bolt.moves.airForward.knockbackGrowth >= 1.04);
  assert.ok(byId.bolt.moves.airBack.knockbackGrowth >= 1.08);
  assert.equal(byId.nova.moves.specialNeutral.maxActiveProjectiles, 1);
  assert.ok(byId.nova.moves.specialNeutral.projectileCooldown >= 48);
  assert.ok(byId.nova.moves.specialDown.trapLife <= 120);
  assert.ok(byId.nova.moves.specialDown.pullStrength <= .68);
  assert.ok(byId.nova.weight <= .92);
  assert.ok(byId.nova.air <= 1.1);
  assert.ok(byId.nova.moves.airBack.knockbackGrowth <= 1.05);
  assert.ok(byId.nova.moves.specialSide.recovery >= 18);
  assert.ok(byId.nova.moves.specialSide.knockbackGrowth <= 1.06);
  assert.ok(byId.nova.moves.specialSide.teleport <= 110);
  assert.equal(byId.nova.moves.specialDown.damage, 5);
  assert.ok(byId.nova.moves.specialDown.trapLife <= 180);
  assert.ok(byId.nova.moves.specialDown.reachX <= 105);
  assert.ok(byId.nova.moves.specialDown.pullStrength <= .9);
  const reactor = STAGES.find(stage => stage.id === 'reactor-core');
  assert.ok(reactor.platforms[1].x - (reactor.platforms[0].x + reactor.platforms[0].w) <= 70);
});

test('Pulse Hammer uses common move data instead of scaling each fighter side smash', () => {
  const hammer = ITEMS.find(item => item.id === 'pulse-hammer');
  const damageByFighter = [];
  for (const characterId of ['volt', 'blaze', 'bolt', 'nova']) {
    const world = worldWith(), player = world.players[0];
    player.characterId = characterId;
    player.heldItem = { ...hammer };
    stepWorld(world, { 0: tap(1, BUTTONS.ATTACK), 1: frame(1) });
    assert.equal(player.actionName, 'itemHammer');
    assert.equal(player.action?.move?.damage, hammer.damage);
    assert.equal(player.action?.move?.startup, 10);
    assert.equal(player.action?.move?.recovery, 24);
    damageByFighter.push(player.action.move.damage);
  }
  assert.equal(new Set(damageByFighter).size, 1);
});

test('instant-use items apply recovery and Jump Coil respects its authored multiplier', () => {
  const rail = worldWith(), shooter = rail.players[0];
  rail.players[1].x = 1000;
  shooter.heldItem = { ...ITEMS.find(item => item.id === 'rail-blaster') };
  stepWorld(rail, { 0: tap(1, BUTTONS.ATTACK), 1: frame(1) });
  assert.equal(shooter.actionName, 'itemBlaster');
  assert.equal(shooter.action?.move?.recovery, 14);
  assert.equal(rail.entities.filter(entity => entity.kind === 'rail').length, 1);
  stepWorld(rail, { 0: frame(2), 1: frame(2) });
  stepWorld(rail, { 0: tap(3, BUTTONS.ATTACK), 1: frame(3) });
  assert.equal(rail.entities.filter(entity => entity.kind === 'rail').length, 1);

  const coil = worldWith(), jumper = coil.players[0];
  const item = ITEMS.find(entry => entry.id === 'jump-coil');
  jumper.heldItem = { ...item };
  stepWorld(coil, { 0: tap(1, BUTTONS.ATTACK), 1: frame(1) });
  assert.equal(jumper.jumpBuff, item.duration);
  assert.equal(jumper.jumpBuffMultiplier, item.multiplier);
  assert.equal(jumper.actionName, 'itemCoil');
});

test('time mode scores and resolves a winner at timeout', () => {
  const world = worldWith({ mode: 'time', timeSeconds: 60 });
  world.players[0].score = 2; world.players[1].score = 1; world.remainingTicks = 1;
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.equal(world.phase, 'ended');
  assert.equal(world.winner, 0);
});

test('team mode blocks friendly fire by default', () => {
  const world = worldWith({ mode: 'team', teams: true, friendlyFire: false });
  world.players[1].team = world.players[0].team;
  stepWorld(world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 8; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(world.players[1].damage, 0);
});

test('grab ignores shield and directional throw releases the target', () => {
  const world = worldWith();
  world.players[1].x = 642;
  world.players[1].shielding = true;
  stepWorld(world, { 0: frame(1, BUTTONS.GRAB), 1: frame(1, BUTTONS.SHIELD) });
  for (let seq = 2; seq <= 7; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq, BUTTONS.SHIELD) });
  assert.equal(world.players[0].grabbing, 1);
  assert.equal(world.players[1].grabbedBy, 0);
  stepWorld(world, { 0: frame(8, BUTTONS.UP, 0, -1), 1: frame(8) });
  assert.equal(world.players[1].grabbedBy, 0);
  assert.equal(publicSnapshot(world).players[0].actionPhase, 'startup');
  for (let seq = 9; seq <= 12; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(world.players[1].grabbedBy, null);
  assert.ok(world.players[1].vy < -300);
  assert.ok(world.events.some(event => event.type === 'throw' && event.direction === 'throwUp'));
});

test('four throws have distinct Ultimate-style roles and grant throw invincibility', () => {
  const performThrow = (buttons, horizontal, vertical) => {
    const world = worldWith(), holder = world.players[0], target = world.players[1];
    holder.face = 1; holder.grabbing = target.i; holder.grabFrames = 1; holder.actionName = 'grabHold';
    target.grabbedBy = holder.i; target.invincible = 0; target.damage = 0;
    stepWorld(world, { 0: frame(1, buttons, horizontal, vertical), 1: frame(1) });
    const throwInvincibility = holder.invincible;
    for (let seq = 2; seq <= 8 && target.grabbedBy != null; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
    return {
      damage: target.damage,
      speed: Math.hypot(target.vx, target.vy),
      vy: target.vy,
      throwInvincibility,
      immunity: target.grabImmunity,
      event: world.events.find(event => event.type === 'throw')
    };
  };
  const forward = performThrow(BUTTONS.RIGHT, 1, 0);
  const back = performThrow(BUTTONS.LEFT, -1, 0);
  const up = performThrow(BUTTONS.UP, 0, -1);
  const down = performThrow(BUTTONS.DOWN, 0, 1);
  assert.ok(back.damage > forward.damage && back.speed > forward.speed);
  assert.ok(up.vy < down.vy && up.speed > down.speed);
  assert.ok(down.vy < 0, 'down throw should pop the target upward for a combo');
  for (const result of [forward, back, up, down]) {
    assert.ok(result.throwInvincibility > 0);
    assert.ok(result.immunity > 0);
    assert.ok(result.event);
  }
});

test('holding an approach direction no longer causes an automatic throw after grab connects', () => {
  const world = worldWith(), holder = world.players[0], target = world.players[1];
  target.x = 642;
  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.GRAB, 1), 1: frame(1) });
  for (let seq = 2; seq <= 10; seq++) stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT, 1), 1: frame(seq) });
  assert.equal(holder.grabbing, target.i); assert.equal(target.grabbedBy, holder.i);
  stepWorld(world, { 0: frame(11), 1: frame(11) });
  assert.equal(holder.grabbing, target.i);
  stepWorld(world, { 0: frame(12, BUTTONS.LEFT, -1), 1: frame(12) });
  assert.equal(holder.grabbing, target.i);
  for (let seq = 13; seq <= 17; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(holder.grabbing, null); assert.equal(target.grabbedBy, null);
  assert.ok(world.events.some(event => event.type === 'throw' && event.direction === 'throwBack'));
});

test('airborne grab input becomes an air dodge instead of freezing two fighters in midair', () => {
  const world = worldWith(), holder = world.players[0], target = world.players[1];
  holder.grounded = false; holder.y = 280; holder.vy = 90; holder.airDodgeAvailable = true;
  target.grounded = false; target.x = holder.x + 24; target.y = holder.y;
  stepWorld(world, { 0: frame(1, BUTTONS.GRAB), 1: frame(1) });
  assert.equal(holder.actionName, 'airDodge');
  assert.ok(holder.dodgeFrames > 0);
  assert.equal(holder.airDodgeAvailable, false);
  assert.equal(holder.grabbing, null);
  assert.equal(target.grabbedBy, null);
});

test('large grounded fighters can grab at their natural pushbox spacing', () => {
  const world = worldWith(), holder = world.players[0], target = world.players[1];
  holder.characterId = 'blaze'; holder.width = 60; holder.height = 78;
  target.characterId = 'blaze'; target.width = 60; target.height = 78;
  target.x = holder.x + 60;
  stepWorld(world, { 0: frame(1, BUTTONS.GRAB), 1: frame(1) });
  for (let seq = 2; seq <= 7; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(holder.grabbing, target.i);
  assert.equal(target.grabbedBy, holder.i);
});

test('a third fighter hitting a grabbed target safely releases both grab states', () => {
  const world = createWorld({ rules: { mode: 'stock', stocks: 3 }, seed: 8, roster: [
    { slot: 0, clientId: 'holder', characterId: 'volt' },
    { slot: 1, clientId: 'held', characterId: 'blaze' },
    { slot: 2, clientId: 'attacker', characterId: 'bolt' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const [holder, held, attacker] = world.players, platform = world.platforms[0];
  for (const player of world.players) { player.y = platform.y - player.height / 2; player.grounded = true; player.invincible = 0; }
  holder.x = 600; held.x = 628; attacker.x = 700; attacker.face = -1;
  holder.grabbing = held.i; holder.actionName = 'grabHold'; held.grabbedBy = holder.i; held.actionName = 'grabbed';
  stepWorld(world, { 0: frame(1), 1: frame(1), 2: frame(1, BUTTONS.ATTACK) });
  for (let seq = 2; seq <= 5; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq), 2: frame(seq) });
  assert.equal(holder.grabbing, null); assert.equal(held.grabbedBy, null); assert.ok(held.damage > 0);
});

test('stale-move negation weakens repeated use of the same attack', () => {
  const world = worldWith();
  const platform = world.platforms[0];
  let sequence = 0;
  function landAttack() {
    const attacker = world.players[0], target = world.players[1];
    attacker.x = 600; attacker.y = platform.y - attacker.height / 2; attacker.vx = 0; attacker.vy = 0; attacker.grounded = true; attacker.platformId = platform.id; attacker.action = null; attacker.hitstop = 0; attacker.lastInput = frame(sequence);
    target.x = 660; target.y = platform.y - target.height / 2; target.vx = 0; target.vy = 0; target.grounded = true; target.platformId = platform.id; target.hitstop = 0; target.stun = 0; target.invincible = 0;
    stepWorld(world, { 0: frame(++sequence, BUTTONS.ATTACK), 1: frame(sequence) });
    for (let count = 0; count < 6; count++) stepWorld(world, { 0: frame(++sequence), 1: frame(sequence) });
  }
  landAttack(); const first = world.players[1].damage;
  landAttack(); const second = world.players[1].damage - first;
  assert.ok(second < first);
  assert.ok(second >= first * 0.65);
});

test('long combos scale damage down to a 65 percent floor without dropping lower', () => {
  const world = worldWith(), attacker = world.players[0], target = world.players[1];
  const platform = world.platforms[0], increments = [];
  for (let hit = 0; hit < 9; hit++) {
    attacker.hitstop = 0;
    target.x = 660; target.y = platform.y - target.height / 2;
    target.vx = 0; target.vy = 0; target.grounded = true; target.platformId = platform.id;
    target.hitstop = 0; target.stun = 0; target.invincible = 0; target.tumbling = false;
    const before = target.damage;
    world.entities.push({
      id: 100 + hit, type: 'projectile', owner: attacker.i, kind: `combo-test-${hit}`,
      x: target.x, y: target.y, vx: 0, vy: 0, damage: 10, kx: 1, ky: 1,
      life: 5, radius: 24, hitPlayers: []
    });
    stepWorld(world, { 0: frame(hit + 1), 1: frame(hit + 1) });
    increments.push(target.damage - before);
  }
  const freshDamage = 10.5 * 1.2;
  assert.ok(Math.abs(increments[0] - freshDamage) < .001);
  assert.ok(Math.abs(increments[1] / freshDamage - .94) < .001);
  assert.ok(Math.abs(increments[6] / freshDamage - .65) < .001);
  assert.ok(Math.abs(increments[8] / freshDamage - .65) < .001);
  assert.equal(target.comboCount, 9);
});

test('repeated grounded flinch breaks into an escapable launch on the third hit', () => {
  const world = worldWith(), attacker = world.players[0], target = world.players[1];
  const platform = world.platforms[0];
  const move = {
    name: 'flinch-loop-test', damage: 3, fixedKx: 60, fixedKy: 0,
    kx: 60, ky: 0, knockbackGrowth: .12, hitstop: 3,
    hitstun: 12, groundedFlinch: true
  };

  for (let hit = 0; hit < 3; hit++) {
    attacker.hitstop = 0;
    target.x = 660; target.y = platform.y - target.height / 2;
    target.vx = 0; target.vy = 0; target.grounded = true; target.platformId = platform.id;
    target.hitstop = 0; target.stun = 0; target.invincible = 0; target.tumbling = false;
    world.entities.push({
      id: 300 + hit, type: 'projectile', owner: attacker.i, kind: move.name,
      x: target.x, y: target.y, vx: 0, vy: 0, life: 5, radius: 24,
      hitPlayers: [], ...move
    });
    stepWorld(world, { 0: frame(hit + 1), 1: frame(hit + 1) });
    if (hit < 2) {
      assert.equal(target.grounded, true);
      assert.equal(target.tumbling, false);
    }
  }

  assert.equal(target.comboCount, 3);
  assert.equal(target.grounded, false);
  assert.equal(target.tumbling, true);
  assert.ok(Math.abs(target.vx) >= 145);
  assert.ok(target.vy <= -120);
});

test('authored hitstun loosens after a long combo instead of remaining a frame trap', () => {
  const world = worldWith(), attacker = world.players[0], target = world.players[1];
  const platform = world.platforms[0], stuns = [];
  for (let hit = 0; hit < 7; hit++) {
    attacker.hitstop = 0;
    target.x = 660; target.y = platform.y - target.height / 2;
    target.vx = 0; target.vy = 0; target.grounded = true; target.platformId = platform.id;
    target.hitstop = 0; target.stun = 0; target.invincible = 0; target.tumbling = false;
    world.entities.push({
      id: 400 + hit, type: 'projectile', owner: attacker.i, kind: `stun-loop-${hit}`,
      x: target.x, y: target.y, vx: 0, vy: 0, damage: 2, kx: 1, ky: 1,
      hitstun: 20, life: 5, radius: 24, hitPlayers: []
    });
    stepWorld(world, { 0: frame(hit + 1), 1: frame(hit + 1) });
    stuns.push(target.stun);
  }
  assert.equal(stuns[0], 20);
  assert.equal(stuns[2], 20);
  assert.ok(stuns[4] < stuns[3]);
  assert.ok(stuns[6] <= 15);
});

test('rage increases launch speed while DI rotates launch without adding speed', () => {
  function strike(attackerDamage, defenderInput = frame(0)) {
    const world = worldWith(), attacker = world.players[0], target = world.players[1];
    attacker.damage = attackerDamage; attacker.jabStep = 2; attacker.jabTimer = 12;
    target.damage = 80; target.lastInput = defenderInput; target.grounded = false; target.platformId = null; target.y -= 20;
    stepWorld(world, { 0: tap(1, BUTTONS.ATTACK), 1: defenderInput });
    for (let seq = 2; seq <= 5; seq++) stepWorld(world, { 0: frame(seq), 1: { ...defenderInput, seq } });
    return { speed: Math.hypot(target.vx, target.vy), angle: Math.atan2(target.vy, target.vx) };
  }
  const calm = strike(0), enraged = strike(150), neutral = strike(0), heldDown = strike(0, frame(0, BUTTONS.DOWN, 0, 1));
  assert.ok(enraged.speed > calm.speed * 1.08);
  assert.ok(Math.abs(heldDown.angle - neutral.angle) > .12);
  assert.ok(Math.abs(heldDown.speed - neutral.speed) < 1);
});

test('SDI shifts position during hitstop only on fresh directional pulses', () => {
  const world = worldWith(), player = world.players[0];
  player.hitstop = 6; player.canSdi = true; player.sdiCooldown = 0; player.grounded = false;
  const start = player.x;
  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT, 1), 1: frame(1) });
  assert.equal(player.x, start + 6);
  stepWorld(world, { 0: frame(2, BUTTONS.RIGHT, 1), 1: frame(2) });
  assert.equal(player.x, start + 6);
  stepWorld(world, { 0: frame(3), 1: frame(3) });
  stepWorld(world, { 0: frame(4), 1: frame(4) });
  stepWorld(world, { 0: frame(5, BUTTONS.LEFT, -1), 1: frame(5) });
  assert.equal(player.x, start);
});

test('airborne hitstun allows meaningful drift and stronger reverse braking', () => {
  function drift(horizontal) {
    const world = worldWith(), player = world.players[0];
    player.grounded = false; player.platformId = null; player.coyoteFrames = 0;
    player.x = 500; player.y = 280; player.vx = 430; player.vy = -170;
    player.stun = 18; player.hitstop = 0; player.tumbling = true; player.actionName = 'tumble';
    for (let seq = 1; seq <= 6; seq++) stepWorld(world, {
      0: frame(seq, horizontal < 0 ? BUTTONS.LEFT : horizontal > 0 ? BUTTONS.RIGHT : 0, horizontal),
      1: frame(seq)
    });
    return player.vx;
  }
  const neutral = drift(0), withLaunch = drift(1), againstLaunch = drift(-1);
  assert.ok(withLaunch > neutral + 35);
  assert.ok(againstLaunch < neutral - 70);
});

test('ending airborne hitstun exposes a recovery pose and permits immediate air dodge', () => {
  const world = worldWith(), player = world.players[0];
  player.grounded = false; player.platformId = null; player.coyoteFrames = 0;
  player.x = 500; player.y = 280; player.vx = 250; player.vy = -90;
  player.stun = 1; player.hitstop = 0; player.tumbling = true; player.actionName = 'tumble';
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.equal(player.stun, 0); assert.equal(player.actionName, 'airRecover');
  assert.ok(player.tumbleRecoverFrames > 0);
  stepWorld(world, { 0: frame(2, BUTTONS.SHIELD | BUTTONS.RIGHT, 1), 1: frame(2) });
  assert.equal(player.actionName, 'airDodge');
  assert.equal(player.tumbleRecoverFrames, 0);
});

test('actionable tumble remains until an aerial action and blocks fast fall', () => {
  const world = worldWith(), player = world.players[0];
  player.grounded = false; player.platformId = null; player.coyoteFrames = 0;
  player.x = 500; player.y = 250; player.vx = 180; player.vy = 90;
  player.stun = 1; player.hitstop = 0; player.tumbling = true; player.actionName = 'tumble';
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  for (let seq = 2; seq <= 10; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(player.stun, 0); assert.equal(player.tumbling, true);
  stepWorld(world, { 0: tap(11, BUTTONS.DOWN, BUTTONS.DOWN, 0, 1), 1: frame(11) });
  assert.equal(player.fastFalling, false);
  stepWorld(world, { 0: tap(12, BUTTONS.ATTACK), 1: frame(12) });
  assert.ok(player.action?.name.startsWith('air'));
  assert.equal(player.tumbling, false);
});

test('standard up specials enter freefall while Bolt spring remains actionable', () => {
  const standard = worldWith(), volt = standard.players[0];
  volt.grounded = false; volt.platformId = null; volt.coyoteFrames = 0; volt.x = 120; volt.y = 500;
  stepWorld(standard, { 0: frame(1, BUTTONS.UP | BUTTONS.SPECIAL, 0, -1), 1: frame(1) });
  for (let seq = 2; seq <= 42; seq++) stepWorld(standard, { 0: frame(seq), 1: frame(seq) });
  assert.equal(volt.action, null); assert.equal(volt.freefall, true); assert.equal(volt.actionName, 'freefall');
  volt.vy = 120;
  stepWorld(standard, { 0: tap(43, BUTTONS.ATTACK), 1: frame(43) });
  assert.equal(volt.action, null, 'freefall must reject attacks');
  stepWorld(standard, { 0: tap(44, BUTTONS.DOWN, BUTTONS.DOWN, 0, 1), 1: frame(44) });
  assert.equal(volt.fastFalling, true, 'freefall still permits fast fall');

  const spring = createWorld({ rules: { mode: 'training' }, roster: [
    { slot: 0, clientId: 'bolt', characterId: 'bolt' },
    { slot: 1, clientId: 'dummy', characterId: 'volt' }
  ] });
  spring.phase = 'active';
  const bolt = spring.players[0];
  bolt.grounded = false; bolt.platformId = null; bolt.coyoteFrames = 0; bolt.invincible = 0; bolt.x = 120; bolt.y = 500;
  stepWorld(spring, { 0: frame(1, BUTTONS.UP | BUTTONS.SPECIAL, 0, -1), 1: frame(1) });
  for (let seq = 2; seq <= 38; seq++) stepWorld(spring, { 0: frame(seq), 1: frame(seq) });
  assert.equal(bolt.freefall, false);
  stepWorld(spring, { 0: tap(39, BUTTONS.ATTACK), 1: frame(39) });
  assert.ok(bolt.action?.name.startsWith('air'));
});

test('a real hit interrupts freefall and restores the spent recovery without restoring air jump', () => {
  const world = worldWith(), attacker = world.players[0], target = world.players[1];
  attacker.x = 500; attacker.y = 280; attacker.grounded = false;
  target.x = 535; target.y = 280; target.grounded = false; target.platformId = null;
  target.freefall = true; target.actionName = 'freefall'; target.recoveryAvailable = false; target.jumps = 0;
  world.entities.push({
    id: world.nextEntityId++, type: 'projectile', kind: 'testHit', owner: attacker.i,
    x: target.x, y: target.y, vx: 0, vy: 0, radius: 30, damage: 6, kx: 180, ky: 120,
    knockbackGrowth: .8, hitstop: 4, arm: 0, life: 5, hitPlayers: []
  });
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.equal(target.freefall, false); assert.equal(target.recoveryAvailable, true);
  assert.equal(target.jumps, 0); assert.ok(target.stun > 0); assert.equal(target.tumbling, true);
});

test('no-flinch projectiles deal damage without cancelling action or applying knockback', () => {
  const world = worldWith(), attacker = world.players[0], target = world.players[1];
  target.action = {
    name: 'groundSide', move: { ...FIGHTERS[1].moves.groundSide, defensiveOnly: true },
    frame: 1, startup: FIGHTERS[1].moves.groundSide.startup, hit: [], activated: false
  };
  target.actionName = 'groundSide'; target.vx = 0; target.vy = 0;
  const before = target.damage;
  world.entities.push({
    id: world.nextEntityId++, type: 'projectile', kind: 'weakSpark', owner: attacker.i,
    x: target.x, y: target.y, vx: 0, vy: 0, radius: 30, damage: 2, kx: 300, ky: 180,
    noFlinch: true, hitstop: 1, arm: 0, life: 5, hitPlayers: []
  });
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.ok(target.damage > before); assert.equal(target.stun, 0);
  assert.equal(target.action?.name, 'groundSide'); assert.equal(target.vx, 0); assert.equal(target.vy, 0);
});

test('grabs allow pummels and defender mashing can force an escape', () => {
  const world = worldWith(), holder = world.players[0], target = world.players[1];
  target.x = 642;
  stepWorld(world, { 0: frame(1, BUTTONS.GRAB), 1: frame(1) });
  for (let seq = 2; seq <= 7; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  const before = target.damage;
  stepWorld(world, { 0: frame(8, BUTTONS.GRAB), 1: frame(8) });
  assert.ok(target.damage > before); assert.equal(holder.grabbing, 1);
  for (let seq = 9; seq <= 14 && holder.grabbing != null; seq++) {
    const buttons = seq % 2 ? 255 : 0;
    stepWorld(world, { 0: frame(seq), 1: frame(seq, buttons, seq % 2 ? 1 : -1, seq % 2 ? 1 : -1) });
  }
  assert.equal(holder.grabbing, null); assert.equal(target.grabbedBy, null);
  assert.equal(target.actionBuffer, null); assert.equal(target.jumpBuffer, 0); assert.equal(target.shieldBuffer, 0);
  assert.ok(world.events.some(event => event.type === 'pummel'));
  assert.ok(world.events.some(event => event.type === 'grab-escape'));
  assert.ok(target.grabImmunity > 0);
});

test('released fighters cannot be regrabbed for one second', () => {
  const world = worldWith(), holder = world.players[0], target = world.players[1];
  target.x = holder.x + 20; target.grabImmunity = 60;
  stepWorld(world, { 0: frame(1, BUTTONS.GRAB), 1: frame(1) });
  for (let seq = 2; seq <= 8; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(holder.grabbing, null);
  assert.ok(target.grabImmunity >= 52);
});

test('shield hits create defender stun and shields visually shrink through damage state', () => {
  const world = worldWith(), target = world.players[1];
  for (let seq = 1; seq <= 6; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq, BUTTONS.SHIELD) });
  stepWorld(world, { 0: tap(7, BUTTONS.ATTACK), 1: frame(7, BUTTONS.SHIELD) });
  for (let seq = 8; seq <= 11; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq, BUTTONS.SHIELD) });
  assert.ok(target.shield < 50); assert.ok(target.shieldStun > 0); assert.ok(Math.abs(target.vx) > 0);
});

test('six consecutive ledge grabs exhaust ledge access until landing', () => {
  const world = worldWith(), player = world.players[0], platform = world.platforms[0];
  player.grounded = false; player.platformId = null; player.coyoteFrames = 0; player.ledgeGrabs = 6;
  player.x = platform.x + 3; player.y = platform.y + 5; player.vx = 0; player.vy = 100;
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.equal(player.ledge, null);
  player.x = platform.x + platform.w / 2; player.y = platform.y - player.height / 2 - 2; player.vy = 180;
  stepWorld(world, { 0: frame(2), 1: frame(2) });
  assert.equal(player.grounded, true); assert.equal(player.ledgeGrabs, 0);
});

test('ledge hanging times out after five seconds and cannot instantly regrab', () => {
  const world = worldWith(), player = world.players[0], platform = world.platforms[0];
  player.grounded = false; player.platformId = null; player.invincible = 0; player.ledgeCatchFrames = 0;
  player.ledge = { platformId: platform.id, x: platform.x, y: platform.y, face: 1 };
  player.x = platform.x - 16; player.y = platform.y + 20; player.face = 1;

  for (let seq = 1; seq < 300; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(player.ledge, 'fighter should still hang before the authored timeout');
  stepWorld(world, { 0: frame(300), 1: frame(300) });
  assert.equal(player.ledge, null);
  assert.equal(player.actionName, 'fall');
  assert.ok(player.ledgeGrabLockFrames >= 45);
  assert.ok(world.events.some(event => event.type === 'ledge-timeout' && event.player === player.i));

  player.x = platform.x + 3; player.y = platform.y + 5; player.vx = 0; player.vy = 100;
  stepWorld(world, { 0: frame(301), 1: frame(301) });
  assert.equal(player.ledge, null, 'timeout lock should prevent an immediate ledge regrab loop');
});

test('ledge catch has two vulnerable frames and exposes all five recovery options', () => {
  const caught = worldWith(), catcher = caught.players[0], platform = caught.platforms[0];
  catcher.grounded = false; catcher.platformId = null; catcher.coyoteFrames = 0;
  catcher.x = platform.x + 3; catcher.y = platform.y + 5; catcher.vx = 0; catcher.vy = 100;
  stepWorld(caught, { 0: frame(1), 1: frame(1) });
  assert.ok(catcher.ledge);
  assert.equal(catcher.ledgeCatchFrames, 2);
  assert.equal(catcher.invincible, 0);
  stepWorld(caught, { 0: frame(2), 1: frame(2) });
  assert.equal(catcher.invincible, 0);
  stepWorld(caught, { 0: frame(3), 1: frame(3) });
  assert.ok(catcher.invincible > 0);

  const withLedge = () => {
    const world = worldWith(), player = world.players[0], ledgePlatform = world.platforms[0];
    player.grounded = false; player.platformId = null; player.invincible = 0; player.ledgeCatchFrames = 0;
    player.ledge = { platformId: ledgePlatform.id, x: ledgePlatform.x, y: ledgePlatform.y, face: 1 };
    player.x = ledgePlatform.x - 16; player.y = ledgePlatform.y + 20; player.face = 1;
    return { world, player };
  };
  const getup = withLedge();
  stepWorld(getup.world, { 0: frame(1, BUTTONS.RIGHT, 1), 1: frame(1) });
  assert.equal(getup.player.actionName, 'ledgeGetup');

  const attack = withLedge();
  stepWorld(attack.world, { 0: frame(1, BUTTONS.SPECIAL), 1: frame(1) });
  assert.equal(attack.player.actionName, 'ledgeAttackClimb');
  assert.equal(attack.player.grounded, false);
  for (let seq = 2; seq <= 9; seq++) stepWorld(attack.world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(attack.player.action?.name, 'groundNeutral');

  const roll = withLedge();
  stepWorld(roll.world, { 0: frame(1, BUTTONS.GRAB), 1: frame(1) });
  assert.equal(roll.player.actionName, 'ledgeRollClimb');
  for (let seq = 2; seq <= 10; seq++) stepWorld(roll.world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(roll.player.actionName, 'ledgeRoll');

  const jump = withLedge();
  stepWorld(jump.world, { 0: frame(1, BUTTONS.UP, 0, -1), 1: frame(1) });
  assert.equal(jump.player.actionName, 'ledgeJumpClimb');
  for (let seq = 2; seq <= 7; seq++) stepWorld(jump.world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(jump.player.actionName, 'ledgeJump');

  const drop = withLedge();
  stepWorld(drop.world, { 0: frame(1, BUTTONS.DOWN, 0, 1), 1: frame(1) });
  assert.equal(drop.player.ledge, null);
  assert.equal(drop.player.fastFalling, true);
});

test('rising recovery can catch a ledge and air jump refresh waits until vulnerable catch frames end', () => {
  const world = worldWith(), player = world.players[0], platform = world.platforms[0];
  player.grounded = false; player.platformId = null; player.coyoteFrames = 0;
  player.x = platform.x + 3; player.y = platform.y + 28; player.vx = 0; player.vy = -300;
  player.jumps = 0; player.recoveryAvailable = false;
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.ok(player.ledge, 'an upward-moving recovery should snap to a ledge from below');
  assert.equal(player.jumps, 0);
  assert.equal(player.recoveryAvailable, true, 'up special refreshes immediately on ledge catch');
  stepWorld(world, { 0: frame(2), 1: frame(2) });
  assert.equal(player.jumps, 0, 'air jump must remain spent during the second vulnerable frame');
  stepWorld(world, { 0: frame(3), 1: frame(3) });
  assert.equal(player.jumps, 1, 'air jump refreshes once ledge invincibility begins');
});

test('hitstun lockout and aerial attack end lag cannot be cancelled by a ledge grab', () => {
  const hitWorld = worldWith(), target = hitWorld.players[0], attacker = hitWorld.players[1], platform = hitWorld.platforms[0];
  target.grounded = false; target.platformId = null; target.coyoteFrames = 0; target.invincible = 0;
  attacker.x = 900;
  hitWorld.entities.push({
    id: hitWorld.nextEntityId++, type: 'projectile', kind: 'ledge-lock-test', owner: attacker.i,
    x: target.x, y: target.y, vx: 0, vy: 0, radius: 30,
    damage: 5, kx: 160, ky: 100, hitstop: 4, life: 5, arm: 0, hitPlayers: []
  });
  stepWorld(hitWorld, { 0: frame(1), 1: frame(1) });
  assert.equal(target.ledgeGrabLockFrames, 55);

  target.x = platform.x + 3; target.y = platform.y + 8; target.vx = 0; target.vy = 80;
  target.stun = 0; target.hitstop = 0; target.coyoteFrames = 0;
  stepWorld(hitWorld, { 0: frame(2), 1: frame(2) });
  assert.equal(target.ledge, null, 'recently hit fighter must not magnet-snap to the ledge');
  target.ledgeGrabLockFrames = 1;
  target.x = platform.x + 3; target.y = platform.y + 8; target.vx = 0; target.vy = 80;
  stepWorld(hitWorld, { 0: frame(3), 1: frame(3) });
  assert.ok(target.ledge, 'ledge becomes available when the 55-frame lockout expires');

  const attackWorld = worldWith(), attackerAtLedge = attackWorld.players[0], attackPlatform = attackWorld.platforms[0];
  attackerAtLedge.grounded = false; attackerAtLedge.platformId = null; attackerAtLedge.coyoteFrames = 0; attackerAtLedge.invincible = 0;
  attackerAtLedge.x = attackPlatform.x + 3; attackerAtLedge.y = attackPlatform.y + 8; attackerAtLedge.vx = 0; attackerAtLedge.vy = 40;
  stepWorld(attackWorld, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  assert.ok(attackerAtLedge.action?.name?.startsWith('air'));
  assert.equal(attackerAtLedge.ledge, null, 'aerial attack must finish instead of being cancelled into ledge catch');
  attackerAtLedge.action = null; attackerAtLedge.actionName = 'fall';
  attackerAtLedge.x = attackPlatform.x + 3; attackerAtLedge.y = attackPlatform.y + 8; attackerAtLedge.vx = 0; attackerAtLedge.vy = 40;
  stepWorld(attackWorld, { 0: frame(2), 1: frame(2) });
  assert.ok(attackerAtLedge.ledge);
});

test('a hit during vulnerable ledge catch denies air-jump refresh', () => {
  const world = worldWith(), player = world.players[0], attacker = world.players[1], platform = world.platforms[0];
  player.grounded = false; player.platformId = null; player.coyoteFrames = 0;
  player.x = platform.x + 3; player.y = platform.y + 12; player.vx = 0; player.vy = 100; player.jumps = 0;
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.ok(player.ledge); assert.equal(player.jumps, 0);
  world.entities.push({
    id: world.nextEntityId++, type: 'projectile', kind: 'ledgeSnipe', owner: attacker.i,
    x: player.x, y: player.y, vx: 0, vy: 0, radius: 24,
    damage: 5, kx: 180, ky: 120, hitstop: 4, life: 5, arm: 0, hitPlayers: []
  });
  stepWorld(world, { 0: frame(2), 1: frame(2) });
  assert.equal(player.ledge, null); assert.equal(player.jumps, 0);
  assert.equal(player.ledgeJumpRefreshPending, false);
});

test('ledge options replace hanging invincibility with their own authored windows', () => {
  const withLedge = () => {
    const world = worldWith(), player = world.players[0], platform = world.platforms[0];
    player.grounded = false; player.platformId = null; player.invincible = 24; player.ledgeInvincible = 24; player.ledgeCatchFrames = 0;
    player.ledge = { platformId: platform.id, x: platform.x, y: platform.y, face: 1 };
    player.x = platform.x - 16; player.y = platform.y + 20; player.face = 1;
    return { world, player };
  };
  const attack = withLedge();
  stepWorld(attack.world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  assert.equal(attack.player.actionName, 'ledgeAttackClimb');
  assert.equal(attack.player.invincible, 8);
  for (let seq = 2; seq <= 9; seq++) stepWorld(attack.world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(attack.player.invincible, 0);
  assert.equal(attack.player.ledgeInvincible, 0);

  const roll = withLedge();
  stepWorld(roll.world, { 0: frame(1, BUTTONS.SHIELD), 1: frame(1) });
  assert.equal(roll.player.actionName, 'ledgeRollClimb');
  for (let seq = 2; seq <= 10; seq++) stepWorld(roll.world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(roll.player.actionName, 'ledgeRoll');
  assert.ok(roll.player.invincible > 0 && roll.player.invincible <= 10);
  assert.ok(roll.player.dodgeFrames > roll.player.invincible, 'roll recovery must outlast invincibility');

  const jump = withLedge();
  stepWorld(jump.world, { 0: frame(1, BUTTONS.UP, 0, -1), 1: frame(1) });
  assert.equal(jump.player.actionName, 'ledgeJumpClimb');
  assert.equal(jump.player.invincible, 6);
  assert.equal(jump.player.canLedgeInvincible, false);
  for (let seq = 2; seq <= 7; seq++) stepWorld(jump.world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(jump.player.actionName, 'ledgeJump');
  assert.ok(jump.player.ledgeGrabLockFrames > 0);
  assert.ok(jump.player.vx > 0 && jump.player.vy < 0, 'ledge jump must launch inward and upward');
  const jumpPlatform = jump.world.platforms[0];
  jump.player.x = jumpPlatform.x + 3; jump.player.y = jumpPlatform.y + 12;
  jump.player.vx = 0; jump.player.vy = 100; jump.player.coyoteFrames = 0; jump.player.invincible = 0;
  stepWorld(jump.world, { 0: frame(8), 1: frame(8) });
  assert.equal(jump.player.ledge, null, 'ledge jump must not immediately snap back to the same ledge');
  jump.player.ledgeGrabLockFrames = 0;
  jump.player.x = jumpPlatform.x + 3; jump.player.y = jumpPlatform.y + 12;
  jump.player.vx = 0; jump.player.vy = 100;
  stepWorld(jump.world, { 0: frame(9), 1: frame(9) });
  assert.ok(jump.player.ledge);
  assert.equal(jump.player.ledgeInvincible, 0, 'ledge jump regrab must not refresh invincibility');

  const drop = withLedge();
  stepWorld(drop.world, { 0: frame(1, BUTTONS.DOWN, 0, 1), 1: frame(1) });
  assert.equal(drop.player.invincible, 0);
});

test('holding up from a ledge performs one jump instead of repeatedly regrabbing', () => {
  const world = worldWith(), player = world.players[0], platform = world.platforms[0];
  world.players[1].x = 1000;
  player.grounded = false; player.platformId = null; player.invincible = 0; player.ledgeInvincible = 0; player.ledgeCatchFrames = 0;
  player.ledge = { platformId: platform.id, x: platform.x, y: platform.y, face: 1 };
  player.x = platform.x - 16; player.y = platform.y + 20; player.face = 1;
  const ledgesBefore = world.events.filter(event => event.type === 'ledge').length;

  for (let seq = 1; seq <= 20; seq++) {
    stepWorld(world, { 0: frame(seq, BUTTONS.UP, 0, -1), 1: frame(seq) });
  }

  assert.equal(world.events.filter(event => event.type === 'ledge').length, ledgesBefore);
  assert.equal(player.ledge, null);
  assert.ok(player.x >= platform.x + 25, `ledge jump should clear the snap zone: ${player.x - platform.x}`);
  assert.ok(player.y < platform.y - 15, `ledge jump should remain above the ledge: ${player.y - platform.y}`);
});

test('twenty-five four-player worlds stay inside the server tick budget', () => {
  const worlds = Array.from({ length: 25 }, (_, room) => createWorld({ rules: { mode: 'stock' }, seed: room + 1, roster: Array.from({ length: 4 }, (_, slot) => ({ slot, clientId: `p${room}:${slot}`, characterId: ['volt', 'blaze', 'bolt', 'nova'][slot] })) }));
  worlds.forEach(world => { world.phase = 'active'; world.countdown = 0; });
  const samples = [];
  for (let tick = 0; tick < 120; tick++) {
    const start = performance.now();
    for (const world of worlds) stepWorld(world, {});
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  assert.ok(samples[Math.ceil(samples.length * 0.95) - 1] < 8);
});

test('ground movement reaches a target speed and stops without a long slide', () => {
  const world = worldWith();
  world.players[1].x = 900;
  for (let seq = 1; seq <= 10; seq++) stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT, 1), 1: frame(seq) });
  assert.ok(world.players[0].vx > 250);
  for (let seq = 11; seq <= 14; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(Math.abs(world.players[0].vx) < 1);
});

test('keyboard movement runs on one press, dashes on a double tap, pivots early, and reverses quickly in air', () => {
  const ground = worldWith(), runner = ground.players[0];
  ground.players[1].x = 900;
  stepWorld(ground, { 0: frame(1, BUTTONS.RIGHT, 1), 1: frame(1) });
  assert.notEqual(runner.actionName, 'dash'); assert.equal(runner.dashFrames, 0); assert.ok(runner.vx > 0 && runner.vx < 200);
  stepWorld(ground, { 0: frame(2), 1: frame(2) });
  stepWorld(ground, { 0: frame(3, BUTTONS.RIGHT, 1), 1: frame(3) });
  assert.equal(runner.actionName, 'dash'); assert.equal(runner.dashFrames, 16); assert.ok(runner.vx > 500);
  stepWorld(ground, { 0: frame(4, BUTTONS.LEFT, -1), 1: frame(4) });
  assert.equal(runner.actionName, 'pivot'); assert.ok(runner.vx < -400); assert.equal(runner.face, -1);

  const air = worldWith(), airborne = air.players[0];
  airborne.grounded = false; airborne.y = 300; airborne.vx = 300; airborne.coyoteFrames = 0;
  for (let seq = 1; seq <= 8; seq++) stepWorld(air, { 0: frame(seq, BUTTONS.LEFT, -1), 1: frame(seq) });
  assert.ok(airborne.vx < 0);
});

test('keyboard movement progresses from walk to run while a double tap remains a distinct dash', () => {
  const world = worldWith(), player = world.players[0];
  world.players[1].x = 1050;
  for (let seq = 1; seq <= 8; seq++) stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT, 1), 1: frame(seq) });
  assert.equal(player.actionName, 'walk');
  assert.ok(player.horizontalHoldFrames < 10);
  for (let seq = 9; seq <= 14; seq++) stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT, 1), 1: frame(seq) });
  assert.equal(player.actionName, 'run');
  assert.ok(player.vx > 220);
  assert.equal(player.dashFrames, 0);
});

test('dash attacks and dash grabs use movement state instead of absolute velocity for every fighter', () => {
  for (const fighter of FIGHTERS) {
    const makeWorld = () => {
      const world = createWorld({ rules: { mode: 'stock', stocks: 3 }, roster: [
        { slot: 0, clientId: `${fighter.id}:player`, characterId: fighter.id },
        { slot: 1, clientId: `${fighter.id}:target`, characterId: 'blaze' }
      ] });
      world.phase = 'active'; world.countdown = 0;
      const platform = world.platforms[0], player = world.players[0];
      player.x = 500; player.y = platform.y - player.height / 2; player.grounded = true; player.invincible = 0;
      world.players[1].x = 1000;
      return world;
    };

    const fastWalk = makeWorld(), walker = fastWalk.players[0];
    walker.movementState = 'walk'; walker.vx = fighter.dashSpeed + 80;
    stepWorld(fastWalk, { 0: tap(1, BUTTONS.ATTACK, BUTTONS.RIGHT, 1), 1: frame(1) });
    assert.equal(walker.action?.name, 'groundSide', `${fighter.id} velocity alone must not create dash attack`);

    const runAttack = makeWorld(), runner = runAttack.players[0];
    runner.movementState = 'run'; runner.vx = fighter.runSpeed;
    stepWorld(runAttack, { 0: tap(1, BUTTONS.ATTACK, BUTTONS.RIGHT, 1), 1: frame(1) });
    assert.equal(runner.action?.name, 'dashAttack', `${fighter.id} run state should create dash attack`);

    const fastWalkGrab = makeWorld(), walkingGrabber = fastWalkGrab.players[0];
    walkingGrabber.movementState = 'walk'; walkingGrabber.vx = fighter.dashSpeed + 80;
    stepWorld(fastWalkGrab, { 0: tap(1, BUTTONS.GRAB, BUTTONS.RIGHT, 1), 1: frame(1) });
    assert.equal(walkingGrabber.action?.variant, 'normal', `${fighter.id} velocity alone must not create dash grab`);

    const runGrab = makeWorld(), runningGrabber = runGrab.players[0];
    runningGrabber.movementState = 'run'; runningGrabber.vx = fighter.runSpeed;
    stepWorld(runGrab, { 0: tap(1, BUTTONS.GRAB, BUTTONS.RIGHT, 1), 1: frame(1) });
    assert.equal(runningGrabber.action?.variant, 'dash', `${fighter.id} run state should create dash grab`);
  }
});

test('late dash reversal brakes while dash exit and dash jump preserve deliberate momentum', () => {
  const brakeWorld = worldWith(), braking = brakeWorld.players[0];
  brakeWorld.players[1].x = 1100;
  stepWorld(brakeWorld, { 0: frame(1, BUTTONS.RIGHT, 1), 1: frame(1) });
  stepWorld(brakeWorld, { 0: frame(2), 1: frame(2) });
  stepWorld(brakeWorld, { 0: frame(3, BUTTONS.RIGHT, 1), 1: frame(3) });
  for (let seq = 4; seq <= 11; seq++) stepWorld(brakeWorld, { 0: frame(seq, BUTTONS.RIGHT, 1), 1: frame(seq) });
  stepWorld(brakeWorld, { 0: frame(12, BUTTONS.LEFT, -1), 1: frame(12) });
  assert.equal(braking.movementState, 'brake');
  assert.equal(braking.actionName, 'brake');
  assert.equal(braking.dashFrames, 0);
  assert.equal(braking.face, 1, 'late reversal should plant before turning around');

  const exitWorld = worldWith(), exiting = exitWorld.players[0], volt = FIGHTERS.find(fighter => fighter.id === 'volt');
  exitWorld.players[1].x = 1100;
  stepWorld(exitWorld, { 0: frame(1, BUTTONS.RIGHT, 1), 1: frame(1) });
  stepWorld(exitWorld, { 0: frame(2), 1: frame(2) });
  stepWorld(exitWorld, { 0: frame(3, BUTTONS.RIGHT, 1), 1: frame(3) });
  for (let seq = 4; seq <= 22; seq++) stepWorld(exitWorld, { 0: frame(seq, BUTTONS.RIGHT, 1), 1: frame(seq) });
  assert.equal(exiting.movementState, 'run');
  assert.ok(Math.abs(exiting.vx - volt.runSpeed) < 1, `dash should settle into run speed, got ${exiting.vx}`);

  const jumpWorld = worldWith(), jumper = jumpWorld.players[0];
  jumpWorld.players[1].x = 1100;
  stepWorld(jumpWorld, { 0: frame(1, BUTTONS.RIGHT, 1), 1: frame(1) });
  stepWorld(jumpWorld, { 0: frame(2), 1: frame(2) });
  stepWorld(jumpWorld, { 0: frame(3, BUTTONS.RIGHT, 1), 1: frame(3) });
  stepWorld(jumpWorld, { 0: frame(4, BUTTONS.RIGHT | BUTTONS.UP, 1, -1), 1: frame(4) });
  assert.equal(jumper.jumpSquatDash, true);
  for (let seq = 5; seq <= 7; seq++) stepWorld(jumpWorld, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.UP, 1, -1), 1: frame(seq) });
  assert.equal(jumper.grounded, false);
  assert.ok(jumper.vx >= volt.dashSpeed * .9, `dash jump should retain horizontal burst, got ${jumper.vx}`);
});

test('fighter dash startup and braking are distinct while ordinary run speed stays below 301', () => {
  const byId = Object.fromEntries(FIGHTERS.map(fighter => [fighter.id, fighter]));
  for (const fighter of FIGHTERS) {
    assert.ok(fighter.runSpeed >= 280 && fighter.runSpeed <= 300, `${fighter.id} run speed`);
    assert.ok(fighter.dashSpeed >= 470 && fighter.dashSpeed <= 535, `${fighter.id} dash speed`);
    assert.ok(fighter.dashSpeed - fighter.runSpeed >= 185, `${fighter.id} needs a meaningful dash burst`);
    assert.ok(fighter.dashBrakeFrames >= 3 && fighter.dashBrakeFrames <= 5, `${fighter.id} brake duration`);
  }
  assert.ok(byId.volt.dashSpeed > byId.blaze.dashSpeed);
  assert.ok(byId.volt.dashBrakeFrames < byId.blaze.dashBrakeFrames);
  assert.ok(byId.nova.dashBrakeControl > byId.bolt.dashBrakeControl);
});

test('crouching reduces launch to 85 percent and Bolt can crawl with a lowered hurtbox', () => {
  const launch = crouching => {
    const world = worldWith(), attacker = world.players[0], target = world.players[1];
    attacker.x = 450; target.x = 700; target.damage = 80; target.invincible = 0;
    world.entities.push({
      id: crouching ? 811 : 812, type: 'projectile', owner: attacker.i, kind: crouching ? 'crouch-test' : 'stand-test',
      x: target.x, y: target.y, vx: 0, vy: 0, damage: 8, kx: 360, ky: 170,
      life: 5, radius: 28, hitPlayers: []
    });
    stepWorld(world, { 0: frame(1), 1: crouching ? frame(1, BUTTONS.DOWN, 0, 1) : frame(1) });
    return world.events.find(event => event.type === 'hit' && event.player === target.i)?.launchSpeed || 0;
  };
  const standing = launch(false), crouched = launch(true);
  assert.ok(Math.abs(crouched / standing - .85) < .015, `${crouched} / ${standing}`);

  const crawlWorld = createWorld({ rules: { mode: 'stock', stocks: 3 }, roster: [
    { slot: 0, clientId: 'bolt', characterId: 'bolt' },
    { slot: 1, clientId: 'volt', characterId: 'volt' }
  ] });
  crawlWorld.phase = 'active'; crawlWorld.countdown = 0;
  const crawler = crawlWorld.players[0], platform = crawlWorld.platforms[0];
  crawler.x = 600; crawler.y = platform.y - crawler.height / 2; crawler.grounded = true; crawler.invincible = 0;
  stepWorld(crawlWorld, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.DOWN, 1, 1), 1: frame(1) });
  assert.equal(crawler.actionName, 'crawl');
  assert.ok(crawler.vx > 0 && crawler.vx < 160);
  const crawlHead = publicSnapshot(crawlWorld).players[0].hurtboxes[0].y;
  crawler.actionName = 'idle';
  const standingHead = publicSnapshot(crawlWorld).players[0].hurtboxes[0].y;
  assert.ok(crawlHead > standingHead);
});

test('fast fall requires a fresh down input after the apex and emits its visual cue', () => {
  const world = worldWith(), player = world.players[0];
  player.grounded = false; player.platformId = null; player.y = 200; player.vy = -10;
  stepWorld(world, { 0: frame(1, BUTTONS.DOWN, 0, 1), 1: frame(1) });
  assert.equal(player.fastFalling, false);
  stepWorld(world, { 0: frame(2), 1: frame(2) });
  stepWorld(world, { 0: frame(3, BUTTONS.DOWN, 0, 1), 1: frame(3) });
  assert.equal(player.fastFalling, true);
  assert.ok(player.fastFallFlashFrames > 0);
  assert.ok(world.events.some(event => event.type === 'fast-fall' && event.player === player.i));
});

test('landing applies traction once without slowing an already grounded runner every frame', () => {
  const world = worldWith(), player = world.players[0], platform = world.platforms[0];
  player.grounded = false; player.x = 500; player.y = platform.y - player.height / 2 - 3; player.vx = 300; player.vy = 300;
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.equal(player.grounded, true); assert.ok(player.vx > 245 && player.vx < 275);
  const landedVx = player.vx;
  stepWorld(world, { 0: frame(2, BUTTONS.RIGHT, 1), 1: frame(2) });
  assert.ok(player.vx >= landedVx);
});

test('snapshot attack hitbox matches the box used to hit the opponent', () => {
  const world = worldWith();
  stepWorld(world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 5; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  const snapshot = publicSnapshot(world);
  const attacker = snapshot.players[0], target = snapshot.players[1], box = attacker.actionHitbox;
  assert.equal(attacker.actionPhase, 'active');
  assert.equal(box.type, 'box');
  assert.ok(Math.abs(target.x - box.x) <= box.w / 2 + target.width / 2);
  assert.ok(Math.abs(target.y - box.y) <= box.h / 2 + target.height / 2);
  assert.ok(target.damage > 0);
});

test('horizontal attack range ends at the authored reach and hit events use the contact point', () => {
  const rangeWorld = worldWith(), attacker = rangeWorld.players[0], target = rangeWorld.players[1];
  target.x = 1000;
  stepWorld(rangeWorld, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(1) });
  let box = null;
  for (let seq = 2; seq <= 12 && !box; seq++) {
    stepWorld(rangeWorld, { 0: frame(seq), 1: frame(seq) });
    box = publicSnapshot(rangeWorld).players[0].actionHitbox;
  }
  assert.ok(box);
  assert.ok(box.x + box.w / 2 <= attacker.x + FIGHTERS[0].moves.groundSide.reachX + .01);

  const contactWorld = worldWith(), contactAttacker = contactWorld.players[0], contactTarget = contactWorld.players[1];
  for (let seq = 1; seq <= 8 && !contactWorld.events.some(event => event.type === 'hit'); seq++) {
    stepWorld(contactWorld, { 0: frame(seq, seq === 1 ? BUTTONS.ATTACK : 0), 1: frame(seq) });
  }
  const hit = contactWorld.events.find(event => event.type === 'hit');
  assert.ok(hit);
  assert.ok(hit.x > contactAttacker.x && hit.x < contactTarget.x);
});

test('ground down attacks use a low, thin hitbox aligned with the kicking leg', () => {
  for (const fighter of FIGHTERS) assert.equal(fighter.moves.groundDown.low, true);
  const world = worldWith(), player = world.players[0];
  world.players[1].x = 1000;
  stepWorld(world, { 0: frame(1, BUTTONS.DOWN | BUTTONS.ATTACK, 0, 1), 1: frame(1) });
  let box = null;
  for (let seq = 2; seq <= 14 && !box; seq++) {
    stepWorld(world, { 0: frame(seq, BUTTONS.DOWN, 0, 1), 1: frame(seq) });
    box = publicSnapshot(world).players[0].actionHitbox;
  }
  assert.ok(box);
  assert.ok(box.y > player.y + player.height * .15);
  assert.ok(box.h < player.height * .5);
});

test('every active fighter move exposes finite visual strike points inside its real hitbox', () => {
  for (const fighter of FIGHTERS) {
    const world = createWorld({ rules: { mode: 'training', stocks: 3 }, roster: [
      { slot: 0, clientId: 'audit', characterId: fighter.id },
      { slot: 1, clientId: 'dummy', characterId: 'volt' }
    ] });
    world.phase = 'active'; world.countdown = 0;
    const player = world.players[0]; player.face = 1;
    for (const [name, sourceMove] of Object.entries(fighter.moves)) {
      const move = { ...sourceMove };
      player.action = { name, move, frame: move.startup, startup: move.startup, hit: [] };
      player.actionName = name;
      const rendered = publicSnapshot(world).players[0];
      const bodyAttack = !move.projectileOnly && !move.trapOnly && !move.defensiveOnly
        && Number.isFinite(move.reachX) && (move.radial || Number.isFinite(move.reachY));
      if (!bodyAttack) {
        assert.equal(rendered.actionHitbox, null, `${fighter.id}.${name} should not expose a body hitbox`);
        assert.deepEqual(rendered.strikePoints, [], `${fighter.id}.${name} should not expose strike points`);
        continue;
      }
      const box = rendered.actionHitbox;
      assert.ok(box, `${fighter.id}.${name} missing hitbox`);
      assert.ok(rendered.strikePoints.length > 0, `${fighter.id}.${name} missing strike points`);
      if (move.radial) assert.equal(rendered.strikePoints.length, 2, `${fighter.id}.${name} radial point count`);
      for (const point of rendered.strikePoints) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${fighter.id}.${name} finite point`);
        if (box.type === 'circle') assert.ok(Math.hypot(point.x - box.x, point.y - box.y) <= box.radius + .01, `${fighter.id}.${name} point outside circle`);
        else {
          assert.ok(Math.abs(point.x - box.x) <= box.w / 2 + .01, `${fighter.id}.${name} point outside box x`);
          assert.ok(Math.abs(point.y - box.y) <= box.h / 2 + .01, `${fighter.id}.${name} point outside box y`);
        }
      }
      if (move.low) assert.ok(rendered.strikePoints[0].y > player.y, `${fighter.id}.${name} low point`);
      else if (move.vertical) assert.ok(rendered.strikePoints[0].y < player.y, `${fighter.id}.${name} up point`);
      else if (move.downward) assert.ok(rendered.strikePoints[0].y > player.y, `${fighter.id}.${name} down point`);
      else if (!move.radial) assert.equal(Math.sign(rendered.strikePoints[0].x - player.x), move.backward ? -1 : 1, `${fighter.id}.${name} facing point`);
    }
  }
});

test('neutral aerial uses a compact leg-height hitbox instead of a generous body circle', () => {
  for (const fighter of FIGHTERS) {
    const world = createWorld({ rules: { mode: 'training', stocks: 3 }, roster: [
      { slot: 0, clientId: 'aerial', characterId: fighter.id },
      { slot: 1, clientId: 'dummy', characterId: 'volt' }
    ] });
    world.phase = 'active';
    const player = world.players[0], move = { ...fighter.moves.airNeutral };
    player.action = { name: 'airNeutral', move, frame: move.startup, startup: move.startup, hit: [] };
    player.actionName = 'airNeutral';
    const rendered = publicSnapshot(world).players[0];
    const hitbox = rendered.actionHitbox;
    assert.equal(hitbox.type, 'box', `${fighter.id} hitbox shape`);
    assert.ok(hitbox.h < hitbox.w * .55, `${fighter.id} hitbox stays leg-height`);
    assert.ok(hitbox.w <= move.reachX * 1.35, `${fighter.id} horizontal reach`);
    assert.ok(hitbox.h <= move.reachY * .63, `${fighter.id} vertical reach`);
    assert.equal(rendered.strikePoints.length, 2, `${fighter.id} point count`);
    assert.ok(Math.abs(rendered.strikePoints[0].y - rendered.strikePoints[1].y) >= hitbox.h * .4, `${fighter.id} diagonal separation`);
    for (const point of rendered.strikePoints) {
      assert.ok(Math.abs(point.x - hitbox.x) <= hitbox.w / 2, `${fighter.id} point inside horizontal bounds`);
      assert.ok(Math.abs(point.y - hitbox.y) <= hitbox.h / 2, `${fighter.id} point inside vertical bounds`);
    }
  }
});

test('shield hurtbox radius exactly matches the rendered shield radius formula', () => {
  const world = worldWith(), player = world.players[0];
  player.shielding = true; player.shield = 32;
  const shield = publicSnapshot(world).players[0].hurtboxes[0];
  const shieldScale = .58 + .42 * .64;
  assert.equal(shield.part, 'shield');
  assert.ok(Math.abs(shield.radius - Math.max(player.width * .9 + 15, player.height * .75 + 12) * shieldScale) < .001);
});

test('tumble and knockdown hurtboxes follow their compact and horizontal silhouettes', () => {
  const world = worldWith(), player = world.players[0];
  player.grounded = false; player.tumbling = true; player.actionName = 'tumble';
  let boxes = publicSnapshot(world).players[0].hurtboxes;
  assert.equal(boxes.length, 1); assert.equal(boxes[0].part, 'tumble');
  assert.ok(boxes[0].radius >= player.height * .5);

  player.grounded = true; player.tumbling = false; player.actionName = 'knockdown';
  boxes = publicSnapshot(world).players[0].hurtboxes;
  assert.deepEqual(boxes.map(box => box.part), ['head', 'body', 'legs']);
  assert.ok(new Set(boxes.map(box => box.x)).size > 1);
  assert.equal(new Set(boxes.map(box => box.y)).size, 1);
});

test('projectile collision uses pose hurtboxes and reports the projectile-edge contact point', () => {
  const world = worldWith(), target = world.players[1];
  const targetX = target.x, targetY = target.y;
  world.entities.push({ id: 99, type: 'trap', owner: 0, kind: 'test', x: targetX - 36, y: targetY, vx: 0, vy: 0, damage: 5, kx: 120, ky: 80, life: 30, radius: 25, arm: 0, hitPlayers: [] });
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  const hit = world.events.find(event => event.type === 'hit' && event.player === target.i);
  assert.ok(hit); assert.ok(target.damage > 0);
  assert.ok(Math.abs(Math.hypot(hit.x - (targetX - 36), hit.y - targetY) - 25) < .01);
  assert.ok(hit.x < targetX);
});

test('snapshots expose pose-aware hurtboxes and crouching lowers the vulnerable profile', () => {
  const world = worldWith(), player = world.players[0];
  let boxes = publicSnapshot(world).players[0].hurtboxes;
  assert.deepEqual(boxes.map(box => box.part), ['head', 'body', 'legs']);
  const standingHead = boxes[0].y;
  stepWorld(world, { 0: frame(1, BUTTONS.DOWN, 0, 1), 1: frame(1) });
  boxes = publicSnapshot(world).players[0].hurtboxes;
  assert.ok(boxes[0].y > standingHead); assert.equal(player.actionName, 'crouch');
});

test('landing the tip sweetspot deals more damage and hitstop than a close hit', () => {
  function sideHit(targetX) {
    const world = worldWith(), attacker = world.players[0], target = world.players[1];
    target.x = targetX;
    stepWorld(world, { 0: tap(1, BUTTONS.ATTACK, BUTTONS.RIGHT, 1), 1: frame(1) });
    stepWorld(world, { 0: frame(2), 1: frame(2) });
    for (let seq = 3; seq <= 10; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
    return { damage: target.damage, hitstop: target.hitstop, quality: world.events.find(event => event.type === 'hit')?.quality };
  }
  const close = sideHit(640), tip = sideHit(690);
  assert.equal(close.quality, 'normal'); assert.equal(tip.quality, 'sweet');
  assert.ok(tip.damage > close.damage * 1.1); assert.ok(tip.hitstop >= close.hitstop);
});

test('jump squat preserves running momentum and permits a turnaround', () => {
  const world = worldWith(), player = world.players[0]; world.players[1].x = 900;
  for (let seq = 1; seq <= 5; seq++) stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT, 1), 1: frame(seq) });
  const runningSpeed = player.vx;
  stepWorld(world, { 0: frame(6, BUTTONS.RIGHT | BUTTONS.UP, 1, -1), 1: frame(6) });
  stepWorld(world, { 0: frame(7, BUTTONS.LEFT | BUTTONS.UP, -1, -1), 1: frame(7) });
  assert.equal(player.actionName, 'jumpSquat'); assert.equal(player.face, -1); assert.ok(Math.abs(player.vx) > runningSpeed * .35);
});

test('snapshot exposes the exact active grab box for motion and debug rendering', () => {
  const world = worldWith();
  world.players[1].x = 900;
  stepWorld(world, { 0: frame(1, BUTTONS.GRAB), 1: frame(1) });
  for (let seq = 2; seq <= 7; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  const source = world.players[0], player = publicSnapshot(world).players[0], box = player.actionHitbox;
  assert.equal(player.actionPhase, 'active');
  assert.equal(box.type, 'box');
  assert.equal(box.grab, true);
  assert.equal(box.w, 58); assert.equal(box.h, 48);
  assert.ok((box.x - source.x) * source.face > 0);
});

test('the synthetic throw animation never exposes a non-finite attack box', () => {
  const world = worldWith(), holder = world.players[0], target = world.players[1];
  target.x = 642;
  stepWorld(world, { 0: frame(1, BUTTONS.GRAB), 1: frame(1) });
  for (let seq = 2; seq <= 7; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  stepWorld(world, { 0: frame(8, BUTTONS.RIGHT, 1), 1: frame(8) });
  const windup = publicSnapshot(world).players[0];
  assert.equal(windup.actionName, 'throwForward');
  assert.equal(windup.actionPhase, 'startup');
  assert.equal(windup.actionHitbox, null);
  for (let seq = 9; seq <= 12; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  const thrown = publicSnapshot(world).players[0];
  assert.equal(thrown.actionName, 'throwForward');
  assert.equal(thrown.actionPhase, 'active');
  assert.equal(thrown.actionHitbox, null);
});

test('a grounded fighter is carried by a moving platform', () => {
  const world = worldWith({ stageId: 'sky-rail' });
  const platform = world.platforms[1], player = world.players[0];
  player.x = platform.x + platform.w / 2; player.y = platform.y - player.height / 2;
  player.grounded = true; player.platformId = platform.id; player.vx = 0;
  const relative = player.x - platform.x;
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.ok(Math.abs((player.x - platform.x) - relative) < .001);
});

test('a press and release received inside one server tick still starts an action', () => {
  const world = worldWith();
  stepWorld(world, { 0: { ...frame(1), pressedButtons: BUTTONS.ATTACK }, 1: frame(1) });
  assert.equal(world.players[0].actionName, 'groundNeutral');
  assert.ok(world.players[0].action);
});

test('being hit cancels an unarmored attack instead of letting it continue', () => {
  const world = worldWith();
  stepWorld(world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1, BUTTONS.ATTACK) });
  for (let seq = 2; seq <= 5; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(world.players[1].damage > 0);
  assert.equal(world.players[1].action, null);
  assert.equal(world.players[1].actionName, 'hit');
});

test('running attacks flow into dash attacks while held side attacks still charge', () => {
  const tap = worldWith(); tap.players[1].x = 900; tap.players[0].movementState = 'run'; tap.players[0].horizontalHoldFrames = 12; tap.players[0].vx = 300;
  stepWorld(tap, { 0: { ...frame(1, BUTTONS.RIGHT, 1), pressedButtons: BUTTONS.ATTACK }, 1: frame(1) });
  assert.equal(tap.players[0].actionName, 'dashAttack');
  assert.equal(tap.players[0].action.frame, 0);
  stepWorld(tap, { 0: frame(2), 1: frame(2) });
  assert.ok(tap.players[0].vx >= 280);
  for (let seq = 3; seq <= 40; seq++) stepWorld(tap, { 0: frame(seq), 1: frame(seq) });
  assert.equal(tap.players[0].action, null);
  assert.equal(tap.players[0].actionName, 'idle');

  const held = worldWith(); held.players[1].x = 900;
  for (let seq = 1; seq <= 14; seq++) stepWorld(held, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(seq) });
  const snapshot = publicSnapshot(held).players[0];
  assert.equal(snapshot.actionPhase, 'charge');
  assert.ok(snapshot.chargeFrames >= 10);
});

test('projectile, trap, and counter specials do not also create a hidden body hit', () => {
  const projectile = worldWith();
  stepWorld(projectile, { 0: frame(1, BUTTONS.SPECIAL), 1: frame(1) });
  for (let seq = 2; seq <= 8; seq++) stepWorld(projectile, { 0: frame(seq), 1: frame(seq) });
  assert.equal(projectile.players[0].action.hit.length, 0);
  assert.ok(projectile.players[1].damage > 0);

  const counter = worldWith();
  counter.players[0].characterId = 'blaze';
  stepWorld(counter, { 0: frame(1, BUTTONS.DOWN | BUTTONS.SPECIAL, 0, 1), 1: frame(1) });
  for (let seq = 2; seq <= 18; seq++) stepWorld(counter, { 0: frame(seq), 1: frame(seq) });
  assert.equal(counter.players[1].damage, 0);
});

test('Blaze counter converts an incoming hit into a strong visible retaliation', () => {
  const world = worldWith();
  const attacker = world.players[0], blaze = world.players[1];
  stepWorld(world, { 0: frame(1), 1: frame(1, BUTTONS.DOWN | BUTTONS.SPECIAL, 0, 1) });
  for (let seq = 2; seq <= 5; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  stepWorld(world, { 0: tap(6, BUTTONS.ATTACK), 1: frame(6) });
  for (let seq = 7; seq <= 9; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });

  assert.equal(blaze.damage, 0);
  assert.ok(attacker.damage >= 7 && attacker.damage < 11, `counter damage ${attacker.damage}`);
  assert.ok(Math.hypot(attacker.vx, attacker.vy) >= 400, 'counter creates meaningful but bounded launch');
  assert.equal(attacker.action, null);
  assert.ok(attacker.tumbling && attacker.stun > 0);
  assert.equal(blaze.action?.variant, 'counterSuccess');
  assert.ok(blaze.invincible > 0);
  assert.ok(world.events.some(event => event.type === 'counter' && event.player === blaze.i && event.attacker === attacker.i && event.connected));
});

test('Blaze counter negates a distant projectile without globally striking its owner', () => {
  const world = worldWith(), shooter = world.players[0], blaze = world.players[1];
  shooter.x = 220; blaze.x = 780;
  stepWorld(world, { 0: frame(1), 1: frame(1, BUTTONS.DOWN | BUTTONS.SPECIAL, 0, 1) });
  for (let seq = 2; seq <= 5; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  world.entities.push({
    id: 900, type: 'projectile', owner: shooter.i, kind: 'counter-range-test',
    x: blaze.x, y: blaze.y, vx: 0, vy: 0, damage: 12, kx: 300, ky: 140,
    life: 5, radius: 30, hitPlayers: []
  });
  stepWorld(world, { 0: frame(6), 1: frame(6) });
  assert.equal(blaze.damage, 0);
  assert.equal(shooter.damage, 0);
  assert.equal(blaze.action?.variant, 'counterSuccess');
  assert.ok(world.events.some(event => event.type === 'counter' && event.connected === false));
});

test('side special brakes during recovery instead of sliding after the move', () => {
  const world = worldWith();
  world.players[1].x = 1000;
  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.SPECIAL, 1), 1: frame(1) });
  for (let seq = 2; seq <= 35; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(world.players[0].action, null);
  assert.ok(Math.abs(world.players[0].vx) < 25);
});

test('ground roll and air dodge keep dodge state instead of becoming hitstun', () => {
  const ground = worldWith();
  stepWorld(ground, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.SHIELD, 1), 1: frame(1) });
  assert.equal(ground.players[0].actionName, 'roll');
  assert.equal(ground.players[0].stun, 0);
  assert.ok(ground.players[0].dodgeFrames > 0);
  stepWorld(ground, { 0: frame(2), 1: frame(2) });
  assert.equal(ground.players[0].actionName, 'roll');

  const air = worldWith();
  air.players[0].grounded = false; air.players[0].y = 300;
  stepWorld(air, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.SHIELD, 1), 1: frame(1) });
  assert.equal(air.players[0].actionName, 'airDodge');
  assert.equal(air.players[0].stun, 0);
  assert.equal(air.players[0].airDodgeAvailable, false);
});

test('roll invincibility avoids overlapping projectiles but vulnerable recovery can be hit', () => {
  const world = worldWith(), roller = world.players[0], shooter = world.players[1];
  roller.x = 600; shooter.x = 900;
  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.SHIELD, 1), 1: frame(1) });
  assert.equal(roller.actionName, 'roll');
  assert.ok(roller.invincible > 0);

  const damageBeforeDodge = roller.damage;
  world.entities.push({
    id: world.nextEntityId++, type: 'projectile', owner: shooter.i, kind: 'roll-invincibility-test',
    x: roller.x, y: roller.y, vx: 0, vy: 0, damage: 12, kx: 280, ky: 120,
    life: 10, radius: 40, color: '#fff', hitPlayers: []
  });
  stepWorld(world, { 0: frame(2), 1: frame(2) });
  assert.equal(roller.damage, damageBeforeDodge, 'projectile must not hit during visible invincibility');
  assert.deepEqual(world.entities.at(-1).hitPlayers, [], 'dodged projectile must not consume its hit');

  let seq = 2;
  while (roller.invincible > 0) stepWorld(world, { 0: frame(++seq), 1: frame(seq) });
  assert.ok(roller.dodgeFrames > 0, 'roll recovery should remain after invincibility ends');
  world.entities.push({
    id: world.nextEntityId++, type: 'projectile', owner: shooter.i, kind: 'roll-recovery-test',
    x: roller.x, y: roller.y, vx: 0, vy: 0, damage: 12, kx: 280, ky: 120,
    life: 10, radius: 40, color: '#fff', hitPlayers: []
  });
  stepWorld(world, { 0: frame(++seq), 1: frame(seq) });
  assert.ok(roller.damage > damageBeforeDodge, 'projectile should hit during vulnerable roll recovery');
});

test('ground rolls carry the fighter a meaningful distance instead of turning in place', () => {
  const world = worldWith(), player = world.players[0], startX = player.x;
  stepWorld(world, { 0: frame(1, BUTTONS.LEFT | BUTTONS.SHIELD, -1), 1: frame(1) });
  assert.equal(player.actionName, 'roll');
  assert.equal(player.dodgeTotalFrames, player.dodgeFrames);
  for (let seq = 2; seq <= 22; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(startX - player.x > 100, `expected roll travel above 100px, got ${startX - player.x}`);
});

test('consecutive opposite rolls restart their animation clock and preserve travel direction', () => {
  const world = worldWith(), player = world.players[0];
  stepWorld(world, { 0: frame(1, BUTTONS.LEFT | BUTTONS.SHIELD, -1), 1: frame(1) });
  const firstSerial = player.dodgeSerial;
  assert.equal(player.actionName, 'roll');
  assert.ok(player.dodgeStartVx < 0);
  for (let seq = 2; seq <= 23; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(player.dodgeFrames, 0);
  assert.equal(player.dodgeElapsed, player.dodgeTotalFrames);
  stepWorld(world, { 0: frame(24), 1: frame(24) });
  stepWorld(world, { 0: frame(25, BUTTONS.RIGHT | BUTTONS.SHIELD, 1), 1: frame(25) });
  assert.equal(player.actionName, 'roll');
  assert.equal(player.dodgeSerial, firstSerial + 1);
  assert.ok(player.dodgeElapsed <= 1, 'new roll animation must restart at its opening frame');
  assert.ok(player.dodgeStartVx > 0, 'opposite roll must rotate and travel in the new direction');
});

test('ground rolls pass through an opponent and restore pushbox collision afterward', () => {
  const world = worldWith(), roller = world.players[0], target = world.players[1];
  roller.x = 600; target.x = 660;
  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.SHIELD, 1), 1: frame(1) });
  for (let seq = 2; seq <= 23; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(roller.x > target.x, `expected roller to cross target: ${roller.x} <= ${target.x}`);
  assert.equal(roller.dodgeFrames, 0);
  const minimumGap = (roller.width + target.width) / 2;
  assert.ok(Math.abs(roller.x - target.x) >= minimumGap - .01, 'pushboxes should separate fighters after the roll');
});

test('directional air dodge normalizes diagonal input, loses speed, and has landing lag', () => {
  const world = worldWith(), player = world.players[0];
  player.grounded = false; player.platformId = null; player.y = 300; player.vx = 0; player.vy = 0;
  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.DOWN | BUTTONS.SHIELD, 1, 1), 1: frame(1) });
  assert.equal(player.actionName, 'airDodge');
  assert.equal(player.dodgeTotalFrames, 44);
  assert.equal(player.dodgeWindupFrames, 2);
  const burstSpeed = Math.hypot(player.dodgeStartVx, player.dodgeStartVy);
  assert.ok(burstSpeed > 395 && burstSpeed < 430, `expected normalized burst between 395 and 430, got ${burstSpeed}`);
  for (let seq = 2; seq <= 12; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(Math.hypot(player.vx, player.vy) < burstSpeed);

  const landing = worldWith(), lander = landing.players[0], platform = landing.platforms[0];
  lander.grounded = false; lander.platformId = null;
  lander.y = platform.y - lander.height / 2 - 3; lander.vx = 0; lander.vy = 0;
  stepWorld(landing, { 0: frame(1, BUTTONS.DOWN | BUTTONS.SHIELD, 0, 1), 1: frame(1) });
  for (let seq = 2; seq <= 8 && !lander.grounded; seq++) stepWorld(landing, { 0: frame(seq), 1: frame(seq) });
  assert.equal(lander.grounded, true);
  assert.equal(lander.actionName, 'landing');
  assert.ok(lander.landingLag >= 6);
  assert.equal(lander.dodgeFrames, 0);
});

test('neutral air dodge preserves momentum while spot dodge can cancel into a late punish', () => {
  const air = worldWith(), flyer = air.players[0];
  flyer.grounded = false; flyer.platformId = null; flyer.y = 280; flyer.vx = 240; flyer.vy = -120;
  stepWorld(air, { 0: frame(1, BUTTONS.SHIELD), 1: frame(1) });
  assert.equal(flyer.actionName, 'airDodge');
  assert.equal(flyer.dodgeTotalFrames, 42);
  assert.equal(flyer.dodgeNeutral, true);
  for (let seq = 2; seq <= 6; seq++) stepWorld(air, { 0: frame(seq), 1: frame(seq) });
  assert.ok(flyer.vx > 225, `neutral air dodge should retain horizontal momentum, got ${flyer.vx}`);

  const ground = worldWith(), dodger = ground.players[0];
  stepWorld(ground, { 0: frame(1, BUTTONS.DOWN | BUTTONS.SHIELD, 0, 1), 1: frame(1) });
  assert.equal(dodger.dodgeTotalFrames, 24);
  for (let seq = 2; seq <= 19; seq++) stepWorld(ground, { 0: frame(seq), 1: frame(seq) });
  stepWorld(ground, { 0: tap(20, BUTTONS.ATTACK), 1: frame(20) });
  assert.ok(dodger.action, 'spot dodge should cancel its final five frames into an attack');
  assert.equal(dodger.action.name, 'groundNeutral');
});

test('ledge attack places the fighter on top of the platform', () => {
  const world = worldWith(), player = world.players[0], platform = world.platforms[0];
  player.grounded = false; player.ledge = { platformId: platform.id, x: platform.x, y: platform.y, face: 1 };
  player.x = platform.x - 16; player.y = platform.y + 20; player.face = 1;
  stepWorld(world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  assert.equal(player.ledge, null);
  assert.equal(player.actionName, 'ledgeAttackClimb');
  assert.equal(player.grounded, false);
  const startX = player.x, startY = player.y;
  for (let seq = 2; seq <= 5; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(player.x > startX && player.x < platform.x + 38);
  assert.ok(player.y < startY && player.y > platform.y - player.height / 2);
  for (let seq = 6; seq <= 9; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(player.grounded, true);
  assert.equal(player.platformId, platform.id);
  assert.equal(player.y, platform.y - player.height / 2);
  assert.equal(player.actionName, 'groundNeutral');
});

test('KO and disconnect release both sides of a grab', () => {
  const ko = worldWith(), holder = ko.players[0], held = ko.players[1];
  holder.grabbing = held.i; held.grabbedBy = holder.i; holder.y = 1000;
  stepWorld(ko, { 0: frame(1), 1: frame(1) });
  assert.equal(holder.grabbing, null); assert.equal(held.grabbedBy, null);

  const disconnect = worldWith();
  disconnect.players[0].grabbing = 1; disconnect.players[1].grabbedBy = 0;
  assert.equal(forfeitPlayer(disconnect, 0), true);
  assert.equal(disconnect.players[0].grabbing, null); assert.equal(disconnect.players[1].grabbedBy, null);
});

test('boomerang reverses once and cannot hit the same target every frame', () => {
  const world = worldWith(), target = world.players[1];
  target.invincible = 0;
  world.entities.push({ id: 99, type: 'projectile', owner: 0, kind: 'boomerang', x: target.x, y: target.y, vx: 120, vy: 0, damage: 6, kx: 120, ky: 80, life: 50, color: '#fff', returnDamageScale: .62, hitPlayers: [] });
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  const entity = world.entities[0], firstDamage = target.damage;
  assert.equal(entity.returning, true); assert.equal(entity.vx, -120); assert.ok(firstDamage > 0);
  assert.ok(Math.abs(entity.damage - 3.72) < 1e-9);
  assert.ok(entity.kx < 120 && entity.ky < 80);
  stepWorld(world, { 0: frame(2), 1: frame(2) });
  assert.equal(entity.vx, -120); assert.equal(target.damage, firstDamage);
});

test('sudden death ends on the first KO and training reset clears transient state', () => {
  const sudden = worldWith({ mode: 'time' });
  sudden.suddenDeath = true; sudden.players[0].y = 1000;
  stepWorld(sudden, { 0: frame(1), 1: frame(1) });
  assert.equal(sudden.phase, 'ended'); assert.equal(sudden.winner, 1); assert.equal(sudden.players[0].respawn, 0);

  const training = worldWith({ mode: 'training' }), player = training.players[0];
  player.action = { name: 'groundSide', frame: 2, move: { startup: 3, active: 2, recovery: 9 } };
  player.stun = 30; player.dodgeFrames = 20; player.shielding = true; player.damage = 120; player.eliminated = true;
  player.heldItem = { ...ITEMS[0] };
  training.items.push({ id: 500, definition: ITEMS[0], x: 600, y: 490, vy: 0 });
  training.entities.push({ id: 501, type: 'projectile', owner: 0, life: 30, x: 600, y: 400, vx: 0, vy: 0 });
  assert.equal(trainingCommand(training, { type: 'reset', damage: 35 }), true);
  assert.equal(player.action, null); assert.equal(player.stun, 0); assert.equal(player.dodgeFrames, 0); assert.equal(player.shielding, false); assert.equal(player.damage, 0); assert.equal(player.eliminated, false);
  assert.equal(player.heldItem, null); assert.equal(training.items.length, 0); assert.equal(training.entities.length, 0);
  assert.equal(training.players[1].damage, 35);
});

test('training mode keeps an infinite clock while normal matches count down', () => {
  const freshTraining = createWorld({ rules: { mode: 'training', timeSeconds: 420 }, roster: [{ slot: 0, clientId: 'solo', characterId: 'volt' }] });
  assert.equal(freshTraining.phase, 'active');
  assert.equal(freshTraining.countdown, 0);

  const training = worldWith({ mode: 'training', timeSeconds: 420 });
  const trainingTicks = training.remainingTicks;
  stepWorld(training, { 0: frame(1), 1: frame(1) });
  assert.equal(training.remainingTicks, trainingTicks);

  const stock = worldWith({ mode: 'stock', timeSeconds: 420 });
  const stockTicks = stock.remainingTicks;
  stepWorld(stock, { 0: frame(1), 1: frame(1) });
  assert.equal(stock.remainingTicks, stockTicks - 1);
});

test('an attack pressed during hitstop is buffered and side specials face the input direction', () => {
  const buffered = worldWith();
  buffered.players[0].hitstop = 3;
  stepWorld(buffered, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 4; seq++) stepWorld(buffered, { 0: frame(seq), 1: frame(seq) });
  assert.equal(buffered.players[0].actionName, 'groundNeutral');
  assert.ok(buffered.players[0].action);

  const facing = worldWith();
  facing.players[0].face = 1; facing.players[1].x = 200;
  stepWorld(facing, { 0: tap(1, BUTTONS.SPECIAL, BUTTONS.LEFT, -1), 1: frame(1) });
  assert.equal(facing.players[0].face, -1);
  assert.equal(facing.players[0].actionName, 'specialSide');
});

test('armor only protects active frames and grabbing cancels the held fighter action', () => {
  const startup = worldWith();
  stepWorld(startup, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1, BUTTONS.LEFT | BUTTONS.SPECIAL, -1) });
  for (let seq = 2; seq <= 5; seq++) stepWorld(startup, { 0: frame(seq), 1: frame(seq) });
  assert.ok(startup.players[1].damage > 0);
  assert.equal(startup.players[1].action, null);

  const active = worldWith(), blaze = active.players[1], armorMove = { ...FIGHTERS.find(fighter => fighter.id === 'blaze').moves.specialSide, dash: false, defensiveOnly: true };
  blaze.action = { name: 'specialSide', move: armorMove, frame: armorMove.startup, hit: [], activated: true, startup: armorMove.startup };
  blaze.actionName = 'specialSide';
  stepWorld(active, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 5; seq++) stepWorld(active, { 0: frame(seq), 1: frame(seq) });
  assert.ok(blaze.damage > 0); assert.equal(blaze.stun, 0); assert.ok(blaze.action);

  const broken = worldWith(), breaker = broken.players[0], armoredBlaze = broken.players[1];
  breaker.x = 620; breaker.face = 1; armoredBlaze.x = 690;
  const strongMove = { ...FIGHTERS.find(fighter => fighter.id === 'blaze').moves.groundSide };
  const thresholdMove = { ...FIGHTERS.find(fighter => fighter.id === 'blaze').moves.specialSide, dash: false, defensiveOnly: true };
  breaker.action = { name: 'groundSide', move: strongMove, frame: strongMove.startup - 1, startup: strongMove.startup, hit: [], activated: false };
  breaker.actionName = 'groundSide';
  armoredBlaze.action = { name: 'specialSide', move: thresholdMove, frame: thresholdMove.startup, startup: thresholdMove.startup, hit: [], activated: true };
  armoredBlaze.actionName = 'specialSide';
  stepWorld(broken, { 0: frame(1), 1: frame(1) });
  assert.ok(armoredBlaze.damage >= strongMove.damage);
  assert.ok(armoredBlaze.stun > 0);
  assert.equal(armoredBlaze.action, null);

  const grab = worldWith();
  grab.players[1].x = 642;
  grab.players[1].action = { name: 'groundSide', move: { ...FIGHTERS[1].moves.groundSide, defensiveOnly: true }, frame: 2, hit: [] };
  grab.players[1].actionName = 'groundSide';
  stepWorld(grab, { 0: frame(1, BUTTONS.GRAB), 1: frame(1) });
  for (let seq = 2; seq <= 7; seq++) stepWorld(grab, { 0: frame(seq), 1: frame(seq) });
  assert.equal(grab.players[1].grabbedBy, 0); assert.equal(grab.players[1].action, null);
});

test('super armor ignores any launch while heavy armor breaks above its threshold', () => {
  const world = worldWith(), attacker = world.players[0], target = world.players[1];
  const superMove = {
    ...FIGHTERS[1].moves.specialSide,
    armor: true, armorType: 'super', armorThreshold: undefined, dash: false, defensiveOnly: true
  };
  target.action = { name: 'superArmorTest', move: superMove, frame: superMove.startup, startup: superMove.startup, hit: [], activated: true };
  target.actionName = 'superArmorTest'; target.vx = 25;
  world.entities.push({
    id: world.nextEntityId++, type: 'projectile', kind: 'armorBreaker', owner: attacker.i,
    x: target.x, y: target.y, vx: 0, vy: 0, radius: 30, damage: 30, kx: 700, ky: 420,
    knockbackGrowth: 1.2, hitstop: 7, arm: 0, life: 5, hitPlayers: []
  });
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.ok(target.damage > 0); assert.equal(target.stun, 0); assert.ok(target.action);
  assert.ok(Math.abs(target.vx) < 80 && Math.abs(target.vy) < 80, 'super armor must suppress knockback');

  const heavy = FIGHTERS[1].moves.specialSide;
  assert.equal(heavy.armorType, 'heavy'); assert.ok(heavy.armorThreshold < 30);
});

test('up special can only be used once before landing or grabbing a ledge', () => {
  const world = worldWith(), player = world.players[0];
  player.grounded = false; player.y = 400;
  stepWorld(world, { 0: frame(1, BUTTONS.UP | BUTTONS.SPECIAL, 0, -1), 1: frame(1) });
  assert.equal(player.actionName, 'specialUp'); assert.equal(player.recoveryAvailable, false);
  for (let seq = 2; seq <= 45; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  player.action = null; player.actionName = 'fall'; player.stun = 0;
  stepWorld(world, { 0: frame(46, BUTTONS.UP | BUTTONS.SPECIAL, 0, -1), 1: frame(46) });
  assert.equal(player.action, null);
});

test('Nova uncharged warp recovery remains viable without excessive vertical height', () => {
  const world = createWorld({ rules: { mode: 'training', stocks: 3, stageId: 'sky-rail' }, roster: [
    { slot: 0, clientId: 'nova', characterId: 'nova' },
    { slot: 1, clientId: 'dummy', characterId: 'volt' }
  ] });
  world.phase = 'active';
  const player = world.players[0];
  player.x = -120; player.y = 650; player.face = 1; player.grounded = false; player.platformId = null; player.invincible = 0;
  const startX = player.x, startY = player.y;
  let minimumY = startY;
  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.UP | BUTTONS.SPECIAL, 1, -1), 1: frame(1) });
  for (let seq = 2; seq <= 45; seq++) {
    stepWorld(world, { 0: frame(seq), 1: frame(seq) });
    minimumY = Math.min(minimumY, player.y);
  }
  const verticalReach = startY - minimumY;
  assert.ok(verticalReach >= 165 && verticalReach <= 210, `expected viable uncharged Nova vertical recovery, got ${verticalReach}`);
  assert.ok(player.x > startX + 170, `expected Nova to retain useful uncharged diagonal warp reach, got ${player.x - startX}`);
});

test('Nova neutral warp rises vertically, grants brief safety, and permits exit drift', () => {
  const world = createWorld({ rules: { mode: 'training', stocks: 3, stageId: 'sky-rail' }, roster: [
    { slot: 0, clientId: 'nova', characterId: 'nova' },
    { slot: 1, clientId: 'dummy', characterId: 'volt' }
  ] });
  world.phase = 'active';
  const player = world.players[0];
  player.x = 420; player.y = 600; player.face = -1; player.grounded = false; player.platformId = null; player.invincible = 0;
  const startX = player.x, startY = player.y;
  let minimumY = startY;
  stepWorld(world, { 0: frame(1, BUTTONS.UP | BUTTONS.SPECIAL, 0, -1), 1: frame(1) });
  for (let seq = 2; seq <= 5; seq++) { stepWorld(world, { 0: frame(seq), 1: frame(seq) }); minimumY = Math.min(minimumY, player.y); }
  assert.ok(Math.abs(player.x - startX) < 8, `neutral warp should not inherit facing drift: ${player.x - startX}`);
  assert.ok(player.invincible > 0, 'warp reappearance should have brief protection');
  const activatedX = player.x;
  for (let seq = 6; seq <= 13; seq++) { stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT, 1), 1: frame(seq) }); minimumY = Math.min(minimumY, player.y); }
  assert.ok(player.x > activatedX + 20, 'recovery drift should allow a ledge correction after reappearing');
  for (let seq = 14; seq <= 36; seq++) { stepWorld(world, { 0: frame(seq), 1: frame(seq) }); minimumY = Math.min(minimumY, player.y); }
  const verticalReach = startY - minimumY;
  assert.ok(verticalReach >= 185 && verticalReach <= 225, `neutral uncharged vertical reach should remain bounded: ${verticalReach}`);
});

test('Nova blink and warp travel farther as X charge increases', () => {
  const makeNovaWorld = () => {
    const world = createWorld({ rules: { mode: 'training', stocks: 3, stageId: 'neon-deck' }, roster: [
      { slot: 0, clientId: 'nova', characterId: 'nova' },
      { slot: 1, clientId: 'dummy', characterId: 'volt' }
    ] });
    world.phase = 'active';
    world.players[0].x = 420;
    world.players[1].x = 1080;
    world.players.forEach(player => { player.invincible = 0; });
    return world;
  };

  const quick = makeNovaWorld(), quickNova = quick.players[0], quickStart = quickNova.x;
  stepWorld(quick, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.SPECIAL, 1), 1: frame(1) });
  for (let seq = 2; seq <= 14; seq++) stepWorld(quick, { 0: frame(seq, BUTTONS.RIGHT, 1), 1: frame(seq) });
  const quickDistance = quickNova.x - quickStart;

  const charged = makeNovaWorld(), chargedNova = charged.players[0], chargedStart = chargedNova.x;
  for (let seq = 1; seq <= 60; seq++) {
    stepWorld(charged, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.SPECIAL, 1), 1: frame(seq) });
  }
  const chargedDistance = chargedNova.x - chargedStart;
  assert.ok(chargedDistance > quickDistance + 70, `expected charge-scaled blink distance: ${quickDistance} -> ${chargedDistance}`);
});

test('Nova post-warp freefall remains finite and keeps directional drift responsive', () => {
  const world = createWorld({ rules: { mode: 'training', stocks: 3, stageId: 'sky-rail' }, roster: [
    { slot: 0, clientId: 'nova', characterId: 'nova' },
    { slot: 1, clientId: 'dummy', characterId: 'volt' }
  ] });
  world.phase = 'active';
  const player = world.players[0];
  player.x = -120; player.y = 520; player.grounded = false; player.platformId = null;
  stepWorld(world, { 0: frame(1, BUTTONS.UP | BUTTONS.SPECIAL, 0, -1), 1: frame(1) });
  for (let seq = 2; seq <= 42; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });

  assert.equal(player.freefall, true);
  const beforeDrift = player.x;
  for (let seq = 43; seq <= 54; seq++) {
    stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT, 1, 0), 1: frame(seq) });
  }
  assert.ok(player.x > beforeDrift + 12, `post-warp drift should stay responsive: ${player.x - beforeDrift}`);

  for (let seq = 55; seq <= 74; seq++) {
    const vertical = seq % 2 ? -1 : 1;
    const buttons = vertical < 0 ? BUTTONS.UP : BUTTONS.DOWN;
    stepWorld(world, { 0: frame(seq, buttons, 0, vertical), 1: frame(seq) });
    assert.ok(Number.isFinite(player.x) && Number.isFinite(player.y));
    assert.ok(Number.isFinite(player.vx) && Number.isFinite(player.vy));
  }
  assert.equal(player.action, null, 'direction input must not restart or duplicate the warp');
});

test('walking off a platform preserves coyote jump instead of auto-grabbing the ledge', () => {
  const world = worldWith(), player = world.players[0], platform = world.platforms[0];
  player.grounded = false; player.coyoteFrames = 5; player.x = platform.x + platform.w + 10; player.y = platform.y - player.height / 2 + 6; player.vy = 20;
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  assert.equal(player.ledge, null); assert.ok(player.coyoteFrames > 0);
  stepWorld(world, { 0: frame(2, BUTTONS.UP, 0, -1), 1: frame(2) });
  assert.ok(player.vy < -400); assert.equal(player.ledge, null); assert.equal(player.jumps, 1); assert.equal(player.doubleJumpSerial, 0);
});

test('walking off after coyote time still leaves one usable air jump', () => {
  const world = worldWith(), player = world.players[0], platform = world.platforms[0];
  player.grounded = false; player.coyoteFrames = 2; player.jumps = 2; player.x = platform.x + platform.w + 70; player.y = platform.y - player.height / 2; player.vy = 30;
  for (let seq = 1; seq <= 4; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(player.coyoteFrames, 0); assert.equal(player.jumps, 1); assert.equal(player.ledge, null);
  stepWorld(world, { 0: frame(5, BUTTONS.UP, 0, -1), 1: frame(5) });
  assert.ok(player.vy < -400); assert.equal(player.jumps, 0); assert.equal(player.doubleJumpSerial, 1);
});

test('Neon Deck main terrain is solid ground while its edges remain grabbable', () => {
  const sideWorld = worldWith({ stageId: 'neon-deck' }), sidePlayer = sideWorld.players[0], ground = sideWorld.platforms[0];
  assert.equal(ground.ground, true);
  sidePlayer.grounded = false; sidePlayer.platformId = null; sidePlayer.coyoteFrames = 0; sidePlayer.invincible = 0;
  sidePlayer.x = ground.x - sidePlayer.width / 2 - 2; sidePlayer.y = ground.y + 100;
  sidePlayer.vx = 300; sidePlayer.vy = 0;
  stepWorld(sideWorld, { 0: frame(1), 1: frame(1) });
  assert.equal(sidePlayer.x, ground.x - sidePlayer.width / 2);
  assert.ok(sidePlayer.vx <= 0, 'solid ground side must stop inward movement');

  const belowWorld = worldWith({ stageId: 'neon-deck' }), belowPlayer = belowWorld.players[0], belowGround = belowWorld.platforms[0];
  belowPlayer.grounded = false; belowPlayer.platformId = null; belowPlayer.coyoteFrames = 0; belowPlayer.invincible = 0;
  const bodyTop = belowGround.y + 8;
  belowPlayer.x = belowGround.x + belowGround.w / 2;
  belowPlayer.y = bodyTop + belowPlayer.height / 2 + 2;
  belowPlayer.vx = 0; belowPlayer.vy = -320;
  stepWorld(belowWorld, { 0: frame(1), 1: frame(1) });
  assert.ok(belowPlayer.y >= bodyTop + belowPlayer.height / 2, 'fighter below solid ground must not pass through its top');
  assert.ok(belowPlayer.vy >= 0, 'solid ground underside must cancel upward velocity');

  const ledgeWorld = worldWith({ stageId: 'neon-deck' }), ledgePlayer = ledgeWorld.players[0], ledgeGround = ledgeWorld.platforms[0];
  ledgePlayer.grounded = false; ledgePlayer.platformId = null; ledgePlayer.coyoteFrames = 0; ledgePlayer.invincible = 0;
  ledgePlayer.x = ledgeGround.x - 28; ledgePlayer.y = ledgeGround.y + 8;
  ledgePlayer.vx = 300; ledgePlayer.vy = 40;
  stepWorld(ledgeWorld, { 0: frame(1), 1: frame(1) });
  assert.ok(ledgePlayer.ledge, 'solid side wall must not block the ledge catch window');

  const attackWorld = worldWith({ stageId: 'neon-deck' }), attackPlayer = attackWorld.players[0], attackGround = attackWorld.platforms[0];
  attackPlayer.grounded = false; attackPlayer.platformId = null; attackPlayer.coyoteFrames = 0; attackPlayer.invincible = 0;
  attackPlayer.x = attackGround.x - attackPlayer.width / 2 - 2; attackPlayer.y = attackGround.y + 8;
  attackPlayer.vx = 420; attackPlayer.vy = 0;
  const aerial = { ...FIGHTERS[0].moves.airNeutral };
  attackPlayer.action = { name: 'airNeutral', move: aerial, frame: 1, startup: aerial.startup, hit: [], activated: false };
  attackPlayer.actionName = 'airNeutral';
  stepWorld(attackWorld, { 0: frame(1), 1: frame(1) });
  assert.ok(attackPlayer.x <= attackGround.x - attackPlayer.width / 2, 'an aerial action must collide with the solid side instead of entering it');

  const embeddedWorld = worldWith({ stageId: 'neon-deck' }), embedded = embeddedWorld.players[0], embeddedGround = embeddedWorld.platforms[0];
  embedded.grounded = false; embedded.platformId = null; embedded.coyoteFrames = 0; embedded.invincible = 0;
  embedded.x = embeddedGround.x + embeddedGround.w / 2;
  embedded.y = embeddedGround.y + 24;
  embedded.vx = 0; embedded.vy = 120;
  stepWorld(embeddedWorld, { 0: frame(1), 1: frame(1) });
  assert.ok(embedded.y + embedded.height / 2 <= embeddedGround.y, 'a fighter already inside solid ground must be ejected through its nearest face');
});

test('late recovery input chains into the next action', () => {
  const world = worldWith(), player = world.players[0], move = { ...FIGHTERS[0].moves.groundNeutral };
  world.players[1].x = 1000;
  player.action = { name: 'groundNeutral', move, frame: move.startup + move.active + move.recovery - 5, hit: [], activated: true, startup: move.startup };
  player.actionName = 'groundNeutral';
  stepWorld(world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 6; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(player.action); assert.equal(player.action.name, 'groundJab2'); assert.ok(player.action.frame <= 4);
});

test('late ultimate pre-input executes once while an early buffer expires cleanly', () => {
  const lateWorld = worldWith(), late = lateWorld.players[0], move = { ...FIGHTERS[0].moves.groundNeutral };
  lateWorld.players[1].x = 1000; late.ultimateMeter = 100;
  late.action = { name: 'groundNeutral', move, frame: move.startup + move.active + move.recovery - 5, hit: [], activated: true, startup: move.startup };
  late.actionName = 'groundNeutral';
  stepWorld(lateWorld, { 0: frame(1, BUTTONS.ATTACK | BUTTONS.SPECIAL), 1: frame(1) });
  for (let seq = 2; seq <= 7; seq++) stepWorld(lateWorld, { 0: frame(seq), 1: frame(seq) });
  assert.equal(late.action?.name, 'ultimate');
  assert.equal(lateWorld.events.filter(event => event.type === 'ultimate-start' && event.player === late.i).length, 1);

  const earlyWorld = worldWith(), early = earlyWorld.players[0], longMove = { ...FIGHTERS[1].moves.groundSide };
  earlyWorld.players[1].x = 1000; early.ultimateMeter = 100;
  early.action = { name: 'groundSide', move: longMove, frame: 0, hit: [], activated: false, startup: longMove.startup };
  early.actionName = 'groundSide';
  stepWorld(earlyWorld, { 0: frame(1, BUTTONS.ATTACK | BUTTONS.SPECIAL), 1: frame(1) });
  for (let seq = 2; seq <= 14; seq++) stepWorld(earlyWorld, { 0: frame(seq), 1: frame(seq) });
  assert.equal(early.actionBuffer, null);
  assert.notEqual(early.action?.name, 'ultimate');
  assert.equal(early.ultimateMeter, 100);
});

test('holding a direction alone never cancels attack recovery', () => {
  const world = worldWith(), player = world.players[0], move = { ...FIGHTERS[0].moves.groundNeutral };
  world.players[1].x = 1000;
  player.action = { name: 'groundNeutral', move, frame: move.startup + move.active + move.recovery - 5, hit: [], activated: true, startup: move.startup };
  player.actionName = 'groundNeutral';

  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT, 1), 1: frame(1) });

  assert.equal(player.action?.name, 'groundNeutral');
  assert.equal(world.events.some(event => event.type === 'action-cancel'), false);
});

test('holding an early buffered attack preserves it and converts it into a smash when interruptible', () => {
  const world = worldWith(), player = world.players[0], move = { ...FIGHTERS[1].moves.dashAttack };
  world.players[1].x = 1000;
  player.action = { name: 'dashAttack', move, frame: move.startup + move.active, hit: [], activated: true, startup: move.startup };
  player.actionName = 'dashAttack';
  for (let seq = 1; seq <= 16; seq++) stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(seq) });
  assert.ok(world.events.some(event => event.type === 'action-cancel' && event.action === 'dashAttack'));
  assert.ok(player.action); assert.equal(player.action.name, 'groundSide'); assert.equal(player.action.variant, 'smash'); assert.equal(player.action.charging, true);
});

test('an early buffered tap still expires when the button is released', () => {
  const world = worldWith(), player = world.players[0], move = { ...FIGHTERS[1].moves.dashAttack };
  world.players[1].x = 1000;
  player.action = { name: 'dashAttack', move, frame: move.startup + move.active, hit: [], activated: true, startup: move.startup };
  player.actionName = 'dashAttack';
  stepWorld(world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 12; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.equal(player.action?.name, 'dashAttack'); assert.equal(player.actionBuffer, null);
});

test('core splash, static stun, and gravity pull give specials distinct behavior', () => {
  const world = createWorld({ rules: { mode: 'stock', stocks: 3 }, roster: [
    { slot: 0, clientId: 'p0', characterId: 'blaze' },
    { slot: 1, clientId: 'p1', characterId: 'volt' },
    { slot: 2, clientId: 'p2', characterId: 'bolt' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  world.players.forEach(player => { player.invincible = 0; player.grounded = false; player.y = 350; });
  world.players[0].x = 400; world.players[1].x = 600; world.players[2].x = 650;
  world.entities.push({ id: 1, type: 'projectile', owner: 0, kind: 'core', x: 600, y: 350, vx: 0, vy: 0, damage: 12, kx: 260, ky: 120, life: 30, radius: 45, splashRadius: 95, hitPlayers: [] });
  stepWorld(world, { 0: frame(1), 1: frame(1), 2: frame(1) });
  assert.ok(world.players[1].damage > 0); assert.ok(world.players[2].damage > 0);

  const staticWorld = worldWith(), staticTarget = staticWorld.players[1];
  staticTarget.invincible = 0;
  staticWorld.entities.push({ id: 2, type: 'trap', owner: 0, kind: 'static', x: staticTarget.x, y: staticTarget.y, vx: 0, vy: 0, damage: 4, kx: 60, ky: 30, life: 30, radius: 70, arm: 0, stunBonus: 30, hitPlayers: [] });
  stepWorld(staticWorld, { 0: frame(1), 1: frame(1) });
  assert.ok(staticTarget.stun >= 30);

  const gravity = worldWith(), gravityTarget = gravity.players[1];
  gravityTarget.x = 720; gravityTarget.vx = 0; gravityTarget.invincible = 0;
  gravity.entities.push({ id: 3, type: 'trap', owner: 0, kind: 'gravity', x: 620, y: gravityTarget.y, vx: 0, vy: 0, damage: 2, kx: 1, ky: 1, life: 60, radius: 135, arm: 0, persistent: true, hitPlayers: [gravityTarget.i] });
  stepWorld(gravity, { 0: frame(1), 1: frame(1) });
  assert.ok(gravityTarget.vx < 0); assert.equal(gravity.entities.length, 1);
});

test('CPU recovery aims toward the stage and spends up special before falling out', () => {
  const world = createWorld({ rules: { mode: 'training', stocks: 3 }, seed: 19, cpu: 'normal', roster: [
    { slot: 0, clientId: 'human', characterId: 'volt' },
    { slot: 1, clientId: 'cpu:recovery', characterId: 'nova' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const human = world.players[0], cpu = world.players[1], platform = world.platforms[0];
  human.x = 640; human.y = platform.y - human.height / 2; human.grounded = true;
  cpu.x = platform.x - 180; cpu.y = platform.y + 130; cpu.grounded = false;
  cpu.jumps = 0; cpu.recoveryAvailable = true; cpu.invincible = 0; cpu.lastInput = frame(0);

  stepWorld(world, { 0: frame(1) });

  assert.equal(cpu.lastInput.vertical, -1);
  assert.equal(cpu.lastInput.horizontal, 1);
  assert.ok(cpu.lastInput.buttons & BUTTONS.SPECIAL);
  assert.equal(cpu.action?.name, 'specialUp');
});

test('CPU recovery prefers its air jump, targets solid ledges, and returns on every stage', () => {
  for (const stage of STAGES) {
    for (const fighter of FIGHTERS) {
      const world = createWorld({ rules: { mode: 'training', stocks: 3, stageId: stage.id }, seed: 91, cpu: 'hard', roster: [
        { slot: 0, clientId: 'human', characterId: 'volt' },
        { slot: 1, clientId: `cpu:${fighter.id}`, characterId: fighter.id }
      ] });
      world.phase = 'active'; world.countdown = 0;
      const human = world.players[0], cpu = world.players[1];
      const solid = world.platforms.filter(platform => !platform.passThrough).sort((a, b) => b.w - a.w)[0];
      human.x = solid.x + solid.w / 2; human.y = solid.y - human.height / 2; human.grounded = true;
      cpu.x = solid.x - 145; cpu.y = solid.y + 82; cpu.grounded = false; cpu.platformId = null;
      cpu.vx = -120; cpu.vy = 145; cpu.jumps = 1; cpu.recoveryAvailable = true; cpu.invincible = 0; cpu.lastInput = frame(0);

      stepWorld(world, { 0: frame(1) });
      assert.ok(cpu.lastInput.buttons & BUTTONS.UP, `${stage.id}/${fighter.id} should air jump first`);
      assert.equal(cpu.lastInput.buttons & BUTTONS.SPECIAL, 0, `${stage.id}/${fighter.id} should preserve Up-X initially`);

      let recovered = cpu.grounded || !!cpu.ledge;
      for (let seq = 2; seq <= 360 && !recovered; seq++) {
        stepWorld(world, { 0: frame(seq) });
        recovered = cpu.grounded || !!cpu.ledge;
      }
      assert.equal(recovered, true, `${stage.id}/${fighter.id} should recover to solid terrain or a ledge`);
      assert.equal(cpu.stocks, 3, `${stage.id}/${fighter.id} should not self-destruct during recovery`);
    }
  }
});

test('hard CPU does not run a side special off the ledge after an offstage target', () => {
  const world = createWorld({ rules: { mode: 'training', stocks: 3, stageId: 'neon-deck' }, seed: 4, cpu: 'hard', roster: [
    { slot: 0, clientId: 'human', characterId: 'volt' },
    { slot: 1, clientId: 'cpu:edge', characterId: 'blaze' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const target = world.players[0], cpu = world.players[1], platform = world.platforms[0];
  cpu.x = platform.x + 65; cpu.y = platform.y - cpu.height / 2; cpu.grounded = true; cpu.platformId = platform.id;
  target.x = platform.x - 55; target.y = platform.y + 35; target.grounded = false; target.platformId = null;

  for (let seq = 1; seq <= 18; seq++) stepWorld(world, { 0: frame(seq) });

  assert.notEqual(cpu.action?.name, 'specialSide');
  assert.ok(cpu.x >= platform.x - 5, 'CPU should hold the ledge instead of carrying itself offstage');
});

test('BOLT CPU sandwiches a target with its returning boomerang', () => {
  const world = createWorld({ rules: { mode: 'training', stocks: 3, stageId: 'neon-deck' }, seed: 77, cpu: 'hard', roster: [
    { slot: 0, clientId: 'human', characterId: 'volt' },
    { slot: 1, clientId: 'cpu:bolt', characterId: 'bolt' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const target = world.players[0], cpu = world.players[1], platform = world.platforms[0];
  target.x = 600; target.y = platform.y - target.height / 2; target.grounded = true; target.platformId = platform.id;
  cpu.x = 400; cpu.y = platform.y - cpu.height / 2; cpu.grounded = true; cpu.platformId = platform.id;
  world.entities.push({
    id: 999, type: 'projectile', owner: cpu.i, kind: 'boomerang',
    x: 800, y: target.y, vx: -500, vy: 0, damage: 6, kx: 120, ky: 80,
    life: 40, radius: 32, returning: true, returnDamageScale: .62, color: '#fff', hitPlayers: []
  });

  stepWorld(world, { 0: frame(1) });

  assert.equal(cpu.lastInput.horizontal, 1);
  assert.equal(cpu.lastInput.buttons & BUTTONS.SPECIAL, 0);
});

test('CPU uses neutral jabs up close and holds a punish long enough to create a smash', () => {
  const jabWorld = createWorld({ rules: { mode: 'training', stocks: 3 }, seed: 18, cpu: 'normal', roster: [
    { slot: 0, clientId: 'human', characterId: 'volt' },
    { slot: 1, clientId: 'cpu:jab', characterId: 'blaze' }
  ] });
  jabWorld.phase = 'active'; jabWorld.countdown = 0;
  const jabTarget = jabWorld.players[0], jabCpu = jabWorld.players[1], platform = jabWorld.platforms[0];
  jabCpu.x = 620; jabTarget.x = 655;
  for (const player of [jabCpu, jabTarget]) {
    player.y = platform.y - player.height / 2; player.grounded = true; player.platformId = platform.id;
  }
  stepWorld(jabWorld, { 0: frame(1) });
  stepWorld(jabWorld, { 0: frame(2) });
  assert.equal(jabCpu.lastInput.horizontal, 0);
  assert.equal(jabCpu.action?.name, 'groundNeutral');

  const smashWorld = createWorld({ rules: { mode: 'training', stocks: 3 }, seed: 29, cpu: 'hard', roster: [
    { slot: 0, clientId: 'human', characterId: 'volt' },
    { slot: 1, clientId: 'cpu:smash', characterId: 'bolt' }
  ] });
  smashWorld.phase = 'active'; smashWorld.countdown = 0;
  const smashTarget = smashWorld.players[0], smashCpu = smashWorld.players[1], smashPlatform = smashWorld.platforms[0];
  smashCpu.x = 560; smashTarget.x = 640; smashTarget.damage = 120; smashTarget.stun = 30;
  for (const player of [smashCpu, smashTarget]) {
    player.y = smashPlatform.y - player.height / 2; player.grounded = true; player.platformId = smashPlatform.id;
  }
  for (let seq = 1; seq <= 18; seq++) stepWorld(smashWorld, { 0: frame(seq) });
  assert.equal(smashCpu.action?.name, 'groundSide');
  assert.equal(smashCpu.action?.variant, 'smash');
  assert.ok(smashCpu.action?.charging || smashCpu.action?.chargeScale > 1);
});

test('hard CPU recognizes a shielding opponent and chooses a grab punish', () => {
  const world = createWorld({ rules: { mode: 'training', stocks: 3 }, seed: 42, cpu: 'hard', roster: [
    { slot: 0, clientId: 'human', characterId: 'volt' },
    { slot: 1, clientId: 'cpu:grappler', characterId: 'blaze' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const human = world.players[0], cpu = world.players[1], platform = world.platforms[0];
  human.x = 620; cpu.x = 680;
  for (const player of world.players) {
    player.y = platform.y - player.height / 2; player.grounded = true; player.invincible = 0; player.lastInput = frame(0);
  }
  human.shielding = true; human.shield = 50;

  stepWorld(world, { 0: frame(1, BUTTONS.SHIELD) });

  assert.ok(cpu.lastInput.buttons & BUTTONS.GRAB);
  assert.equal(cpu.action?.name, 'grab');
});

test('hard CPU keeps its four-frame combat reactions and forces a stalled duel back into engagement', () => {
  const world = createWorld({ rules: { mode: 'stock', stocks: 3, stageId: 'neon-deck' }, seed: 96, cpu: 'hard', roster: [
    { slot: 0, clientId: 'cpu:initiative-a', characterId: 'volt' },
    { slot: 1, clientId: 'cpu:initiative-b', characterId: 'nova' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const platform = world.platforms[0];
  world.players.forEach((player, index) => {
    player.x = 470 + index * 340;
    player.y = platform.y - player.height / 2;
    player.grounded = true;
    player.platformId = platform.id;
    player.invincible = 0;
  });

  stepWorld(world, {});
  for (const brain of world.cpuBrains.values()) assert.equal(brain.nextDecision - world.tick, 4);

  let firstExchange = null;
  let exchanges = 0;
  let previousHits = world.players.reduce((sum, player) => sum + player.hitId, 0);
  for (let frameIndex = 0; frameIndex < 720 && world.phase === 'active'; frameIndex++) {
    stepWorld(world, {});
    const hits = world.players.reduce((sum, player) => sum + player.hitId, 0);
    if (hits > previousHits) {
      firstExchange ??= world.tick;
      exchanges += hits - previousHits;
      previousHits = hits;
    }
  }

  assert.ok(firstExchange != null && firstExchange < 240, 'Hard CPUs should initiate before a duel becomes idle');
  assert.ok(exchanges >= 4, 'Hard CPUs should sustain pressure instead of returning to a spacing deadlock');
});

test('team CPU ignores a nearby ally and navigates toward an enemy', () => {
  const world = createWorld({ rules: { mode: 'team', teams: true, stocks: 3 }, seed: 7, cpu: 'normal', roster: [
    { slot: 0, clientId: 'ally', characterId: 'volt', team: 0 },
    { slot: 1, clientId: 'cpu:team', characterId: 'bolt', team: 0 },
    { slot: 2, clientId: 'enemy', characterId: 'nova', team: 1 }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const [ally, cpu, enemy] = world.players, platform = world.platforms[0];
  ally.x = 590; cpu.x = 640; enemy.x = 930;
  for (const player of world.players) {
    player.y = platform.y - player.height / 2; player.grounded = true; player.invincible = 0; player.lastInput = frame(0);
  }

  stepWorld(world, { 0: frame(1), 2: frame(1) });

  assert.ok(cpu.lastInput.horizontal >= 0, 'CPU must not chase or attack its closer teammate');
});

test('free-for-all CPUs spread short target locks instead of dogpiling one fighter', () => {
  const world = createWorld({ rules: { mode: 'stock', stocks: 3 }, seed: 81, cpu: 'normal', roster: [
    { slot: 0, clientId: 'cpu:volt', characterId: 'volt' },
    { slot: 1, clientId: 'cpu:blaze', characterId: 'blaze' },
    { slot: 2, clientId: 'cpu:bolt', characterId: 'bolt' },
    { slot: 3, clientId: 'cpu:nova', characterId: 'nova' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const platform = world.platforms[0];
  world.players.forEach((player, index) => {
    player.x = 520 + index * 70;
    player.y = platform.y - player.height / 2;
    player.grounded = true;
    player.platformId = platform.id;
    player.invincible = 0;
  });

  stepWorld(world, {});

  const targetCounts = new Map();
  for (const brain of world.cpuBrains.values()) {
    targetCounts.set(brain.targetId, (targetCounts.get(brain.targetId) || 0) + 1);
    assert.ok(brain.targetLockUntil > world.tick);
  }
  assert.ok(targetCounts.size >= 2);
  assert.ok(Math.max(...targetCounts.values()) <= 2);
});

test('NOVA distance charge moves the real fighter as a vulnerable star and releases at that position', () => {
  const world = createWorld({ rules: { mode: 'training', stageId: 'neon-deck' }, roster: [
    { slot: 0, clientId: 'nova-player', characterId: 'nova' },
    { slot: 1, clientId: 'cpu:dummy', characterId: 'volt' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const nova = world.players[0], dummy = world.players[1], platform = world.platforms[0];
  nova.x = 520; nova.y = platform.y - nova.height / 2; nova.grounded = true; nova.invincible = 0;
  dummy.x = 1000; dummy.y = platform.y - dummy.height / 2; dummy.grounded = true; dummy.invincible = 0;
  const origin = nova.x;

  for (let seq = 1; seq <= 20; seq++) {
    stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.SPECIAL, 1), 1: frame(seq) });
  }
  assert.equal(nova.action?.name, 'specialSide');
  assert.equal(nova.action?.charging, true);
  assert.ok(nova.x > origin + 25, 'the authoritative fighter position should advance while the star charges');
  const chargedX = nova.x;
  const snapshot = publicSnapshot(world).players[0];
  assert.equal(snapshot.actionPhase, 'charge');
  assert.equal(snapshot.x, nova.x);
  assert.ok(snapshot.phaseProgress > 0 && snapshot.phaseProgress < 1);

  world.entities.push({
    id: world.nextEntityId++, type: 'projectile', owner: dummy.i, kind: 'pulse',
    x: nova.x, y: nova.y, vx: 0, vy: 0, damage: 4, kx: 80, ky: 40,
    life: 8, radius: 28, hitPlayers: []
  });
  stepWorld(world, { 0: frame(21, 0, 0), 1: frame(21) });
  assert.ok(nova.damage > 0, 'star form must remain hittable');
  assert.equal(nova.invincible, 0, 'star form must not grant invincibility');
  assert.ok(Math.abs(nova.x - chargedX) < 35, 'release must not apply the teleport distance a second time');
});

test('NOVA charged star cannot cross solid stage bodies', () => {
  const world = createWorld({ rules: { mode: 'training', stageId: 'neon-deck' }, roster: [
    { slot: 0, clientId: 'nova-player', characterId: 'nova' },
    { slot: 1, clientId: 'cpu:dummy', characterId: 'volt' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const nova = world.players[0], dummy = world.players[1];
  const ground = world.platforms.find(platform => platform.ground);
  const wallLimit = ground.x - nova.width / 2;
  nova.x = wallLimit - 90; nova.y = ground.y + 145;
  nova.grounded = false; nova.platformId = null; nova.coyoteFrames = 0; nova.invincible = 0;
  dummy.x = 1100; dummy.y = 250; dummy.grounded = false; dummy.invincible = 0;

  for (let seq = 1; seq <= 26; seq++) {
    stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.SPECIAL, 1), 1: frame(seq) });
  }
  assert.ok(nova.x <= wallLimit + 0.01, 'solid wall must stop the charging star at its outer face');

  for (let seq = 27; seq <= 33; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(nova.x <= wallLimit + 0.01, 'release and active frames must not warp through the wall');
});

test('NOVA charged star passes through player pushboxes without becoming invincible', () => {
  const world = createWorld({ rules: { mode: 'training', stageId: 'neon-deck' }, roster: [
    { slot: 0, clientId: 'nova-player', characterId: 'nova' },
    { slot: 1, clientId: 'cpu:dummy', characterId: 'blaze' }
  ] });
  world.phase = 'active'; world.countdown = 0;
  const nova = world.players[0], dummy = world.players[1], ground = world.platforms.find(platform => platform.ground);
  nova.x = 500; dummy.x = 625;
  for (const player of world.players) {
    player.y = ground.y - player.height / 2;
    player.grounded = true;
    player.invincible = 0;
  }

  for (let seq = 1; seq <= 26; seq++) {
    stepWorld(world, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.SPECIAL, 1), 1: frame(seq) });
  }

  assert.equal(nova.action?.charging, true);
  assert.ok(nova.x > dummy.x + dummy.width / 2, 'charging star should pass completely through another fighter');
  assert.equal(dummy.damage, 0, 'passing through during charge is movement, not a hidden attack');
  assert.equal(nova.invincible, 0, 'player pushbox phasing must not grant invincibility');
});
