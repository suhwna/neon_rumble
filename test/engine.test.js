const test = require('node:test');
const assert = require('node:assert/strict');
const { BUTTONS, FIGHTERS, ITEMS } = require('../content');
const { BLAST_MARGIN_X, createWorld, stepWorld, publicSnapshot, trainingCommand, forfeitPlayer } = require('../engine');

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
  assert.ok(byId.blaze.weight > byId.volt.weight * 1.2);
  assert.ok(byId.blaze.weight < byId.volt.weight * 1.3, 'weight gap should not dominate launch outcomes');
  assert.ok(byId.volt.moves.specialNeutral.projectileCooldown >= 40);
  assert.ok(byId.nova.air <= 1.16);
  assert.ok(byId.bolt.moves.specialSide.recovery <= 15);
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

test('pressing neutral shield opens an order-independent five-frame parry with punish advantage', () => {
  const world = worldWith();
  const attacker = world.players[0], defender = world.players[1];
  const attack = { ...FIGHTERS[0].moves.groundNeutral };
  attacker.action = { name: 'groundNeutral', move: attack, frame: attack.startup - 1, startup: attack.startup, hit: [], activated: false };
  attacker.actionName = 'groundNeutral';
  stepWorld(world, { 0: frame(1), 1: frame(1, BUTTONS.SHIELD) });
  assert.equal(defender.damage, 0);
  assert.equal(defender.shield, 100);
  assert.ok(attacker.hitstop >= 16);
  assert.ok(defender.hitstop >= 2);
  assert.equal(defender.shieldDropLag, 0);
  assert.equal(defender.actionName, 'parrySuccess');
  assert.ok(world.events.some(event => event.type === 'parry'));

  const reversed = worldWith(), first = reversed.players[0], second = reversed.players[1];
  const reverseAttack = { ...FIGHTERS[1].moves.groundNeutral };
  second.action = { name: 'groundNeutral', move: reverseAttack, frame: reverseAttack.startup - 1, startup: reverseAttack.startup, hit: [], activated: false };
  second.actionName = 'groundNeutral';
  stepWorld(reversed, { 0: frame(1, BUTTONS.SHIELD), 1: frame(1) });
  assert.equal(first.damage, 0);
  assert.ok(second.hitstop >= 16);
  assert.ok(reversed.events.some(event => event.type === 'parry' && event.player === first.i));
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
  const tilt = worldWith();
  stepWorld(tilt, { 0: frame(1, BUTTONS.DOWN, 0, 1), 1: frame(1) });
  stepWorld(tilt, { 0: frame(2, BUTTONS.DOWN | BUTTONS.ATTACK, 0, 1), 1: frame(2) });
  assert.equal(tilt.players[0].action, null);
  stepWorld(tilt, { 0: frame(3, BUTTONS.DOWN, 0, 1), 1: frame(3) });
  assert.equal(tilt.players[0].action?.name, 'groundDown');
  assert.equal(tilt.players[0].action?.variant, 'tilt');
  assert.equal(tilt.players[0].action?.move.chargeable, false);

  const smash = worldWith();
  stepWorld(smash, { 0: frame(1, BUTTONS.DOWN | BUTTONS.ATTACK, 0, 1), 1: frame(1) });
  for (let seq = 2; seq <= 10; seq++) stepWorld(smash, { 0: frame(seq, BUTTONS.DOWN | BUTTONS.ATTACK, 0, 1), 1: frame(seq) });
  assert.equal(smash.players[0].action, null);
  stepWorld(smash, { 0: frame(11, BUTTONS.DOWN | BUTTONS.ATTACK, 0, 1), 1: frame(11) });
  assert.equal(smash.players[0].action?.name, 'groundDown');
  assert.equal(smash.players[0].action?.variant, 'smash');
  assert.equal(smash.players[0].action?.move.chargeable, true);
  assert.equal(smash.players[0].action?.charging, true);
  assert.ok(smash.players[0].action.move.damage > tilt.players[0].action.move.damage);
  assert.equal(publicSnapshot(smash).players[0].actionVariant, 'smash');

  const specialButton = worldWith();
  stepWorld(specialButton, { 0: frame(1, BUTTONS.SPECIAL), 1: frame(1) });
  assert.equal(specialButton.players[0].action?.name, 'specialNeutral');
  assert.equal(specialButton.players[0].action?.variant, 'normal');
  for (let seq = 2; seq <= 8; seq++) stepWorld(specialButton, { 0: frame(seq, BUTTONS.SPECIAL), 1: frame(seq) });
  assert.equal(specialButton.players[0].action?.name, 'specialNeutral');
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
  assert.ok(byId.blaze.moves.specialSide.damage <= 18);
  assert.ok(byId.blaze.moves.specialSide.kx <= 470);
  assert.ok(byId.volt.moves.specialSide.startup >= 6);
  assert.ok(byId.volt.moves.specialSide.recovery >= 17);
  assert.ok(byId.bolt.moves.specialSide.kx >= 420);
  assert.ok(byId.bolt.moves.specialUp.riseHorizontal >= 200);
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
  let sequence = 0;
  function landAttack() {
    const attacker = world.players[0], target = world.players[1];
    attacker.x = 600; attacker.y = 475; attacker.vx = 0; attacker.vy = 0; attacker.grounded = true; attacker.action = null; attacker.hitstop = 0; attacker.lastInput = frame(sequence);
    target.x = 660; target.y = 471; target.vx = 0; target.vy = 0; target.grounded = true; target.hitstop = 0; target.stun = 0; target.invincible = 0;
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
  const freshDamage = 10.5;
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
    target.damage = 200; target.lastInput = defenderInput;
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

test('grabs allow pummels and defender mashing can force an escape', () => {
  const world = worldWith(), holder = world.players[0], target = world.players[1];
  target.x = 642;
  stepWorld(world, { 0: frame(1, BUTTONS.GRAB), 1: frame(1) });
  for (let seq = 2; seq <= 7; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  const before = target.damage;
  stepWorld(world, { 0: frame(8, BUTTONS.ATTACK), 1: frame(8) });
  assert.ok(target.damage > before); assert.equal(holder.grabbing, 1);
  for (let seq = 9; seq <= 14 && holder.grabbing != null; seq++) {
    const buttons = seq % 2 ? 255 : 0;
    stepWorld(world, { 0: frame(seq), 1: frame(seq, buttons, seq % 2 ? 1 : -1, seq % 2 ? 1 : -1) });
  }
  assert.equal(holder.grabbing, null); assert.equal(target.grabbedBy, null);
  assert.equal(target.actionBuffer, null); assert.equal(target.jumpBuffer, 0); assert.equal(target.shieldBuffer, 0);
  assert.ok(world.events.some(event => event.type === 'pummel'));
  assert.ok(world.events.some(event => event.type === 'grab-escape'));
});

test('shield hits create defender stun and shields visually shrink through damage state', () => {
  const world = worldWith(), target = world.players[1];
  for (let seq = 1; seq <= 6; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq, BUTTONS.SHIELD) });
  stepWorld(world, { 0: tap(7, BUTTONS.ATTACK), 1: frame(7, BUTTONS.SHIELD) });
  for (let seq = 8; seq <= 11; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq, BUTTONS.SHIELD) });
  assert.ok(target.shield < 100); assert.ok(target.shieldStun > 0); assert.ok(Math.abs(target.vx) > 0);
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
  assert.equal(runner.actionName, 'dash'); assert.ok(runner.dashFrames > 0); assert.ok(runner.vx > 500);
  stepWorld(ground, { 0: frame(4, BUTTONS.LEFT, -1), 1: frame(4) });
  assert.equal(runner.actionName, 'dash'); assert.ok(runner.vx < -400); assert.equal(runner.face, -1);

  const air = worldWith(), airborne = air.players[0];
  airborne.grounded = false; airborne.y = 300; airborne.vx = 300; airborne.coyoteFrames = 0;
  for (let seq = 1; seq <= 8; seq++) stepWorld(air, { 0: frame(seq, BUTTONS.LEFT, -1), 1: frame(seq) });
  assert.ok(airborne.vx < 0);
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
  player.shielding = true; player.shield = 64;
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
  const tap = worldWith(); tap.players[1].x = 900; tap.players[0].vx = 360;
  stepWorld(tap, { 0: { ...frame(1, BUTTONS.RIGHT, 1), pressedButtons: BUTTONS.ATTACK }, 1: frame(1) });
  assert.equal(tap.players[0].actionName, 'dashAttack');
  assert.equal(tap.players[0].action.frame, 0);
  stepWorld(tap, { 0: frame(2), 1: frame(2) });
  assert.ok(tap.players[0].vx > 300);
  for (let seq = 3; seq <= 40; seq++) stepWorld(tap, { 0: frame(seq), 1: frame(seq) });
  assert.equal(tap.players[0].action, null);
  assert.equal(tap.players[0].actionName, 'idle');

  const held = worldWith(); held.players[1].x = 900;
  for (let seq = 1; seq <= 12; seq++) stepWorld(held, { 0: frame(seq, BUTTONS.RIGHT | BUTTONS.ATTACK, 1), 1: frame(seq) });
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
  assert.ok(attacker.damage >= 10 && attacker.damage < 14, `counter damage ${attacker.damage}`);
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

test('ground rolls carry the fighter a meaningful distance instead of turning in place', () => {
  const world = worldWith(), player = world.players[0], startX = player.x;
  stepWorld(world, { 0: frame(1, BUTTONS.LEFT | BUTTONS.SHIELD, -1), 1: frame(1) });
  assert.equal(player.actionName, 'roll');
  assert.equal(player.dodgeTotalFrames, player.dodgeFrames);
  for (let seq = 2; seq <= 22; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(startX - player.x > 100, `expected roll travel above 100px, got ${startX - player.x}`);
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
  assert.equal(player.dodgeTotalFrames, 50);
  assert.equal(player.dodgeWindupFrames, 4);
  const burstSpeed = Math.hypot(player.dodgeStartVx, player.dodgeStartVy);
  assert.ok(burstSpeed < 390, `expected normalized burst below 390, got ${burstSpeed}`);
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
  world.entities.push({ id: 99, type: 'projectile', owner: 0, kind: 'boomerang', x: target.x, y: target.y, vx: 120, vy: 0, damage: 6, kx: 120, ky: 80, life: 50, color: '#fff', hitPlayers: [] });
  stepWorld(world, { 0: frame(1), 1: frame(1) });
  const entity = world.entities[0], firstDamage = target.damage;
  assert.equal(entity.returning, true); assert.equal(entity.vx, -120); assert.ok(firstDamage > 0);
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

  const grab = worldWith();
  grab.players[1].x = 642;
  grab.players[1].action = { name: 'groundSide', move: { ...FIGHTERS[1].moves.groundSide, defensiveOnly: true }, frame: 2, hit: [] };
  grab.players[1].actionName = 'groundSide';
  stepWorld(grab, { 0: frame(1, BUTTONS.GRAB), 1: frame(1) });
  for (let seq = 2; seq <= 7; seq++) stepWorld(grab, { 0: frame(seq), 1: frame(seq) });
  assert.equal(grab.players[1].grabbedBy, 0); assert.equal(grab.players[1].action, null);
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

test('Nova warp recovery aims diagonally without excessive vertical height', () => {
  const world = createWorld({ rules: { mode: 'training', stocks: 3 }, roster: [
    { slot: 0, clientId: 'nova', characterId: 'nova' },
    { slot: 1, clientId: 'dummy', characterId: 'volt' }
  ] });
  world.phase = 'active';
  const player = world.players[0];
  player.x = 80; player.y = 650; player.face = 1; player.grounded = false; player.platformId = null; player.invincible = 0;
  const startX = player.x, startY = player.y;
  let minimumY = startY;
  stepWorld(world, { 0: frame(1, BUTTONS.RIGHT | BUTTONS.UP | BUTTONS.SPECIAL, 1, -1), 1: frame(1) });
  for (let seq = 2; seq <= 45; seq++) {
    stepWorld(world, { 0: frame(seq), 1: frame(seq) });
    minimumY = Math.min(minimumY, player.y);
  }
  const verticalReach = startY - minimumY;
  assert.ok(verticalReach >= 185 && verticalReach <= 235, `expected balanced Nova vertical recovery, got ${verticalReach}`);
  assert.ok(player.x > startX + 200, `expected Nova to retain diagonal warp reach, got ${player.x - startX}`);
});

test('Nova neutral warp rises vertically, grants brief safety, and permits exit drift', () => {
  const world = createWorld({ rules: { mode: 'training', stocks: 3 }, roster: [
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
  assert.ok(verticalReach >= 215 && verticalReach <= 245, `neutral vertical reach should remain bounded: ${verticalReach}`);
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

test('late recovery input chains into the next action', () => {
  const world = worldWith(), player = world.players[0], move = { ...FIGHTERS[0].moves.groundNeutral };
  world.players[1].x = 1000;
  player.action = { name: 'groundNeutral', move, frame: move.startup + move.active + move.recovery - 5, hit: [], activated: true, startup: move.startup };
  player.actionName = 'groundNeutral';
  stepWorld(world, { 0: frame(1, BUTTONS.ATTACK), 1: frame(1) });
  for (let seq = 2; seq <= 6; seq++) stepWorld(world, { 0: frame(seq), 1: frame(seq) });
  assert.ok(player.action); assert.equal(player.action.name, 'groundJab2'); assert.ok(player.action.frame <= 3);
});

test('holding an early buffered attack preserves it and converts it into a smash when interruptible', () => {
  const world = worldWith(), player = world.players[0], move = { ...FIGHTERS[1].moves.dashAttack };
  world.players[1].x = 1000;
  player.action = { name: 'dashAttack', move, frame: move.startup + move.active, hit: [], activated: true, startup: move.startup };
  player.actionName = 'dashAttack';
  for (let seq = 1; seq <= 16; seq++) stepWorld(world, { 0: frame(seq, BUTTONS.ATTACK), 1: frame(seq) });
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
  human.shielding = true; human.shield = 100;

  stepWorld(world, { 0: frame(1, BUTTONS.SHIELD) });

  assert.ok(cpu.lastInput.buttons & BUTTONS.GRAB);
  assert.equal(cpu.action?.name, 'grab');
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
