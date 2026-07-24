const { BUTTONS, FIGHTERS, STAGES, ITEMS, DEFAULT_RULES } = require('./content');

const TICK_RATE = 60;
const WORLD_W = 1280;
const WORLD_H = 720;
const BLAST_MARGIN_X = 360;
const BLAST_TOP = -300;
const BLAST_BOTTOM = WORLD_H + 260;
const ACTION_BUFFER_FRAMES = 10;
const JUMP_BUFFER_FRAMES = 10;
const SMASH_HOLD_FRAMES = 10;
const PARRY_FRAMES = 5;
const bit = (buttons, flag) => (buttons & flag) !== 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, amount) => value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);

function makeRng(seed = Date.now() >>> 0) {
  let value = seed || 1;
  return () => ((value = (value * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function normalizeRules(raw = {}) {
  const rules = { ...DEFAULT_RULES, ...raw };
  rules.mode = ['stock', 'time', 'team', 'training'].includes(rules.mode) ? rules.mode : 'stock';
  rules.stocks = clamp(Number(rules.stocks) || 3, 1, 9);
  rules.timeSeconds = clamp(Number(rules.timeSeconds) || 420, 60, 900);
  rules.stocks = Math.round(rules.stocks); rules.timeSeconds = Math.round(rules.timeSeconds);
  rules.stageId = STAGES.some(stage => stage.id === rules.stageId) ? rules.stageId : 'neon-deck';
  rules.teams = rules.mode === 'team' || rules.teams === true;
  rules.items = rules.items === true; rules.hazards = rules.hazards === true;
  rules.friendlyFire = rules.friendlyFire === true;
  return rules;
}

function createPlayer(entry, index, count, rules) {
  const character = FIGHTERS.find(item => item.id === entry.characterId) || FIGHTERS[index % FIGHTERS.length];
  const spacing = count > 1 ? 180 : 0;
  const x = 640 + (index - (count - 1) / 2) * spacing;
  return {
    i: entry.slot ?? index, clientId: entry.clientId,
    nickname: entry.nickname || (String(entry.clientId || '').startsWith('cpu:') ? 'BOT' : `P${(entry.slot ?? index) + 1}`),
    characterId: character.id,
    palette: entry.palette ?? index, team: rules.teams ? (entry.team ?? index % 2) : index,
    x, y: 300, vx: 0, vy: 0, face: index < count / 2 ? 1 : -1,
    width: character.width, height: character.height,
    grounded: false, platformId: null, jumps: 2, fastFalling: false,
    damage: rules.mode === 'training' ? Number(entry.damage || 0) : 0,
    stocks: rules.mode === 'time' ? 0 : rules.stocks, score: 0, kos: 0, falls: 0,
    shield: 100, shielding: false, parryFrames: 0, shieldLock: 0, shieldStun: 0, shieldDropLag: 0,
    action: null, actionName: 'idle', stun: 0, hitstop: 0, invincible: 90, dodgeFrames: 0,
    dodgeTotalFrames: 0, dodgeElapsed: 0, dodgeStartVx: 0, dodgeStartVy: 0, dodgeInitialVx: 0, dodgeInitialVy: 0, dodgeWindupFrames: 0, dodgeNeutral: false,
    airDodgeAvailable: true, recoveryAvailable: true, ledge: null, ledgeInvincible: 0, canLedgeInvincible: true, ledgeGrabs: 0,
    grabbedBy: null, grabbing: null, grabFrames: 0, grabEscape: 0, grabPummelCooldown: 0, pendingThrow: null,
    comboCount: 0, comboTimer: 0, comboAttacker: null, lastDamager: null, staleQueue: [], jabStep: 0, jabTimer: 0,
    charge: null, heldItem: null, jumpBuff: 0, jumpBuffMultiplier: 1, projectileCooldown: 0, projectileCooldownMax: 0,
    respawn: 0, eliminated: false, disconnected: false,
    lastInput: { buttons: 0, horizontal: 0, vertical: 0, seq: 0 },
    ackSeq: 0, lastTapLeft: -999, lastTapRight: -999,
    landingLag: 0, pendingLandingLag: 0, skidFrames: 0, dashFrames: 0, hitId: 0, doubleJumpSerial: 0,
    coyoteFrames: 0, jumpBuffer: 0, actionBuffer: null,
    tumbling: false, tumbleRecoverFrames: 0, techWindow: 0, knockdownFrames: 0, launchDecay: 0, criticalFlightFrames: 0, sdiCooldown: 0, canSdi: false, lastSdiHorizontal: 0, lastSdiVertical: 0,
    dodgeFatigue: 0, dodgeFatigueCooldown: 0, shortHopFrames: 0, jumpSquatFrames: 0, jumpSquatShort: false, jumpSquatAttack: null, shieldBuffer: 0,
    dropThroughFrames: 0
  };
}

function createWorld(options = {}) {
  const rules = normalizeRules(options.rules);
  const stage = STAGES.find(item => item.id === rules.stageId);
  const roster = options.roster || [];
  return {
    tick: 0, phase: 'countdown', countdown: 180, rules,
    remainingTicks: rules.timeSeconds * TICK_RATE,
    players: roster.map((entry, index) => createPlayer(entry, index, roster.length, rules)),
    platforms: stage.platforms.map(platform => ({ ...platform, baseX: platform.x, baseY: platform.y })),
    stage: { id: stage.id, name: stage.name, color: stage.color },
    hazards: stage.hazards.map(hazard => ({ ...hazard })),
    entities: [], items: [], nextEntityId: 1,
    nextItemTick: 720 + Math.floor((options.seed || 7) % 480),
    events: [], eventId: 1, winner: null, suddenDeath: false,
    rng: makeRng(options.seed), cpuBrains: new Map(),
    training: { paused: false, showHitboxes: false, cpu: options.cpu || 'dummy' }
  };
}

function emit(world, type, payload = {}) {
  world.events.push({ id: world.eventId++, tick: world.tick, type, ...payload });
  if (world.events.length > 80) world.events.shift();
}

function pressed(input, previous, flag) { return bit(input.pressedButtons || 0, flag) || bit(input.buttons, flag) && !bit(previous.buttons, flag); }
function released(input, previous, flag) { return !bit(input.buttons, flag) && bit(previous.buttons, flag); }
function characterOf(player) { return FIGHTERS.find(item => item.id === player.characterId); }
function colorOf(player) {
  const fighter = characterOf(player);
  return fighter?.palettes?.[player.palette % fighter.palettes.length] || fighter?.color || '#ffffff';
}
function isOutOfBounds(player) { return player.x < -BLAST_MARGIN_X || player.x > WORLD_W + BLAST_MARGIN_X || player.y > BLAST_BOTTOM || player.y < BLAST_TOP; }

function releaseGrab(world, player) {
  if (player.grabbing != null) {
    const held = world.players.find(other => other.i === player.grabbing);
    if (held) held.grabbedBy = null;
  }
  if (player.grabbedBy != null) {
    const holder = world.players.find(other => other.i === player.grabbedBy);
    if (holder) { holder.grabbing = null; holder.grabFrames = 0; holder.grabEscape = 0; holder.grabPummelCooldown = 0; holder.pendingThrow = null; }
  }
  player.grabbing = null; player.grabbedBy = null; player.grabFrames = 0; player.grabEscape = 0; player.grabPummelCooldown = 0; player.pendingThrow = null;
}

function freshThrowDirection(input, previous) {
  const horizontal = Math.abs(input.horizontal) > .4 && (Math.abs(previous.horizontal) <= .4 || Math.sign(input.horizontal) !== Math.sign(previous.horizontal));
  const vertical = Math.abs(input.vertical) > .4 && (Math.abs(previous.vertical) <= .4 || Math.sign(input.vertical) !== Math.sign(previous.vertical));
  return horizontal || vertical
    || pressed(input, previous, BUTTONS.LEFT) || pressed(input, previous, BUTTONS.RIGHT)
    || pressed(input, previous, BUTTONS.UP) || pressed(input, previous, BUTTONS.DOWN);
}

function resetPlayerState(world, player, options = {}) {
  releaseGrab(world, player);
  player.x = options.x ?? 640; player.y = options.y ?? 220; player.vx = 0; player.vy = 0;
  player.damage = options.damage ?? 0; player.grounded = false; player.platformId = null;
  player.jumps = 2; player.fastFalling = false; player.airDodgeAvailable = true; player.recoveryAvailable = true;
  player.action = null; player.actionName = 'fall'; player.actionBuffer = null; player.charge = null;
  player.stun = 0; player.hitstop = 0; player.dodgeFrames = 0; player.dodgeTotalFrames = 0; player.dodgeElapsed = 0; player.dodgeStartVx = 0; player.dodgeStartVy = 0; player.dodgeInitialVx = 0; player.dodgeInitialVy = 0; player.dodgeWindupFrames = 0; player.dodgeNeutral = false; player.landingLag = 0; player.pendingLandingLag = 0;
  player.shielding = false; player.parryFrames = 0; player.shieldStun = 0; player.shieldDropLag = 0; player.skidFrames = 0; player.dashFrames = 0; player.ledge = null; player.ledgeInvincible = 0; player.ledgeGrabs = 0; player.canLedgeInvincible = true;
  player.coyoteFrames = 0; player.jumpBuffer = 0; player.comboCount = 0; player.comboTimer = 0; player.comboAttacker = null; player.staleQueue = []; player.jabStep = 0; player.jabTimer = 0; player.lastDamager = null;
  player.tumbling = false; player.tumbleRecoverFrames = 0; player.techWindow = 0; player.knockdownFrames = 0; player.launchDecay = 0; player.criticalFlightFrames = 0; player.sdiCooldown = 0; player.canSdi = false; player.lastSdiHorizontal = 0; player.lastSdiVertical = 0;
  player.dodgeFatigue = 0; player.dodgeFatigueCooldown = 0; player.shortHopFrames = 0; player.jumpSquatFrames = 0; player.jumpSquatShort = false; player.jumpSquatAttack = null; player.shieldBuffer = 0; player.dropThroughFrames = 0; player.doubleJumpSerial = 0;
  player.grabEscape = 0; player.grabPummelCooldown = 0; player.pendingThrow = null;
  player.projectileCooldown = 0; player.projectileCooldownMax = 0; player.jumpBuff = 0; player.jumpBuffMultiplier = 1;
  player.invincible = options.invincible ?? 0; player.eliminated = false; player.disconnected = false;
}

function moveName(player, input, special) {
  const up = input.vertical < -0.45;
  const down = input.vertical > 0.45;
  const side = Math.abs(input.horizontal) > 0.35;
  if (special) return up ? 'specialUp' : down ? 'specialDown' : side ? 'specialSide' : 'specialNeutral';
  if (!player.grounded) return up ? 'airUp' : down ? 'airDown' : side ? Math.sign(input.horizontal) === player.face ? 'airForward' : 'airBack' : 'airNeutral';
  return up ? 'groundUp' : down ? 'groundDown' : side ? player.dashFrames > 0 || Math.abs(player.vx) > 340 ? 'dashAttack' : 'groundSide' : 'groundNeutral';
}

function bufferActionInput(player, input, previous) {
  const directionalAction = pressed(input, previous, BUTTONS.ATTACK) || pressed(input, previous, BUTTONS.SPECIAL);
  if (pressed(input, previous, BUTTONS.UP) && (!directionalAction || input.vertical > -0.45)) player.jumpBuffer = JUMP_BUFFER_FRAMES;
  else if (player.jumpBuffer > 0 && player.hitstop === 0) player.jumpBuffer = bit(input.buttons, BUTTONS.UP) ? Math.max(1, player.jumpBuffer - 1) : player.jumpBuffer - 1;
  if (pressed(input, previous, BUTTONS.GRAB)) player.actionBuffer = { type: 'grab', input: { ...input }, frames: ACTION_BUFFER_FRAMES };
  else if (pressed(input, previous, BUTTONS.SPECIAL)) player.actionBuffer = {
    type: 'special', input: { ...input }, frames: ACTION_BUFFER_FRAMES,
    pendingHold: false, holdFrames: 0, triggerButton: BUTTONS.SPECIAL
  };
  else if (pressed(input, previous, BUTTONS.ATTACK)) {
    player.actionBuffer = {
      type: 'attack',
      input: { ...input },
      frames: ACTION_BUFFER_FRAMES,
      variant: 'normal',
      pendingHold: player.grounded && !player.heldItem && bit(input.buttons, BUTTONS.ATTACK),
      holdFrames: 0,
      triggerButton: BUTTONS.ATTACK
    };
  }
  else if (player.actionBuffer && player.hitstop === 0) {
    const buffered = player.actionBuffer;
    const heldButton = buffered.triggerButton || (buffered.type === 'grab' ? BUTTONS.GRAB : buffered.type === 'special' ? BUTTONS.SPECIAL : BUTTONS.ATTACK);
    if (buffered.pendingHold) {
      if (!player.grounded || !bit(input.buttons, heldButton)) {
        buffered.pendingHold = false;
        if (buffered.type === 'attack' && player.grounded && (Math.abs(buffered.input.horizontal) > .35 || Math.abs(buffered.input.vertical) > .45)) buffered.variant = 'tilt';
      } else {
        buffered.input = { ...input };
        buffered.holdFrames += 1;
        if (buffered.holdFrames >= SMASH_HOLD_FRAMES) {
          buffered.variant = 'smash';
          buffered.beginCharged = true;
          buffered.pendingHold = false;
        }
      }
    } else {
      buffered.frames -= 1;
      if (buffered.frames <= 0) {
        if (bit(input.buttons, heldButton)) {
          buffered.frames = 1;
          buffered.input = { ...input };
        } else player.actionBuffer = null;
      }
    }
  }
  if (pressed(input, previous, BUTTONS.SHIELD)) player.shieldBuffer = ACTION_BUFFER_FRAMES;
  else if (player.shieldBuffer > 0 && player.hitstop === 0) player.shieldBuffer = bit(input.buttons, BUTTONS.SHIELD) ? Math.max(1, player.shieldBuffer - 1) : player.shieldBuffer - 1;
}

function beginJumpSquat(player, attack = null) {
  player.jumpSquatFrames = 3;
  player.jumpSquatShort = !!attack;
  player.jumpSquatAttack = attack ? { ...attack, input: { ...attack.input } } : null;
  player.jumpBuffer = 0;
  player.actionName = 'jumpSquat';
  player.vx *= .94;
}

function processJumpSquat(world, player, input, previous) {
  const character = characterOf(player);
  if (Math.abs(input.horizontal) > .12) {
    const desired = input.horizontal * 360 * character.speed;
    player.vx = approach(player.vx, desired, Math.sign(desired) !== Math.sign(player.vx) ? 120 : 58);
    player.face = Math.sign(input.horizontal);
  } else player.vx *= .98;
  if (released(input, previous, BUTTONS.UP)) player.jumpSquatShort = true;
  if (player.actionBuffer?.type === 'attack') {
    player.jumpSquatAttack = { ...player.actionBuffer, input: { ...player.actionBuffer.input } };
    player.jumpSquatShort = true;
    player.actionBuffer = null;
  }
  player.jumpSquatFrames -= 1;
  if (player.jumpSquatFrames > 0) { player.actionName = 'jumpSquat'; return; }
  const shortHop = player.jumpSquatShort, attack = player.jumpSquatAttack;
  player.jumpSquatFrames = 0; player.jumpSquatShort = false; player.jumpSquatAttack = null;
  player.shortHopFrames = shortHop ? 4 : 0;
  player.vy = -(shortHop ? 470 : 590) * character.jump * (player.jumpBuff ? player.jumpBuffMultiplier || 1.3 : 1);
  player.jumps = 1; player.coyoteFrames = 0; player.grounded = false; player.platformId = null; player.actionName = 'jump';
  player.tumbling = false; player.techWindow = 0;
  if (attack) {
    startMove(world, player, moveName(player, attack.input, false));
    if (shortHop && player.action?.name?.startsWith('air')) player.action.move.shortHop = true;
  }
}

function startMove(world, player, name, chargeScale = 1, options = {}) {
  const source = characterOf(player).moves[name];
  if (!source) return;
  if (source.projectile) {
    const activeProjectiles = world.entities.filter(entity => entity.type === 'projectile' && entity.owner === player.i && entity.life > 0).length;
    if ((player.projectileCooldown || 0) > 0 || activeProjectiles >= (source.maxActiveProjectiles || Infinity)) {
      emit(world, 'projectile-denied', {
        player: player.i,
        reason: (player.projectileCooldown || 0) > 0 ? 'cooldown' : 'limit',
        remaining: player.projectileCooldown || 0
      });
      return false;
    }
  }
  const variant = options.variant || 'normal';
  const tilt = variant === 'tilt' && player.grounded && name.startsWith('ground') && source.chargeable && chargeScale === 1;
  const definition = tilt ? {
    ...source,
    startup: Math.max(3, source.startup - 2),
    recovery: Math.max(6, Math.round(source.recovery * .7)),
    cancelWindow: Math.max(5, source.cancelWindow || 0),
    damage: source.damage * .72,
    kx: source.kx * .7,
    ky: source.ky * .76,
    chargeable: false,
    tilt: true
  } : source;
  const knockbackScale = 1 + Math.max(0, chargeScale - 1) * 0.625;
  const move = { ...definition, name, damage: definition.damage * chargeScale, kx: definition.kx * knockbackScale, ky: definition.ky * knockbackScale };
  const beginCharged = !!options.beginCharged && !!move.chargeable;
  player.action = {
    name, move, variant: tilt ? 'tilt' : variant === 'smash' ? 'smash' : 'normal',
    frame: beginCharged ? Math.max(0, move.startup - 1) : 0,
    hit: [], chargeScale,
    holdFrames: beginCharged ? SMASH_HOLD_FRAMES : 1,
    charging: beginCharged,
    charged: chargeScale > 1,
    chargeButton: options.chargeButton,
    activated: false, startup: move.startup,
    inputHorizontal: clamp(Number(options.input?.horizontal) || 0, -1, 1),
    inputVertical: clamp(Number(options.input?.vertical) || 0, -1, 1)
  };
  player.actionName = name;
  if (!source.jab) { player.jabStep = 0; player.jabTimer = 0; }
  player.shielding = false; player.parryFrames = 0; player.tumbling = false; player.tumbleRecoverFrames = 0; player.techWindow = 0; player.knockdownFrames = 0;
  emit(world, 'action', { player: player.i, action: name, variant: player.action.variant });
  return true;
}

function activateMove(world, player, action) {
  if (action.activated) return;
  action.activated = true;
  const { move } = action;
  if (move.teleport) {
    player.x = clamp(player.x + player.face * move.teleport, -80, WORLD_W + 80);
    player.vx = player.face * (move.teleportExitSpeed || 0);
  }
  if (move.teleportY) {
    const aimedWarp = move.recoveryKind === 'warp';
    const aimX = aimedWarp && Math.abs(action.inputHorizontal) > .2 ? action.inputHorizontal : 0;
    const sideMix = Math.abs(aimX);
    if (aimX) player.face = Math.sign(aimX);
    player.y -= move.teleportY + (move.warpNeutralBonus || 0) * (1 - sideMix);
    player.x = clamp(player.x + aimX * (move.teleportHorizontal || 0), -BLAST_MARGIN_X + 70, WORLD_W + BLAST_MARGIN_X - 70);
    player.vy = -(move.riseSpeed || 420) - (move.warpNeutralBonus || 0) * (1 - sideMix);
    player.vx = aimX * (move.recoveryExitSpeed || move.teleportHorizontal || 0) * .72;
    if (move.warpInvincible) player.invincible = Math.max(player.invincible, move.warpInvincible);
    player.jumps = 0;
  }
  if (move.recoveryMove) {
    player.vy = -(move.riseSpeed || 560) * characterOf(player).jump;
    player.vx = player.face * (move.riseHorizontal || 100); player.jumps = 0;
  }
  if (move.dash) player.vx = player.face * (move.dashSpeed || 500) * characterOf(player).speed;
  if (move.projectile) spawnProjectile(world, player, move);
  if (move.trap && move.trap !== true) spawnTrap(world, player, move);
}

function spawnProjectile(world, player, move) {
  const defaultSpeed = move.projectile === 'core' ? 340 : move.projectile === 'boomerang' ? 470 : move.projectile === 'star' ? 430 : 560;
  if (move.projectileCooldown) {
    player.projectileCooldown = Math.max(player.projectileCooldown || 0, move.projectileCooldown);
    player.projectileCooldownMax = move.projectileCooldown;
  }
  world.entities.push({
    id: world.nextEntityId++, type: 'projectile', owner: player.i,
    kind: move.projectile, x: player.x + player.face * 35, y: player.y - 8,
    vx: player.face * (move.projectileSpeed || defaultSpeed), vy: move.projectile === 'boomerang' ? -55 : 0,
    damage: move.damage, kx: move.kx, ky: move.ky, life: move.projectile === 'boomerang' ? 100 : 85,
    radius: move.projectileRadius || (move.projectile === 'core' ? 46 : move.projectile === 'star' ? 26 : 30),
    splashRadius: move.splashRadius || 0, chainRadius: move.chainRadius || 0,
    color: colorOf(player), hitPlayers: []
  });
}

function spawnTrap(world, player, move) {
  const data = {
    type: 'trap', owner: player.i, kind: move.trap,
    x: player.x + player.face * 48, y: player.y + player.height / 2,
    damage: move.damage, kx: move.kx, ky: move.ky, radius: move.reachX, arm: move.armFrames ?? 24, life: move.trapLife || 360,
    persistent: !!move.persistent, stunBonus: move.stunBonus || 0, pullStrength: move.pullStrength || 1,
    color: colorOf(player), hitPlayers: []
  };
  if (move.trap === 'gravity') {
    const existing = world.entities.find(entity => entity.owner === player.i && entity.kind === 'gravity' && entity.life > 0);
    if (existing) { Object.assign(existing, data); emit(world, 'trap-relocate', { player: player.i, entity: existing.id, kind: 'gravity', x: data.x, y: data.y }); return; }
  }
  world.entities.push({ id: world.nextEntityId++, ...data });
}

function beginGrab(world, player) {
  player.action = { name: 'grab', frame: 0, move: { startup: 5, active: 3, recovery: 17 }, hit: [] };
  player.actionName = 'grab';
  player.parryFrames = 0; player.tumbling = false; player.techWindow = 0; player.knockdownFrames = 0;
  emit(world, 'action', { player: player.i, action: 'grab' });
}

function resolveGrab(world, player) {
  if (player.grabbing != null) return;
  const hitbox = grabHitbox(player);
  const target = world.players
    .filter(other => other.i !== player.i && !other.eliminated && other.respawn <= 0 && other.invincible <= 0 && other.grabbedBy == null
      && (!world.rules.teams || world.rules.friendlyFire || other.team !== player.team)
      && Math.sign(other.x - player.x || player.face) === player.face
      && playerHurtboxes(other).some(hurtbox => hitboxTouchesCircle(hitbox, hurtbox)))
    .sort((first, second) => Math.hypot(first.x - player.x, first.y - player.y) - Math.hypot(second.x - player.x, second.y - player.y))[0];
  if (!target) return;
  releaseGrab(world, target); target.action = null; target.actionBuffer = null; target.shielding = false; target.shieldBuffer = 0; target.parryFrames = 0; target.dodgeFrames = 0;
  player.grabbing = target.i; player.grabFrames = 0; player.grabEscape = 0; player.grabPummelCooldown = 0; target.grabbedBy = player.i;
  player.action = null; player.actionName = 'grabHold';
  player.vx *= .35; target.vx = 0; target.vy = 0; target.actionName = 'grabbed'; target.face = -player.face;
  emit(world, 'grab', { player: player.i, target: target.i });
}

function queueThrow(player, input) {
  if (player.pendingThrow) return;
  const up = input.vertical < -0.45, down = input.vertical > 0.45, back = input.horizontal * player.face < -0.45;
  const name = up ? 'throwUp' : down ? 'throwDown' : back ? 'throwBack' : 'throwForward';
  const releaseFrame = name === 'throwDown' ? 6 : name === 'throwBack' ? 5 : 4;
  const recovery = name === 'throwDown' ? 20 : name === 'throwUp' ? 18 : 16;
  player.pendingThrow = { name, up, down, back, releaseFrame };
  player.action = { name: 'throw', frame: 0, move: { startup: releaseFrame, active: 1, recovery }, hit: [] };
  player.actionName = name;
}

function throwTarget(world, player) {
  const target = world.players.find(other => other.i === player.grabbing);
  const queued = player.pendingThrow;
  if (!target || !queued) { player.grabbing = null; player.pendingThrow = null; return; }
  const { up, down, back, name } = queued;
  const direction = back ? -player.face : player.face;
  const move = { name, damage: up ? 7 : down ? 6 : 8, kx: up || down ? 120 : 305, ky: up ? 410 : down ? 115 : 155, hitstop: 6, meteor: down };
  target.grabbedBy = null; player.grabbing = null; player.grabFrames = 0; player.grabEscape = 0; player.grabPummelCooldown = 0; player.pendingThrow = null;
  hitPlayer(world, player, target, move, direction);
  player.action.frame = player.action.move.startup;
  emit(world, 'throw', { player: player.i, target: target.i, direction: player.actionName });
}

const STALE_WEIGHTS = [0.09, 0.085, 0.075, 0.065, 0.06, 0.055, 0.045, 0.035, 0.0205];
function staleMultiplier(attacker, moveName) {
  if (!moveName || !attacker?.staleQueue) return 1;
  let penalty = 0;
  attacker.staleQueue.forEach((name, index) => { if (name === moveName) penalty += STALE_WEIGHTS[index] || 0; });
  return penalty === 0 ? 1.05 : Math.max(0.4695, 1 - penalty);
}
function recordStale(attacker, moveName) {
  if (!attacker || attacker.i < 0 || !moveName) return;
  (attacker.staleQueue ||= []).unshift(moveName);
  if (attacker.staleQueue.length > 9) attacker.staleQueue.length = 9;
}
function applyDirectionalInfluence(vx, vy, input) {
  const speed = Math.hypot(vx, vy);
  if (speed < 220) return { vx, vy };
  const angle = Math.atan2(vy, vx);
  const perpendicular = clamp((input?.horizontal || 0) * -Math.sin(angle) + (input?.vertical || 0) * Math.cos(angle), -1, 1);
  const influenced = angle + perpendicular * Math.PI / 10;
  return { vx: Math.cos(influenced) * speed, vy: Math.sin(influenced) * speed };
}

function hitPlayer(world, attacker, target, move, direction) {
  if (target.invincible > 0 || target.eliminated || target.respawn > 0) return false;
  if (world.rules.teams && !world.rules.friendlyFire && attacker.team === target.team) return false;
  const interruptedDropPlatform = target.dropThroughFrames > 0
    ? world.platforms.find(platform => {
      if (!platform.passThrough) return false;
      const foot = target.y + target.height / 2;
      return foot >= platform.y - 4 && foot <= platform.y + 24
        && target.x + target.width / 2 > platform.x
        && target.x - target.width / 2 < platform.x + platform.w;
    })
    : null;
  const countering = target.action?.move?.counter && target.action.frame >= target.action.move.startup && target.action.frame < target.action.move.startup + target.action.move.active;
  if (countering && !move.counterStrike) {
    const definition = target.action.move;
    const incomingDamage = Math.max(1, Number(move.damage) || 1);
    const counterDamage = Math.max(definition.counterMinDamage || 12, incomingDamage * (definition.counterMultiplier || 1.5));
    const counterDirection = Math.sign(attacker.x - target.x || target.face || 1);
    const counterMove = {
      name: 'specialDownCounter',
      counterStrike: true,
      damage: counterDamage,
      kx: (definition.counterBaseKx || 380) + incomingDamage * (definition.counterDamageKx || 8),
      ky: (definition.counterBaseKy || 180) + incomingDamage * (definition.counterDamageKy || 2),
      hitstop: definition.counterHitstop || 10,
      knockbackGrowth: 1.12,
      contactX: (target.x + attacker.x) / 2,
      contactY: (target.y + attacker.y) / 2
    };
    const counterConnected = Math.hypot(attacker.x - target.x, attacker.y - target.y) <= (definition.counterReach || 165);
    target.face = counterDirection;
    target.vx *= .25;
    target.invincible = Math.max(target.invincible || 0, 6);
    target.action = {
      name: 'specialDown',
      move: { ...definition, counter: false, armor: false, startup: 0, active: 5, recovery: 13, cancelWindow: 4 },
      frame: 0, startup: 0, hit: [], activated: true, variant: 'counterSuccess'
    };
    target.actionName = 'specialDown';
    const connected = counterConnected && hitPlayer(world, target, attacker, counterMove, counterDirection);
    target.hitstop = Math.max(target.hitstop || 0, connected ? 9 : 6);
    if (connected) attacker.hitstop = Math.max(attacker.hitstop || 0, 11);
    emit(world, 'counter', {
      player: target.i, attacker: attacker.i,
      x: counterMove.contactX, y: counterMove.contactY,
      damage: counterDamage, direction: counterDirection, connected
    });
    // A distant projectile is still negated, but the local counter strike does
    // not magically damage its owner across the entire stage.
    return true;
  }
  if (target.parryFrames > 0) {
    attacker.hitstop = Math.max(attacker.hitstop || 0, 16);
    target.hitstop = Math.max(target.hitstop || 0, 3);
    target.parryFrames = 0; target.shielding = false; target.shieldBuffer = 0;
    target.shieldDropLag = 0; target.invincible = Math.max(target.invincible || 0, 4);
    target.shield = Math.min(100, target.shield + 12); target.actionName = 'parrySuccess';
    emit(world, 'parry', {
      player: target.i, attacker: attacker.i,
      x: move.contactX ?? target.x + direction * target.width * .45,
      y: move.contactY ?? target.y
    });
    return true;
  }
  const moveName = move.name || move.kind || move.projectile || 'environment';
  const stale = staleMultiplier(attacker, moveName);
  const shortHopMultiplier = move.shortHop ? 0.85 : 1;
  if (target.shielding) {
    const shieldDamage = move.damage * stale * shortHopMultiplier;
    target.shield = Math.max(0, target.shield - shieldDamage * 2.38);
    target.shieldStun = Math.max(target.shieldStun || 0, Math.floor(shieldDamage * 0.8 * (move.name?.startsWith('air') || move.projectile ? 0.8 : 1) + 2));
    const shieldPush = Math.min(145, (target.shieldStun + 1) * 9.9);
    target.vx = direction * shieldPush; attacker.vx -= direction * Math.min(170, 18 + shieldDamage * 6);
    target.hitstop = Math.max(3, move.hitstop - 2); attacker.hitstop = 3;
    if (target.shield <= 0) { target.shield = 25; target.shielding = false; target.stun = 87; target.shieldLock = 120; emit(world, 'shield-break', { player: target.i }); }
    else emit(world, 'shield-hit', { player: target.i, attacker: attacker.i });
    recordStale(attacker, moveName); target.hitId += 1; return true;
  }
  if (target.comboTimer <= 0 || target.comboAttacker !== attacker.i) {
    target.comboCount = 0;
    target.comboAttacker = attacker.i;
  }
  const comboMultiplier = Math.max(.65, 1 - target.comboCount * .06);
  const damage = move.damage * stale * shortHopMultiplier * comboMultiplier;
  const knockbackGrowth = Math.max(0, Number(move.knockbackGrowth ?? 1));
  const scale = (1 + target.damage / 85 * knockbackGrowth) / characterOf(target).weight;
  const launchGrowth = !move.groundedFlinch && knockbackGrowth >= .65
    ? 1 + clamp((target.damage - 70) / 110, 0, 1) * .28
    : 1;
  const rage = 1 + clamp(((attacker.damage || 0) - 35) / 115, 0, 1) * 0.1;
  const armorAction = target.action;
  const armorStartup = armorAction ? armorAction.startup ?? armorAction.move.startup : 0;
  const armored = !!armorAction?.move?.armor && armorAction.frame >= armorStartup && armorAction.frame < armorStartup + armorAction.move.active;
  if (!armored) {
    if (target.grabbedBy != null) {
      const holder = world.players.find(player => player.i === target.grabbedBy);
      if (holder) releaseGrab(world, holder);
      else target.grabbedBy = null;
    }
    if (target.grabbing != null) {
      const held = world.players.find(player => player.i === target.grabbing);
      if (held) held.grabbedBy = null;
      target.grabbing = null; target.grabFrames = 0; target.grabEscape = 0; target.grabPummelCooldown = 0;
    }
    target.action = null; target.charge = null; target.shielding = false; target.actionName = 'hit'; target.ledge = null;
    target.knockdownFrames = 0; target.techWindow = 0; target.tumbleRecoverFrames = 0;
    target.canLedgeInvincible = true; target.ledgeGrabs = 0;
  }
  target.damage += damage; target.comboCount += 1; target.comboTimer = 90; target.comboAttacker = attacker.i; recordStale(attacker, moveName);
  if (interruptedDropPlatform) {
    target.y = interruptedDropPlatform.y - target.height / 2;
    target.platformId = interruptedDropPlatform.id;
  }
  target.dropThroughFrames = 0;
  target.fastFalling = false;
  target.lastDamager = attacker.i; attacker.hitstop = Math.max(3, move.hitstop - 2); target.hitstop = move.hitstop;
  const requestedGroundedFlinch = !!move.groundedFlinch && (target.grounded || !!interruptedDropPlatform) && !move.meteor;
  // Grounded flinch is for the opening hits of a jab string, not a permanent
  // frame trap. A third consecutive flinch pops the defender out far enough to
  // DI, air-dodge or reset neutral instead of being pinned in place forever.
  const groundedFlinch = requestedGroundedFlinch && target.comboCount <= 2;
  let launchX = direction * (move.fixedKx ?? move.kx) * scale * rage * launchGrowth;
  let launchY = (move.meteor ? Math.abs(move.fixedKy ?? move.ky) * scale : -Math.abs(move.fixedKy ?? move.ky) * Math.min(scale, 2.2)) * rage * launchGrowth;
  if (requestedGroundedFlinch && !groundedFlinch) {
    const escapePush = 150 + Math.min(3, target.comboCount - 3) * 22;
    launchX = direction * Math.max(Math.abs(launchX) * 1.35, escapePush);
    launchY = -Math.max(Math.abs(launchY), 125);
  }
  const launch = groundedFlinch ? { vx: launchX, vy: 0 } : applyDirectionalInfluence(launchX, launchY, target.lastInput);
  target.vx = launch.vx; target.vy = launch.vy; target.canSdi = true; target.sdiCooldown = 1; target.lastSdiHorizontal = 0; target.lastSdiVertical = 0;
  const uncappedLaunchSpeed = Math.hypot(target.vx, target.vy);
  if (uncappedLaunchSpeed > 1120) {
    const cap = 1120 / uncappedLaunchSpeed;
    target.vx *= cap;
    target.vy *= cap;
  }
  const launchSpeed = Math.hypot(target.vx, target.vy);
  const critical = launchSpeed >= 720 || (target.damage >= 110 && launchSpeed >= 560);
  const finisherFlight = !groundedFlinch && target.damage >= 110 && launchSpeed >= 620;
  target.launchDecay = clamp(5.2 + launchSpeed / 330, 6.2, 9.2);
  target.criticalFlightFrames = finisherFlight ? clamp(Math.round(10 + (launchSpeed - 620) / 55), 10, 22) : 0;
  if (critical) {
    target.hitstop = Math.max(target.hitstop, Math.min(14, move.hitstop + 4));
    attacker.hitstop = Math.max(attacker.hitstop, Math.min(10, move.hitstop + 1));
  }
  const baseHitstun = move.hitstun != null
    ? clamp(Math.round(move.hitstun), 4, 60)
    : clamp(Math.round(10 + damage * 1.35 + launchSpeed / 75), 12, 60);
  // Damage scaling alone did not create an escape gap because authored
  // hitstun values stayed constant. Long strings now loosen progressively,
  // while the first three hits keep their intended combo timing.
  const comboStunMultiplier = Math.max(.72, 1 - Math.max(0, target.comboCount - 3) * .07);
  target.stun = armored ? 0 : Math.max(4, Math.round(baseHitstun * comboStunMultiplier));
  target.grounded = groundedFlinch; target.hitId += 1;
  if (!armored) target.tumbling = !groundedFlinch;
  emit(world, 'hit', { attacker: attacker.i, player: target.i, damage, targetDamage: target.damage, comboCount: target.comboCount, comboMultiplier, x: move.contactX ?? target.x, y: move.contactY ?? target.y, power: move.hitstop, launchSpeed, launchAngle: Math.atan2(target.vy, target.vx), critical, finisherFlight, quality: move.sweet ? 'sweet' : 'normal', color: colorOf(attacker) });
  return true;
}

function playerHurtboxes(player) {
  if (player.shielding) {
    const shieldScale = .58 + .42 * clamp(player.shield / 100, 0, 1);
    const visualRadius = Math.max(player.width * .9 + 15, player.height * .75 + 12);
    return [{ part: 'shield', x: player.x, y: player.y, radius: visualRadius * shieldScale }];
  }
  if ((player.actionName === 'tumble' || player.tumbling) && !player.grounded) {
    return [{ part: 'tumble', x: player.x, y: player.y, radius: Math.max(player.width * .45, player.height * .52) }];
  }
  if (player.actionName === 'knockdown') {
    const y = player.y + player.height * .27;
    return [
      { part: 'head', x: player.x + player.face * player.height * .28, y, radius: Math.max(10, player.width * .22) },
      { part: 'body', x: player.x, y, radius: Math.max(11, player.width * .28) },
      { part: 'legs', x: player.x - player.face * player.height * .27, y, radius: Math.max(10, player.width * .23) }
    ];
  }
  const crouched = player.actionName === 'crouch' || player.actionName === 'landing' || player.actionName === 'groundHit';
  const compressed = crouched ? .7 : 1;
  const centerY = player.y + (crouched ? player.height * .16 : 0);
  return [
    { part: 'head', x: player.x, y: centerY - player.height * .3 * compressed, radius: Math.max(10, player.width * .22) },
    { part: 'body', x: player.x, y: centerY - player.height * .02, radius: Math.max(11, player.width * .28) },
    { part: 'legs', x: player.x, y: centerY + player.height * .28 * compressed, radius: Math.max(10, player.width * .23) }
  ];
}

function hitboxTouchesCircle(hitbox, circle) {
  if (hitbox.type === 'circle') return Math.hypot(circle.x - hitbox.x, circle.y - hitbox.y) <= hitbox.radius + circle.radius;
  const closestX = clamp(circle.x, hitbox.x - hitbox.w / 2, hitbox.x + hitbox.w / 2);
  const closestY = clamp(circle.y, hitbox.y - hitbox.h / 2, hitbox.y + hitbox.h / 2);
  return Math.hypot(circle.x - closestX, circle.y - closestY) <= circle.radius;
}

function hitContactPoint(hitbox, circle) {
  if (hitbox.type === 'circle') {
    const angle = Math.atan2(circle.y - hitbox.y, circle.x - hitbox.x);
    return { x: hitbox.x + Math.cos(angle) * Math.min(hitbox.radius, Math.hypot(circle.x - hitbox.x, circle.y - hitbox.y)), y: hitbox.y + Math.sin(angle) * Math.min(hitbox.radius, Math.hypot(circle.x - hitbox.x, circle.y - hitbox.y)) };
  }
  return {
    x: clamp(circle.x, hitbox.x - hitbox.w / 2, hitbox.x + hitbox.w / 2),
    y: clamp(circle.y, hitbox.y - hitbox.h / 2, hitbox.y + hitbox.h / 2)
  };
}

function grabHitbox(player) {
  return { type: 'box', x: player.x + player.face * 29, y: player.y, w: 58, h: 48, grab: true };
}

function sweetspotHit(player, target, move, hitbox) {
  if (!move.sweetspot || move.radial) return false;
  if (move.vertical) return target.y <= hitbox.y - hitbox.h * (move.sweetspot - .5);
  if (move.downward) return target.y >= hitbox.y + hitbox.h * (move.sweetspot - .5);
  const direction = move.backward ? -player.face : player.face;
  const start = player.x + direction * player.width * .35;
  const reach = Math.max(1, Math.abs(hitbox.x + direction * hitbox.w / 2 - start));
  return (target.x - start) * direction / reach >= move.sweetspot;
}

function resolveMoveHits(world, player) {
  const action = player.action;
  const { move } = action;
  const hitbox = attackHitbox(player, move);
  for (const target of world.players) {
    if (target.i === player.i || action.hit.includes(target.i)) continue;
    const touchedHurtbox = playerHurtboxes(target).find(circle => hitboxTouchesCircle(hitbox, circle));
    const overlaps = !!touchedHurtbox;
    const attackFace = move.backward ? -player.face : player.face;
    const facing = move.radial || move.vertical || Math.sign(target.x - player.x || attackFace) === attackFace;
    const sweet = overlaps && sweetspotHit(player, target, move, hitbox);
    const contact = touchedHurtbox ? hitContactPoint(hitbox, touchedHurtbox) : null;
    const contactData = contact ? { contactX: contact.x, contactY: contact.y } : {};
    const resolvedMove = sweet
      ? { ...move, ...contactData, damage: move.damage * 1.12, kx: move.kx * 1.15, ky: move.ky * 1.15, hitstop: Math.min(10, move.hitstop + 1), sweet: true }
      : { ...move, ...contactData };
    if (overlaps && facing && hitPlayer(world, player, target, resolvedMove, move.radial ? Math.sign(target.x - player.x || attackFace) : attackFace)) action.hit.push(target.i);
  }
}

function attackHitbox(player, move) {
  if (move.low) {
    const centerY = player.y + player.height * .28;
    if (move.radial) return { type: 'box', x: player.x, y: centerY, w: move.reachX * 1.44, h: move.reachY * .64 };
    const direction = move.backward ? -player.face : player.face;
    const near = player.width * .12, far = Math.max(near + 12, move.reachX);
    return { type: 'box', x: player.x + direction * (near + far) / 2, y: centerY, w: far - near, h: move.reachY * .64 };
  }
  // Neutral air is a two-sided scissor kick, not a full-body burst. Keeping this
  // as a shallow box prevents opponents above or below the visible legs being hit.
  if (move.radial && (move.name === 'airNeutral' || player.action?.name === 'airNeutral' || player.actionName === 'airNeutral')) {
    return {
      type: 'box',
      x: player.x,
      y: player.y + player.height * .04,
      w: move.reachX * 1.34,
      h: move.reachY * .62
    };
  }
  if (move.radial) return { type: 'circle', x: player.x, y: player.y, radius: move.reachX * .76 };
  if (move.vertical) {
    const near = player.height * .12, far = Math.max(near + 12, move.reachY);
    return { type: 'box', x: player.x, y: player.y - (near + far) / 2, w: move.reachX * .78, h: far - near };
  }
  if (move.downward) {
    const near = player.height * .12, far = Math.max(near + 12, move.reachY);
    return { type: 'box', x: player.x, y: player.y + (near + far) / 2, w: move.reachX * .78, h: far - near };
  }
  const direction = move.backward ? -player.face : player.face;
  const near = player.width * .16, far = Math.max(near + 12, move.reachX);
  return { type: 'box', x: player.x + direction * (near + far) / 2, y: player.y, w: far - near, h: move.reachY * .82 };
}

function visualStrikePoints(player, move, actionName, hitbox) {
  if (!hitbox) return [];
  if (hitbox.grab) return [{ x: hitbox.x + player.face * hitbox.w * .46, y: hitbox.y }];
  if (move.low && move.radial) return [
    { x: hitbox.x + player.face * hitbox.w * .46, y: hitbox.y + hitbox.h * .18 },
    { x: hitbox.x - player.face * hitbox.w * .46, y: hitbox.y + hitbox.h * .18 }
  ];
  if (move.radial && actionName === 'airNeutral' && hitbox.type === 'box') return [
    { x: hitbox.x + player.face * hitbox.w * .44, y: hitbox.y + hitbox.h * .22 },
    { x: hitbox.x - player.face * hitbox.w * .44, y: hitbox.y - hitbox.h * .22 }
  ];
  if (move.radial) return [
    { x: hitbox.x + player.face * hitbox.radius * .92, y: hitbox.y },
    { x: hitbox.x - player.face * hitbox.radius * .92, y: hitbox.y }
  ];
  if (move.vertical) return [{ x: hitbox.x, y: hitbox.y - hitbox.h * .46 }];
  if (move.downward) return [{ x: hitbox.x, y: hitbox.y + hitbox.h * .46 }];
  const direction = move.backward || actionName?.includes('Back') ? -player.face : player.face;
  return [{ x: hitbox.x + direction * hitbox.w * .46, y: hitbox.y + (move.low ? hitbox.h * .18 : 0) }];
}

function hasAttackGeometry(move) {
  return !!move && Number.isFinite(move.reachX) && (move.radial || Number.isFinite(move.reachY));
}

function processAction(world, player, input) {
  if (!player.action) return;
  const action = player.action;
  const { move } = action;
  const startup = action.startup ?? move.startup;
  if (move.chargeable && !action.charged) {
    const chargeButton = action.chargeButton || (action.name.startsWith('special') ? BUTTONS.SPECIAL : BUTTONS.ATTACK);
    const held = bit(input.buttons, chargeButton);
    if (held) action.holdFrames = Math.min(90, action.holdFrames + 1);
    if (action.frame >= startup - 1 && held && action.holdFrames < 90) {
      action.charging = action.variant === 'smash' || action.holdFrames >= 10;
      player.vx *= player.grounded ? .7 : .96;
      return;
    }
    if (!held || action.holdFrames >= 90) {
      if (action.charging || action.holdFrames >= 90) {
      const scale = 1 + (Math.max(10, action.holdFrames) - 10) / 100;
      const knockbackScale = 1 + (scale - 1) * .625;
      move.damage *= scale; move.kx *= knockbackScale; move.ky *= knockbackScale;
      action.chargeScale = scale; action.charging = false; action.charged = true;
      } else action.charged = true;
    }
  }
  action.frame += 1;
  if (move.dash) {
    if (action.frame < startup) player.vx *= move.startupDrag || .58;
    else if (action.frame >= startup + move.active) player.vx *= move.recoveryDrag || .7;
  } else if (player.grounded) player.vx *= action.frame < startup ? .94 : action.frame < startup + move.active ? .97 : .92;
  else if (!player.grounded) player.vx *= .992;
  const active = action.frame >= startup && action.frame < startup + move.active;
  if (active) activateMove(world, player, action);
  if (action.name === 'grab' && active) resolveGrab(world, player);
  else if (active && !move.projectileOnly && !move.trapOnly && !move.defensiveOnly) resolveMoveHits(world, player);
  const totalFrames = startup + move.active + move.recovery;
  const cancelIntent = !!player.actionBuffer || player.jumpBuffer > 0 || (player.shieldBuffer > 0 && bit(input.buttons, BUTTONS.SHIELD))
    || (player.grounded && Math.abs(input.horizontal) > .12);
  const interruptible = action.name !== 'grab' && cancelIntent && move.cancelWindow > 0
    && action.frame >= totalFrames - move.cancelWindow;
  if (action.frame >= totalFrames || interruptible) {
    if (move.jab && move.jab < 3) { player.jabStep = move.jab; player.jabTimer = 18; }
    else if (move.jab === 3) { player.jabStep = 0; player.jabTimer = 0; }
    player.pendingLandingLag = 0;
    player.action = null; player.actionName = player.grounded ? 'idle' : 'fall';
    if (interruptible) emit(world, 'action-cancel', { player: player.i, action: action.name, frame: action.frame });
  }
}

function currentLandingLag(player) {
  const action = player.action;
  if (!action) return player.pendingLandingLag || 0;
  if (!action.name.startsWith('air')) return action.move.landingLag || player.pendingLandingLag || 0;
  const startup = action.startup ?? action.move.startup;
  const activeEnd = startup + action.move.active;
  const earlyAutoCancelEnd = Math.max(2, startup - 3);
  const lateAutoCancelStart = activeEnd + Math.max(2, action.move.recovery - 4);
  if (action.frame <= earlyAutoCancelEnd || action.frame >= lateAutoCancelStart) return 0;
  return action.move.landingLag || 0;
}

function updatePlatforms(world) {
  for (const platform of world.platforms) {
    const previousX = platform.x;
    if (platform.moveX) platform.x = platform.baseX + Math.sin(world.tick * platform.speed) * platform.moveX;
    platform.deltaX = platform.x - previousX;
  }
}

function findLanding(player, oldY, platforms, dropping) {
  if (player.vy < 0) return null;
  const halfW = player.width / 2, halfH = player.height / 2;
  return platforms.find(platform => {
    if (platform.passThrough && dropping) return false;
    const wasAbove = oldY + halfH <= platform.y + 2;
    return wasAbove && player.y + halfH >= platform.y && player.x + halfW > platform.x && player.x - halfW < platform.x + platform.w;
  });
}

function performDodge(player, name, baseFrames, baseInvincible, vx = 0, vy = null, options = {}) {
  const fatigue = Math.floor(player.dodgeFatigue || 0);
  const initialVx = player.vx, initialVy = player.vy;
  player.dodgeFrames = baseFrames + fatigue * 3;
  player.dodgeTotalFrames = player.dodgeFrames;
  player.dodgeElapsed = 0;
  player.dodgeStartVx = vx;
  player.dodgeStartVy = vy == null ? player.vy : vy;
  player.dodgeInitialVx = initialVx;
  player.dodgeInitialVy = initialVy;
  player.dodgeWindupFrames = options.windupFrames || 0;
  player.dodgeNeutral = !!options.neutral;
  player.invincible = Math.max(player.invincible, Math.max(6, baseInvincible - fatigue * 2));
  player.dodgeFatigue = Math.min(4, (player.dodgeFatigue || 0) + 1);
  player.dodgeFatigueCooldown = 90;
  player.vx = player.dodgeWindupFrames ? initialVx : vx;
  if (vy != null) player.vy = player.dodgeWindupFrames ? initialVy : vy;
  player.actionName = name; player.shielding = false; player.parryFrames = 0;
  player.tumbling = false; player.tumbleRecoverFrames = 0; player.techWindow = 0; player.shieldBuffer = 0;
}

function performAirDodge(player, input) {
  if (player.grounded || !player.airDodgeAvailable) return false;
  player.airDodgeAvailable = false;
  const magnitude = Math.hypot(input.horizontal, input.vertical);
  const divisor = Math.max(1, magnitude);
  const neutral = magnitude < .2;
  const dodgeX = neutral ? 0 : input.horizontal / divisor;
  const dodgeY = neutral ? 0 : input.vertical / divisor;
  if (neutral) performDodge(player, 'airDodge', 42, 18, player.vx, player.vy, { neutral: true });
  else performDodge(player, 'airDodge', 50, 14, dodgeX * 390, dodgeY * 360, { windupFrames: 4 });
  return true;
}

function startGetupAttack(world, player) {
  const move = {
    name: 'getupAttack',
    motion: 'getupSweep',
    startup: 4,
    active: 4,
    recovery: 20,
    cancelWindow: 3,
    damage: 6,
    kx: 205,
    ky: 125,
    knockbackGrowth: .72,
    hitstop: 5,
    reachX: 92,
    reachY: 48,
    radial: true,
    low: true
  };
  player.action = {
    name: 'getupAttack',
    move,
    frame: 0,
    startup: move.startup,
    hit: [],
    activated: false,
    variant: 'getup'
  };
  player.actionName = 'getupAttack';
  player.tumbling = false;
  player.invincible = Math.max(player.invincible, 17);
  emit(world, 'action', { player: player.i, action: 'getupAttack', variant: 'getup' });
}

function processKnockdown(world, player, input, previous) {
  if (player.knockdownFrames <= 0) return false;
  player.knockdownFrames -= 1;
  player.vx = approach(player.vx, 0, 70);
  if (pressed(input, previous, BUTTONS.ATTACK) || bit(input.buttons, BUTTONS.ATTACK)) {
    player.knockdownFrames = 0;
    startGetupAttack(world, player);
    emit(world, 'getup', { player: player.i, option: 'attack' });
  } else if (Math.abs(input.horizontal) > 0.4) {
    const direction = Math.sign(input.horizontal);
    player.face = direction; player.knockdownFrames = 0;
    performDodge(player, 'getupRoll', 22, 17, direction * 560 * characterOf(player).speed);
    emit(world, 'getup', { player: player.i, option: 'roll', direction });
  } else if (pressed(input, previous, BUTTONS.UP) || bit(input.buttons, BUTTONS.UP)
    || pressed(input, previous, BUTTONS.SHIELD) || bit(input.buttons, BUTTONS.SHIELD)
    || player.knockdownFrames === 0) {
    player.knockdownFrames = 0; player.dodgeFrames = 18; player.invincible = Math.max(player.invincible, 16);
    player.dodgeTotalFrames = 18; player.dodgeElapsed = 0;
    player.actionName = 'getup'; player.tumbling = false;
    emit(world, 'getup', { player: player.i, option: 'neutral' });
  }
  return true;
}

function tryLedge(world, player) {
  if (player.grounded || player.ledge || player.coyoteFrames > 0 || player.vy < -80 || player.grabbedBy != null || player.ledgeGrabs >= 6) return false;
  for (const platform of world.platforms.filter(item => !item.passThrough)) {
    const ledges = [{ x: platform.x, face: 1 }, { x: platform.x + platform.w, face: -1 }];
    for (const ledge of ledges) {
      const belowTop = player.y >= platform.y - Math.min(18, player.height * .22);
      if (Math.abs(player.x - ledge.x) < 24 && belowTop && player.y < platform.y + 36) {
        player.ledge = { platformId: platform.id, x: ledge.x, y: platform.y, face: ledge.face };
        player.x = ledge.x - ledge.face * 16; player.y = platform.y + 20; player.vx = 0; player.vy = 0; player.criticalFlightFrames = 0;
        player.face = ledge.face; player.actionName = 'ledge'; player.tumbling = false; player.techWindow = 0;
        player.jumps = Math.max(1, player.jumps); player.airDodgeAvailable = true; player.recoveryAvailable = true; player.fastFalling = false;
        player.ledgeGrabs += 1;
        if (player.canLedgeInvincible) player.ledgeInvincible = Math.max(12, 31 - player.ledgeGrabs * 2);
        else player.ledgeInvincible = 0;
        player.invincible = Math.max(player.invincible, player.ledgeInvincible);
        emit(world, 'ledge', { player: player.i }); return true;
      }
    }
  }
  return false;
}

function processLedge(world, player, input, previous) {
  if (!player.ledge) return false;
  player.ledgeInvincible = Math.max(0, player.ledgeInvincible - 1);
  player.invincible = Math.max(player.invincible, player.ledgeInvincible);
  const inward = input.horizontal * player.ledge.face > 0.35;
  const platform = world.platforms.find(item => item.id === player.ledge.platformId);
  const standOnPlatform = offset => {
    if (!platform) return;
    player.x = clamp(player.ledge.x + player.ledge.face * offset, platform.x + player.width / 2, platform.x + platform.w - player.width / 2);
    player.y = platform.y - player.height / 2; player.vy = 0; player.grounded = true; player.platformId = platform.id; player.ledge = null;
  };
  if (pressed(input, previous, BUTTONS.UP)) {
    player.y -= 34; player.vy = -430; player.jumps = Math.max(1, player.jumps); player.ledge = null; player.actionName = 'ledgeJump';
  } else if (pressed(input, previous, BUTTONS.ATTACK)) {
    standOnPlatform(38); startMove(world, player, 'groundNeutral');
  } else if (pressed(input, previous, BUTTONS.SHIELD) || inward) {
    standOnPlatform(75); performDodge(player, 'ledgeRoll', 18, 18, player.face * 420);
  } else if (pressed(input, previous, BUTTONS.DOWN)) {
    player.ledge = null; player.vy = 80; player.canLedgeInvincible = false;
  }
  return true;
}

function beginItemAction(world, player, name, move) {
  player.action = {
    name,
    move: { cancelWindow: 0, ...move },
    frame: 0,
    startup: move.startup || 0,
    hit: [],
    activated: false,
    variant: 'item'
  };
  player.actionName = name;
  player.shielding = false;
  player.parryFrames = 0;
  player.tumbling = false;
  player.tumbleRecoverFrames = 0;
  player.techWindow = 0;
  player.knockdownFrames = 0;
  emit(world, 'action', { player: player.i, action: name, variant: 'item' });
}

function useHeldItem(world, player) {
  const item = player.heldItem;
  if (!item) return false;
  if (item.kind === 'heal-shield') {
    player.shield = Math.min(100, player.shield + item.amount);
    beginItemAction(world, player, 'itemBattery', { startup: 0, active: 1, recovery: 9, defensiveOnly: true, motion: 'deploy' });
  } else if (item.kind === 'jump') {
    player.jumpBuff = item.duration;
    player.jumpBuffMultiplier = item.multiplier || 1.3;
    beginItemAction(world, player, 'itemCoil', { startup: 0, active: 1, recovery: 11, defensiveOnly: true, motion: 'deploy' });
  } else if (item.kind === 'melee') {
    beginItemAction(world, player, 'itemHammer', {
      startup: 10, active: 5, recovery: 24,
      damage: item.damage, kx: 455, ky: 185,
      reachX: 106, reachY: 62, hitstop: 9,
      knockbackGrowth: 1.08, motion: 'hammer'
    });
  } else if (item.kind === 'blaster') {
    spawnProjectile(world, player, { projectile: 'rail', projectileSpeed: 690, projectileRadius: 18, damage: item.damage, kx: 390, ky: 110 });
    beginItemAction(world, player, 'itemBlaster', { startup: 0, active: 1, recovery: 14, defensiveOnly: true, motion: 'cannon' });
  } else if (item.kind === 'mine') {
    spawnTrap(world, player, { trap: 'mine', damage: item.damage, kx: 390, ky: 250, reachX: 92 });
    beginItemAction(world, player, 'itemMine', { startup: 0, active: 1, recovery: 17, defensiveOnly: true, motion: 'deploy' });
  } else if (item.kind === 'bomb') {
    world.entities.push({ id: world.nextEntityId++, type: 'bomb', owner: player.i, x: player.x, y: player.y, vx: player.face * 280, vy: -220, damage: item.damage, life: 90, color: item.color });
    beginItemAction(world, player, 'itemBomb', { startup: 0, active: 1, recovery: 18, defensiveOnly: true, motion: 'throw' });
  }
  item.uses -= 1; if (item.uses <= 0) player.heldItem = null;
  emit(world, 'item-use', { player: player.i, item: item.id }); return true;
}

function pickupItem(world, player) {
  const index = world.items.findIndex(item => Math.abs(item.x - player.x) < 48 && Math.abs(item.y - player.y) < 55);
  if (index < 0) return false;
  player.heldItem = { ...world.items[index].definition };
  emit(world, 'item-pickup', { player: player.i, item: player.heldItem.id }); world.items.splice(index, 1); return true;
}

function updatePlayer(world, player, rawInput) {
  const input = {
    buttons: Number(rawInput?.buttons) & 255,
    pressedButtons: Number(rawInput?.pressedButtons) & 255,
    horizontal: clamp(Number(rawInput?.horizontal) || 0, -1, 1),
    vertical: clamp(Number(rawInput?.vertical) || 0, -1, 1),
    seq: Number(rawInput?.seq) || player.ackSeq
  };
  const previous = player.lastInput;
  player.ackSeq = Math.max(player.ackSeq, input.seq);
  player.projectileCooldown = Math.max(0, (player.projectileCooldown || 0) - 1);
  const character = characterOf(player);
  if (player.grounded && player.platformId) {
    const platform = world.platforms.find(item => item.id === player.platformId);
    if (platform) player.x += platform.deltaX || 0;
  }

  if (player.eliminated) { player.lastInput = input; return; }
  if (player.respawn > 0) {
    player.respawn -= 1;
    if (player.respawn === 0) { resetPlayerState(world, player, { x: 640, y: 220, invincible: 120 }); player.shield = 100; }
    player.lastInput = input; return;
  }
  bufferActionInput(player, input, previous);
  if (!player.grounded && player.tumbling && pressed(input, previous, BUTTONS.SHIELD)) player.techWindow = 9;
  if (player.hitstop > 0) {
    player.sdiCooldown = Math.max(0, (player.sdiCooldown || 0) - 1);
    const sdiHorizontal = Math.abs(input.horizontal) > .7 ? Math.sign(input.horizontal) : 0;
    const sdiVertical = Math.abs(input.vertical) > .7 ? Math.sign(input.vertical) : 0;
    const freshSdi = sdiHorizontal !== (player.lastSdiHorizontal || 0) || sdiVertical !== (player.lastSdiVertical || 0);
    if (player.canSdi && player.sdiCooldown === 0 && freshSdi && (sdiHorizontal || sdiVertical)) {
      const shiftX = sdiHorizontal * 6;
      let shiftY = sdiVertical * 6;
      if (shiftY > 0) {
        const nextX = player.x + shiftX;
        const currentFoot = player.y + player.height / 2;
        const blockedBelow = world.platforms.some(platform => {
          const overlapsX = nextX + player.width / 2 > platform.x && nextX - player.width / 2 < platform.x + platform.w;
          return overlapsX && currentFoot <= platform.y + 2 && currentFoot + shiftY >= platform.y
            && (!platform.passThrough || player.dropThroughFrames <= 0);
        });
        if (blockedBelow) shiftY = 0;
      }
      player.x += shiftX; player.y += shiftY; player.sdiCooldown = 4;
      emit(world, 'sdi', { player: player.i, x: player.x, y: player.y, horizontal: sdiHorizontal, vertical: shiftY ? sdiVertical : 0 });
    }
    player.lastSdiHorizontal = sdiHorizontal; player.lastSdiVertical = sdiVertical;
    player.hitstop -= 1;
    if (player.hitstop === 0) player.canSdi = false;
    player.lastInput = input; return;
  }
  if (player.grabbedBy != null) {
    const holder = world.players.find(other => other.i === player.grabbedBy);
    if (!holder || holder.grabbing !== player.i) releaseGrab(world, player);
    else {
      const buttonMash = ((input.buttons ^ previous.buttons) & 255).toString(2).replace(/0/g, '').length;
      const axisMash = (Math.abs(input.horizontal - previous.horizontal) > .65 ? 1 : 0) + (Math.abs(input.vertical - previous.vertical) > .65 ? 1 : 0);
      holder.grabEscape += buttonMash * 4 + axisMash * 3;
      const escapeThreshold = 38 + player.damage * .18;
      if (holder.grabEscape >= escapeThreshold) {
        releaseGrab(world, holder); player.action = null; player.actionBuffer = null; player.jumpBuffer = 0; player.shieldBuffer = 0;
        player.stun = 4; player.actionName = 'grabEscape'; player.vx = -holder.face * 115;
        emit(world, 'grab-escape', { player: player.i, holder: holder.i });
      } else {
        const footAlignedY = holder.y + holder.height / 2 - player.height / 2;
        const holdDistance = Math.min(34, (holder.width + player.width) * .27);
        let holdX = holder.x + holder.face * holdDistance;
        let holdY = footAlignedY;
        if (holder.pendingThrow && holder.action) {
          const progress = clamp(holder.action.frame / Math.max(1, holder.pendingThrow.releaseFrame), 0, 1);
          if (holder.pendingThrow.name === 'throwUp') {
            holdX = holder.x + holder.face * holdDistance * (1 - progress * .58);
            holdY = footAlignedY - 30 * progress;
          } else if (holder.pendingThrow.name === 'throwDown') {
            holdX = holder.x + holder.face * (holdDistance + 8 * progress);
            holdY = footAlignedY - 18 * Math.sin(progress * Math.PI);
          } else if (holder.pendingThrow.name === 'throwBack') {
            holdX = holder.x + holder.face * holdDistance * (1 - progress * 2);
            holdY = footAlignedY - 12 * Math.sin(progress * Math.PI);
          } else {
            holdX = holder.x + holder.face * (holdDistance - 12 * Math.sin(progress * Math.PI));
            holdY = footAlignedY - 8 * Math.sin(progress * Math.PI);
          }
        }
        const snap = holder.grabFrames < 4 ? .48 : 1;
        player.x += (holdX - player.x) * snap;
        player.y += (holdY - player.y) * snap;
        player.vx = 0; player.vy = 0; player.face = -holder.face;
        player.actionName = holder.grabPummelCooldown >= 9 ? 'grabbedHit' : 'grabbed';
      }
    }
    player.lastInput = input; return;
  }
  if (player.grabbing != null) {
    const target = world.players.find(other => other.i === player.grabbing);
    if (!target) { releaseGrab(world, player); player.lastInput = input; return; }
    player.grabFrames += 1;
    player.grabPummelCooldown = Math.max(0, player.grabPummelCooldown - 1);
    if (player.pendingThrow) {
      player.action.frame += 1;
      player.actionName = player.pendingThrow.name;
      if (player.action.frame >= player.pendingThrow.releaseFrame) throwTarget(world, player);
    } else if (pressed(input, previous, BUTTONS.ATTACK) && player.grabPummelCooldown === 0) {
      const pummelDamage = 1.3 * staleMultiplier(player, 'pummel');
      target.damage += pummelDamage; target.hitId += 1; target.lastDamager = player.i; player.hitstop = 2; target.hitstop = Math.max(target.hitstop, 3);
      player.grabPummelCooldown = 12; player.actionBuffer = null; player.actionName = 'pummel'; recordStale(player, 'pummel');
      emit(world, 'pummel', { player: player.i, target: target.i, damage: pummelDamage });
    } else if (freshThrowDirection(input, previous) || player.grabFrames >= 55 + target.damage * .22) queueThrow(player, input);
    else player.actionName = player.grabPummelCooldown >= 9 ? 'pummel' : 'grabHold';
    if (isOutOfBounds(player)) knockout(world, player);
    player.lastInput = input; return;
  }
  if (processLedge(world, player, input, previous)) { player.lastInput = input; return; }

  const wasStunned = player.stun > 0;
  player.invincible = Math.max(0, player.invincible - 1);
  player.parryFrames = Math.max(0, player.parryFrames - 1);
  player.stun = Math.max(0, player.stun - 1);
  if (wasStunned && player.stun === 0 && !player.grounded && player.tumbling) {
    player.tumbleRecoverFrames = 8;
    player.actionName = 'airRecover';
  } else if (player.tumbleRecoverFrames > 0) {
    player.tumbleRecoverFrames -= 1;
    if (player.tumbleRecoverFrames === 0 && player.actionName === 'airRecover') player.tumbling = false;
  }
  player.dodgeFrames = Math.max(0, player.dodgeFrames - 1);
  if (player.dodgeFrames > 0) player.dodgeElapsed = Math.min(player.dodgeTotalFrames, (player.dodgeElapsed || 0) + 1);
  else if (player.dodgeTotalFrames > 0) player.dodgeElapsed = player.dodgeTotalFrames;
  player.landingLag = Math.max(0, player.landingLag - 1);
  player.shieldStun = Math.max(0, (player.shieldStun || 0) - 1);
  player.shieldDropLag = Math.max(0, (player.shieldDropLag || 0) - 1);
  player.shieldLock = Math.max(0, player.shieldLock - 1);
  player.comboTimer = Math.max(0, player.comboTimer - 1);
  if (player.comboTimer === 0) { player.comboCount = 0; player.comboAttacker = null; }
  player.jabTimer = Math.max(0, (player.jabTimer || 0) - 1);
  if (player.jabTimer === 0 && !player.action?.move?.jab) player.jabStep = 0;
  player.jumpBuff = Math.max(0, player.jumpBuff - 1);
  player.shortHopFrames = Math.max(0, (player.shortHopFrames || 0) - 1);
  player.techWindow = Math.max(0, player.techWindow - 1);
  player.dropThroughFrames = Math.max(0, (player.dropThroughFrames || 0) - 1);
  player.dodgeFatigueCooldown = Math.max(0, (player.dodgeFatigueCooldown || 0) - 1);
  player.dashFrames = Math.max(0, (player.dashFrames || 0) - 1);
  if (player.dodgeFatigueCooldown === 0) player.dodgeFatigue = Math.max(0, (player.dodgeFatigue || 0) - 0.012);
  player.coyoteFrames = player.grounded ? 6 : Math.max(0, player.coyoteFrames - 1);
  if (!player.grounded && player.coyoteFrames === 0 && player.jumps === 2 && !player.ledge) player.jumps = 1;
  if (player.jumpSquatFrames > 0) { processJumpSquat(world, player, input, previous); player.lastInput = input; return; }
  if (processKnockdown(world, player, input, previous)) { player.lastInput = input; return; }
  if (player.action) processAction(world, player, input);
  const spotCancel = player.actionName === 'spotDodge' && player.dodgeFrames > 0 && player.dodgeFrames <= 5
    && (player.actionBuffer?.type === 'attack' || player.actionBuffer?.type === 'special');
  if (spotCancel) player.dodgeFrames = 0;
  const locked = player.stun > 0 || player.dodgeFrames > 0 || player.landingLag > 0 || player.shieldStun > 0 || player.shieldDropLag > 0 || player.action;

  if (!locked && player.shieldBuffer > 0 && bit(input.buttons, BUTTONS.SHIELD)) {
    player.shieldBuffer = 0;
    if (!player.grounded && player.airDodgeAvailable) {
      performAirDodge(player, input);
    } else if (player.grounded && input.vertical > 0.4) {
      performDodge(player, 'spotDodge', 24, 14, 0);
    } else if (player.grounded && Math.abs(input.horizontal) > 0.4) {
      performDodge(player, 'roll', 22, 16, input.horizontal * 600 * character.speed);
    } else if (player.grounded && player.shieldLock === 0) {
      player.shielding = true; player.actionName = 'shield';
    }
  }
  if (player.shielding) {
    const shieldSpotDodge = player.grounded && pressed(input, previous, BUTTONS.DOWN);
    const shieldRoll = player.grounded && Math.abs(input.horizontal) > 0.4 && (pressed(input, previous, BUTTONS.LEFT) || pressed(input, previous, BUTTONS.RIGHT));
    if (player.shieldStun > 0) { player.actionName = 'shieldHit'; player.vx *= .92; }
    else if (shieldSpotDodge) performDodge(player, 'spotDodge', 24, 14, 0);
    else if (shieldRoll) performDodge(player, 'roll', 22, 16, input.horizontal * 600 * character.speed);
    else if (!bit(input.buttons, BUTTONS.SHIELD) || !player.grounded || player.shieldLock > 0) {
      player.shielding = false;
      player.parryFrames = 0;
      player.shieldDropLag = 8;
    }
    else {
      player.shield = Math.max(0, player.shield - 0.12);
      player.vx *= 0.82;
    }
  } else if (player.shieldLock === 0) player.shield = Math.min(100, player.shield + 0.18);

  if (!locked && player.shielding && player.grounded && player.jumpBuffer > 0) player.shielding = false;

  if (!locked && player.shielding && player.grounded && pressed(input, previous, BUTTONS.ATTACK)) {
    player.actionBuffer = null; player.shielding = false; player.parryFrames = 0; beginGrab(world, player);
  }

  const shortHopAttack = !locked && player.shieldDropLag === 0 && player.shieldStun === 0 && !player.shielding && player.grounded && player.jumpBuffer > 0 && player.actionBuffer?.type === 'attack';
  if (shortHopAttack) {
    const buffered = player.actionBuffer;
    player.actionBuffer = null;
    beginJumpSquat(player, buffered);
  }

  if (!locked && player.shieldDropLag === 0 && player.shieldStun === 0 && !player.shielding && player.actionBuffer && !player.actionBuffer.pendingHold) {
    const buffered = player.actionBuffer;
    player.actionBuffer = null;
    if (buffered.type === 'grab') {
      if (Math.abs(buffered.input.horizontal) > .35) player.face = Math.sign(buffered.input.horizontal);
      if (!pickupItem(world, player)) {
        if (player.grounded) beginGrab(world, player);
        else performAirDodge(player, buffered.input);
      }
    } else if (player.heldItem && buffered.type === 'attack') {
      if (Math.abs(buffered.input.horizontal) > .35) player.face = Math.sign(buffered.input.horizontal);
      useHeldItem(world, player);
    } else if (buffered.type === 'special') {
      if (Math.abs(buffered.input.horizontal) > .35) player.face = Math.sign(buffered.input.horizontal);
      const name = moveName(player, buffered.input, true);
      if (name !== 'specialUp' || player.recoveryAvailable) {
        if (name === 'specialUp') player.recoveryAvailable = false;
      startMove(world, player, name, 1, { input: buffered.input });
      }
    } else if (buffered.type === 'attack') {
      let name = moveName(player, buffered.input, false);
      if (buffered.variant === 'smash' && player.grounded && name === 'groundNeutral') name = 'groundSide';
      if (player.grounded && Math.abs(buffered.input.horizontal) > .35) player.face = Math.sign(buffered.input.horizontal);
      if (name === 'groundNeutral' && player.jabTimer > 0) name = player.jabStep === 1 ? 'groundJab2' : 'groundJab3';
      startMove(world, player, name, 1, {
        variant: buffered.variant,
        input: buffered.input,
        beginCharged: buffered.beginCharged,
        chargeButton: buffered.triggerButton
      });
    }
  }

  const movementUnlocked = player.stun === 0 && player.dodgeFrames === 0 && player.landingLag === 0 && player.shieldStun === 0 && player.shieldDropLag === 0 && !player.shielding;
  const canGroundMove = movementUnlocked && player.grounded && !player.action;
  const canAirDrift = movementUnlocked && !player.grounded && (!player.action
    || player.action.name.startsWith('air')
    || player.action.move.recoveryDrift && player.action.activated
    || !player.action.move.dash && !player.action.move.recoveryMove && !player.action.move.teleport && !player.action.move.teleportY);
  if (canGroundMove || canAirDrift) {
    if (canGroundMove && input.horizontal < -.8 && pressed(input, previous, BUTTONS.LEFT)) {
      if (player.grounded && (player.dashFrames > 0 || world.tick - player.lastTapLeft <= 8)) {
        player.vx = -470 * character.speed; player.dashFrames = 12; player.skidFrames = 0; player.actionName = 'dash';
      }
      player.lastTapLeft = world.tick;
    }
    if (canGroundMove && input.horizontal > .8 && pressed(input, previous, BUTTONS.RIGHT)) {
      if (player.grounded && (player.dashFrames > 0 || world.tick - player.lastTapRight <= 8)) {
        player.vx = 470 * character.speed; player.dashFrames = 12; player.skidFrames = 0; player.actionName = 'dash';
      }
      player.lastTapRight = world.tick;
    }
    if (Math.abs(input.horizontal) > 0.12 && !player.action) {
      if (player.grounded && player.dashFrames === 0 && Math.sign(input.horizontal) !== Math.sign(player.vx) && Math.abs(player.vx) > 260) player.skidFrames = character.skid;
      player.face = Math.sign(input.horizontal);
    }
    if (canGroundMove) {
      const magnitude = Math.abs(input.horizontal);
      const groundSpeed = player.dashFrames > 0 ? 470 : magnitude < .8 ? 220 : 290;
      const crouching = input.vertical > .55 && magnitude < .25 && !bit(input.buttons, BUTTONS.SHIELD);
      const targetVx = crouching ? 0 : magnitude > .12 ? input.horizontal * groundSpeed * character.speed : 0;
      const control = targetVx === 0 ? 145 : Math.sign(targetVx) !== Math.sign(player.vx) ? 175 : player.dashFrames > 0 ? 125 : 52;
      player.vx = approach(player.vx, targetVx, control);
      if (crouching) player.actionName = 'crouch';
      if (player.skidFrames > 0) { player.skidFrames -= 1; player.vx *= .88; }
    } else if (canAirDrift) {
      const targetVx = Math.abs(input.horizontal) > .12 ? input.horizontal * 345 * character.air : player.vx;
      const airControl = Math.sign(targetVx) !== Math.sign(player.vx) ? 34 : 24;
      const recoveryControl = player.action?.move?.recoveryDrift ? player.action.move.recoveryDriftControl || 1 : 1;
      player.vx = approach(player.vx, targetVx, airControl * character.air * recoveryControl);
    }
    player.vx = clamp(player.vx, -500 * character.speed, 500 * character.speed);
    if (!player.action && player.jumpBuffer > 0 && player.jumps > 0 && (player.grounded || player.coyoteFrames > 0 || player.jumps < 2)) {
      if (player.grounded) beginJumpSquat(player);
      else {
        const doubleJump = player.coyoteFrames === 0 && player.jumps === 1;
        player.vy = -520 * character.jump * (player.jumpBuff ? player.jumpBuffMultiplier || 1.3 : 1);
        player.jumps -= 1;
        if (doubleJump) player.doubleJumpSerial = (player.doubleJumpSerial || 0) + 1;
        player.jumpBuffer = 0; player.coyoteFrames = 0; player.grounded = false; player.actionName = 'jump';
        player.tumbling = false; player.techWindow = 0;
      }
    }
  }
  const fastFallAllowed = movementUnlocked && !player.grounded && (!player.action || !player.action.move.recoveryMove && !player.action.move.teleportY);
  if (fastFallAllowed && input.vertical > 0.55 && player.vy > 0) player.fastFalling = true;
  if (!player.grounded && player.shortHopFrames === 0 && !player.action?.move?.recoveryMove && released(input, previous, BUTTONS.UP) && player.vy < -220) player.vy *= .58;
  if (player.stun > 0) {
    const finisherFlight = player.criticalFlightFrames > 0;
    const horizontal = !finisherFlight && Math.abs(input.horizontal) > .12 ? input.horizontal : 0;
    if (finisherFlight) {
      // Preserve the authored launch angle for the opening burst. Equal damping on
      // both axes keeps the flight line straight before normal DI and gravity resume.
      player.vx *= .996;
      player.vy *= .996;
      const speed = Math.hypot(player.vx, player.vy);
      if (speed > 1120) {
        const cap = 1120 / speed;
        player.vx *= cap;
        player.vy *= cap;
      }
    } else {
      const braking = horizontal && Math.sign(horizontal) !== Math.sign(player.vx);
      player.vx += horizontal * (braking ? 17 : 11);
      if (!player.grounded && input.vertical > .55 && player.vy > -80) player.vy += 3.5;
      const launchDecay = player.launchDecay || 6.2;
      player.vx = approach(player.vx, 0, launchDecay * (horizontal ? .72 : 1));
      player.vy = approach(player.vy, 0, launchDecay * .58);
    }
    if (!finisherFlight) {
      player.vx = clamp(player.vx, -1120, 1120);
      player.vy = clamp(player.vy, -1160, 1160);
    }
    player.actionName = player.grounded && !player.tumbling ? 'groundHit' : 'tumble';
  } else { player.launchDecay = 0; player.criticalFlightFrames = 0; }
  if (player.dodgeFrames > 0) {
    const groundRoll = player.grounded
      && ['roll', 'techRoll', 'getupRoll', 'ledgeRoll'].includes(player.actionName);
    const dodgeProgress = clamp((player.dodgeElapsed || 0) / Math.max(1, player.dodgeTotalFrames || player.dodgeFrames), 0, 1);
    if (groundRoll) {
      const direction = Math.sign(player.dodgeStartVx || player.vx || player.face) || 1;
      const speed = Math.abs(player.dodgeStartVx || player.vx);
      const travelCurve = Math.max(.12, 1 - Math.pow(dodgeProgress, 1.65) * .88);
      player.vx = direction * speed * travelCurve;
    } else if (player.actionName === 'airDodge') {
      if (player.dodgeNeutral) {
        player.vx *= .997;
      } else {
        const windup = Math.max(1, player.dodgeWindupFrames || 4);
        if (player.dodgeElapsed <= windup) {
          const windupProgress = player.dodgeElapsed / windup;
          player.vx = player.dodgeInitialVx * (1 - windupProgress * .35) - player.dodgeStartVx * .06 * windupProgress;
          player.vy = player.dodgeInitialVy * (1 - windupProgress * .35) - player.dodgeStartVy * .04 * windupProgress;
        } else {
          const travelProgress = (player.dodgeElapsed - windup) / Math.max(1, player.dodgeTotalFrames - windup);
          const burstEnd = .28;
          if (travelProgress <= burstEnd) {
            const burst = 1 - travelProgress / burstEnd * .2;
            player.vx = player.dodgeStartVx * burst;
            player.vy = player.dodgeStartVy * burst;
          } else {
            const recovery = (travelProgress - burstEnd) / (1 - burstEnd);
            player.vx = approach(player.vx, 0, 10 + recovery * 17);
            player.vy = approach(player.vy, 45, 8 + recovery * 14);
          }
        }
      }
    } else player.vx *= player.grounded ? .88 : .97;
  }

  const oldY = player.y;
  const standingPlatform = player.grounded ? world.platforms.find(platform => platform.id === player.platformId) : null;
  if (canGroundMove && standingPlatform?.passThrough && pressed(input, previous, BUTTONS.DOWN)) player.dropThroughFrames = 8;
  const finisherFlight = player.criticalFlightFrames > 0;
  if (!finisherFlight) player.vy += player.fastFalling ? 38 : 24;
  player.x += player.vx / TICK_RATE; player.y += player.vy / TICK_RATE;
  if (finisherFlight) player.criticalFlightFrames -= 1;
  const dropping = player.dropThroughFrames > 0;
  const landing = findLanding(player, oldY, world.platforms, dropping);
  if (landing) {
    const wasAirborne = !player.grounded;
    const landingSpeed = player.vy;
    const landingLag = currentLandingLag(player);
    player.y = landing.y - player.height / 2; player.vy = 0; player.grounded = true; player.platformId = landing.id;
    if (wasAirborne) player.vx *= landingLag ? .84 : .88;
    player.jumps = 2; player.coyoteFrames = 6; player.airDodgeAvailable = true; player.recoveryAvailable = true; player.fastFalling = false; player.criticalFlightFrames = 0; player.canLedgeInvincible = true; player.ledgeGrabs = 0;
    if (wasAirborne && player.actionName === 'airDodge') {
      const neutralAirDodge = !!player.dodgeNeutral;
      player.dodgeFrames = 0; player.dodgeTotalFrames = 0; player.dodgeElapsed = 0;
      player.dodgeWindupFrames = 0; player.dodgeNeutral = false;
      player.landingLag = neutralAirDodge ? 9 : 12;
      player.vx *= neutralAirDodge ? .84 : .68; player.actionName = 'landing';
    } else if (wasAirborne && player.tumbling && landingSpeed > 120) {
      player.action = null; player.actionBuffer = null; player.stun = 0; player.pendingLandingLag = 0; player.tumbling = false;
      if (player.techWindow > 0) {
        const direction = Math.abs(input.horizontal) > 0.4 ? Math.sign(input.horizontal) : 0;
        player.techWindow = 0;
        if (direction) performDodge(player, 'techRoll', 16, 12, direction * 470 * character.speed);
        else { player.dodgeFrames = 10; player.invincible = Math.max(player.invincible, 14); player.vx *= 0.18; }
        if (direction) player.face = direction;
        if (!direction) player.actionName = 'tech';
        emit(world, 'tech', { player: player.i, direction, x: player.x, y: landing.y });
      } else {
        player.knockdownFrames = 45; player.techWindow = 0; player.vx *= 0.28; player.actionName = 'knockdown';
        emit(world, 'knockdown', { player: player.i, x: player.x, y: landing.y });
      }
    } else if (wasAirborne && landingLag) { player.landingLag = landingLag; player.pendingLandingLag = 0; player.action = null; player.actionName = 'landing'; }
    else if (wasAirborne && landingSpeed > 160 && player.dodgeFrames === 0) { player.landingLag = landingSpeed > 520 ? 6 : 4; player.actionName = 'landing'; }
    if (wasAirborne && landingSpeed > 280) emit(world, 'land', { player: player.i, x: player.x, y: landing.y, speed: landingSpeed });
  } else { player.grounded = false; player.platformId = null; tryLedge(world, player); }

  if (!player.action && player.jumpSquatFrames === 0 && player.stun === 0 && player.dodgeFrames === 0 && player.landingLag === 0 && player.shieldStun === 0 && player.shieldDropLag === 0 && player.knockdownFrames === 0 && !player.shielding && !player.ledge && player.grabbing == null && player.grabbedBy == null) {
    if (!player.grounded && player.tumbleRecoverFrames > 0) player.actionName = 'airRecover';
    else if (!player.grounded) player.actionName = player.vy < 0 ? 'jump' : 'fall';
    else if (player.skidFrames > 0) player.actionName = 'skid';
    else if (Math.abs(player.vx) > 380) player.actionName = 'dash';
    else if (input.vertical > .55 && Math.abs(input.horizontal) < .25) player.actionName = 'crouch';
    else if (Math.abs(player.vx) > 18) player.actionName = Math.abs(input.horizontal) < .8 ? 'walk' : 'run';
    else player.actionName = 'idle';
  }

  if (isOutOfBounds(player)) knockout(world, player);
  player.lastInput = input;
}

function knockout(world, player) {
  const killer = world.players.find(other => other.i === player.lastDamager && other.i !== player.i);
  if (killer) { killer.kos += 1; killer.score += 1; }
  player.falls += 1; if (world.rules.mode === 'time') player.score -= 1;
  emit(world, 'ko', { player: player.i, killer: killer?.i ?? null });
  releaseGrab(world, player);
  if (world.suddenDeath) {
    player.eliminated = true; player.stocks = 0; player.respawn = 0;
    const survivors = world.players.filter(other => !other.eliminated && other.i !== player.i);
    world.phase = 'ended'; world.winner = survivors[0]?.i ?? killer?.i ?? null;
  } else if (world.rules.mode === 'time' || world.rules.mode === 'training') player.respawn = 90;
  else {
    player.stocks -= 1;
    if (player.stocks <= 0) { player.stocks = 0; player.eliminated = true; }
    else player.respawn = 90;
  }
  player.x = -999; player.y = -999; player.vx = 0; player.vy = 0;
  player.action = null; player.actionBuffer = null; player.shielding = false; player.ledge = null; player.dodgeFrames = 0;
  player.tumbling = false; player.techWindow = 0; player.knockdownFrames = 0; player.criticalFlightFrames = 0;
}

function projectileClashPower(entity) {
  return Math.max(1, Number(entity.damage) || 0)
    + Math.hypot(Number(entity.kx) || 0, Number(entity.ky) || 0) / 85
    + (Number(entity.radius) || 24) * .08;
}

function resolveProjectileClashes(world) {
  const projectiles = world.entities.filter(entity => entity.type === 'projectile' && entity.life > 0);
  const clashed = new Set();
  for (let firstIndex = 0; firstIndex < projectiles.length; firstIndex++) {
    const first = projectiles[firstIndex];
    if (clashed.has(first.id) || first.life <= 0) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < projectiles.length; secondIndex++) {
      const second = projectiles[secondIndex];
      if (clashed.has(second.id) || second.life <= 0 || first.owner === second.owner) continue;
      const firstOwner = world.players.find(player => player.i === first.owner);
      const secondOwner = world.players.find(player => player.i === second.owner);
      if (world.rules.teams && firstOwner && secondOwner && firstOwner.team === secondOwner.team) continue;
      const firstRadius = first.radius || 24, secondRadius = second.radius || 24;
      if (Math.hypot(first.x - second.x, first.y - second.y) > firstRadius + secondRadius) continue;

      const firstPower = projectileClashPower(first), secondPower = projectileClashPower(second);
      const ratio = Math.max(firstPower, secondPower) / Math.max(1, Math.min(firstPower, secondPower));
      const x = (first.x + second.x) / 2, y = (first.y + second.y) / 2;
      let winner = null;
      if (ratio <= 1.18) {
        first.life = 0; second.life = 0;
      } else {
        const stronger = firstPower > secondPower ? first : second;
        const weaker = stronger === first ? second : first;
        const remaining = clamp(.82 - projectileClashPower(weaker) / projectileClashPower(stronger) * .34, .5, .75);
        weaker.life = 0;
        stronger.damage *= remaining;
        stronger.kx *= .82; stronger.ky *= .82;
        stronger.radius = Math.max(12, (stronger.radius || 24) * .9);
        stronger.hitPlayers = [];
        winner = stronger.owner;
      }
      clashed.add(first.id); clashed.add(second.id);
      emit(world, 'projectile-clash', {
        x, y, winner,
        firstOwner: first.owner, secondOwner: second.owner,
        firstColor: first.color || (firstOwner ? colorOf(firstOwner) : '#ffffff'),
        secondColor: second.color || (secondOwner ? colorOf(secondOwner) : '#ffffff')
      });
      break;
    }
  }
}

function updateEntities(world) {
  for (const entity of world.entities) {
    entity.life -= 1;
    entity.age = (entity.age || 0) + 1;
    if (entity.arm > 0) entity.arm -= 1;
    if (entity.type === 'projectile' || entity.type === 'bomb') {
      entity.x += entity.vx / TICK_RATE; entity.y += entity.vy / TICK_RATE;
      if (entity.type === 'bomb') entity.vy += 22;
      if (entity.kind === 'star') { entity.y += Math.sin(entity.age * .42) * 2.2; entity.vx *= .996; }
    }
    if (entity.kind === 'boomerang' && entity.life < 50 && !entity.returning) { entity.vx *= -1; entity.returning = true; entity.hitPlayers = []; }
  }
  resolveProjectileClashes(world);
  for (const entity of world.entities) {
    if (entity.life <= 0) continue;
    if (entity.arm > 0) continue;
    const owner = world.players.find(player => player.i === entity.owner);
    if (entity.kind === 'gravity') for (const target of world.players) {
      if (!owner || target.i === owner.i || target.eliminated || target.respawn > 0) continue;
      const dx = entity.x - target.x, dy = entity.y - target.y, distance = Math.hypot(dx, dy);
      if (distance > 1 && distance < entity.radius) {
        const strength = 1 - distance / entity.radius, pull = entity.pullStrength || 1;
        target.vx += dx / distance * (7 + strength * 12) * pull;
        target.vy += dy / distance * (1.5 + strength * 3.5) * pull;
      }
    }
    for (const target of world.players) {
      if (!owner || target.i === owner.i || target.eliminated || entity.hitPlayers?.includes(target.i)) continue;
      const radius = entity.radius || 34;
      const touchedHurtbox = playerHurtboxes(target).find(hurtbox => Math.hypot(hurtbox.x - entity.x, hurtbox.y - entity.y) < radius + hurtbox.radius);
      const contactAngle = touchedHurtbox ? Math.atan2(touchedHurtbox.y - entity.y, touchedHurtbox.x - entity.x) : 0;
      const entityMove = touchedHurtbox ? {
        name: entity.kind || entity.type, projectile: entity.type === 'projectile',
        damage: entity.damage, kx: entity.kx || 360, ky: entity.ky || 180,
        fixedKx: entity.fixedKx, fixedKy: entity.fixedKy,
        knockbackGrowth: entity.knockbackGrowth, groundedFlinch: entity.groundedFlinch,
        hitstop: entity.hitstop ?? 6, hitstun: entity.hitstun,
        contactX: entity.x + Math.cos(contactAngle) * radius,
        contactY: entity.y + Math.sin(contactAngle) * radius
      } : null;
      const hitDirection = entity.kind === 'gravity' ? Math.sign(entity.x - target.x || owner.face) : Math.sign(target.x - entity.x || owner.face);
      if (touchedHurtbox && hitPlayer(world, owner, target, entityMove, hitDirection)) {
        (entity.hitPlayers ||= []).push(target.i);
        if (entity.stunBonus) target.stun = Math.max(target.stun, entity.stunBonus);
        if (entity.kind === 'arc' && entity.chainRadius) {
          const chained = world.players.filter(other => other.i !== owner.i && other.i !== target.i && !other.eliminated && !entity.hitPlayers.includes(other.i) && Math.hypot(other.x - target.x, other.y - target.y) <= entity.chainRadius).sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0];
          if (chained && hitPlayer(world, owner, chained, { damage: entity.damage * .65, kx: (entity.kx || 360) * .7, ky: (entity.ky || 180) * .7, hitstop: 4 }, Math.sign(chained.x - target.x || owner.face))) { entity.hitPlayers.push(chained.i); emit(world, 'chain', { player: chained.i, from: target.i, x: chained.x, y: chained.y }); }
        }
        if (entity.splashRadius) {
          for (const other of world.players) {
            if (other.i === owner.i || other.i === target.i || other.eliminated || entity.hitPlayers.includes(other.i) || Math.hypot(other.x - entity.x, other.y - entity.y) > entity.splashRadius) continue;
            if (hitPlayer(world, owner, other, { damage: entity.damage * .7, kx: (entity.kx || 360) * .82, ky: (entity.ky || 180) * .82, hitstop: 6 }, Math.sign(other.x - entity.x || owner.face))) entity.hitPlayers.push(other.i);
          }
          emit(world, 'explosion', { player: target.i, x: entity.x, y: entity.y, radius: entity.splashRadius, color: entity.color });
        }
        if (entity.kind !== 'boomerang' && !entity.persistent) { entity.life = 0; break; }
      }
    }
  }
  world.entities = world.entities.filter(entity => entity.life > 0 && entity.x > -250 && entity.x < WORLD_W + 250 && entity.y < WORLD_H + 250);
}

function updateItems(world) {
  if (!world.rules.items || world.phase !== 'active') return;
  if (world.tick >= world.nextItemTick && world.items.length < 2) {
    const definition = ITEMS[Math.floor(world.rng() * ITEMS.length)];
    world.items.push({ id: world.nextEntityId++, definition, x: 300 + world.rng() * 680, y: 260, vy: 0 });
    world.nextItemTick = world.tick + 720 + Math.floor(world.rng() * 480);
    emit(world, 'item-spawn', { item: definition.id });
  }
  for (const item of world.items) {
    item.vy += 20; item.y += item.vy / TICK_RATE;
    const platform = world.platforms.find(p => item.x > p.x && item.x < p.x + p.w && item.y >= p.y - 10 && item.y - item.vy / TICK_RATE < p.y);
    if (platform) { item.y = platform.y - 10; item.vy = 0; }
  }
}

function updateHazards(world) {
  if (!world.rules.hazards) return;
  for (const hazard of world.hazards) {
    const cycle = world.tick % hazard.interval;
    if (cycle >= hazard.duration) continue;
    if (hazard.type === 'wind') for (const player of world.players) if (!player.eliminated) player.vx += hazard.force;
    if (hazard.type === 'pulse' && cycle === 1) {
      const source = { i: -1, team: -1, face: 1 };
      for (const player of world.players) if (Math.hypot(player.x - hazard.x, player.y - hazard.y) < hazard.radius) hitPlayer(world, source, player, { damage: hazard.damage, kx: 280, ky: 260, hitstop: 6 }, Math.sign(player.x - hazard.x || 1));
      emit(world, 'hazard', { hazard: 'pulse', x: hazard.x, y: hazard.y });
    }
  }
}

const CPU_DIRECTION_BUTTONS = BUTTONS.LEFT | BUTTONS.RIGHT | BUTTONS.UP | BUTTONS.DOWN;
const CPU_ACTION_BUTTONS = BUTTONS.ATTACK | BUTTONS.SPECIAL | BUTTONS.SHIELD | BUTTONS.GRAB;
const CPU_PROFILES = {
  easy: { reaction: 10, aggression: .48, defense: .18, accuracy: .56, edgeguard: .15 },
  normal: { reaction: 6, aggression: .72, defense: .43, accuracy: .79, edgeguard: .4 },
  hard: { reaction: 4, aggression: .9, defense: .72, accuracy: .95, edgeguard: .68 }
};

function cpuInput(world, horizontal = 0, vertical = 0, actions = 0) {
  horizontal = Math.abs(horizontal) < .2 ? 0 : Math.sign(horizontal);
  vertical = Math.abs(vertical) < .2 ? 0 : Math.sign(vertical);
  let buttons = actions;
  if (horizontal < 0) buttons |= BUTTONS.LEFT;
  else if (horizontal > 0) buttons |= BUTTONS.RIGHT;
  if (vertical < 0) buttons |= BUTTONS.UP;
  else if (vertical > 0) buttons |= BUTTONS.DOWN;
  return { buttons, horizontal, vertical, seq: world.tick };
}

function cpuBrain(world, player) {
  world.cpuBrains ||= new Map();
  if (!world.cpuBrains.has(player.i)) world.cpuBrains.set(player.i, { nextDecision: 0, input: cpuInput(world), actionRelease: 0 });
  return world.cpuBrains.get(player.i);
}

function cpuRecoveryTarget(world, player) {
  const candidates = world.platforms.filter(platform => platform.w >= 120);
  const scored = candidates.map(platform => {
    const safeX = clamp(player.x, platform.x + 35, platform.x + platform.w - 35);
    const verticalPenalty = player.y > platform.y ? (player.y - platform.y) * .45 : 0;
    return { platform, x: safeX, score: Math.abs(safeX - player.x) + verticalPenalty };
  }).sort((a, b) => a.score - b.score);
  return scored[0] || { platform: { x: 400, y: 500, w: 480 }, x: 640 };
}

function cpuIsOffstage(world, player) {
  if (player.grounded || player.ledge) return false;
  return !world.platforms.some(platform =>
    player.x >= platform.x - 22 && player.x <= platform.x + platform.w + 22
    && player.y <= platform.y + 25
  );
}

function cpuTarget(world, player) {
  return world.players
    .filter(other => other.i !== player.i && !other.eliminated && !other.respawn
      && (!world.rules.teams || other.team !== player.team))
    .map(other => {
      const distance = Math.hypot(other.x - player.x, (other.y - player.y) * .72);
      const threat = other.action ? 55 : 0;
      const vulnerable = other.stun > 0 || other.landingLag > 0 ? 18 : 0;
      return { other, score: distance + threat - vulnerable };
    })
    .sort((a, b) => a.score - b.score)[0]?.other;
}

function cpuIncomingThreat(world, player, target) {
  const projectile = world.entities.find(entity => {
    if (entity.owner === player.i || !['projectile', 'bomb'].includes(entity.type)) return false;
    const owner = world.players.find(other => other.i === entity.owner);
    if (world.rules.teams && owner?.team === player.team) return false;
    const dx = player.x - entity.x;
    const approaching = entity.type === 'bomb' || Math.sign(dx) === Math.sign(entity.vx);
    return approaching && Math.abs(dx) < 260 && Math.abs(player.y - entity.y) < 75;
  });
  if (projectile) return { kind: 'projectile', direction: Math.sign(projectile.x - player.x) || 1 };
  if (!target?.action) return null;
  const move = target.action.move || {};
  const startup = target.action.startup ?? move.startup ?? 0;
  const activeEnd = startup + (move.active || 0);
  const threateningFrame = target.action.frame >= Math.max(0, startup - 4) && target.action.frame <= activeEnd;
  const reach = (move.reachX || 70) + (player.width + target.width) / 2 + 20;
  if (threateningFrame && Math.abs(target.x - player.x) <= reach && Math.abs(target.y - player.y) < (move.reachY || 75)) {
    return { kind: 'attack', direction: Math.sign(target.x - player.x) || target.face || 1 };
  }
  return null;
}

function decideCpuRecovery(world, player, profile) {
  const recovery = cpuRecoveryTarget(world, player);
  const toward = Math.sign(recovery.x - player.x);
  if (player.ledge) {
    const roll = world.rng() < profile.defense * .35;
    return cpuInput(world, roll ? -player.face : 0, roll ? 0 : -1, roll ? BUTTONS.SHIELD : 0);
  }
  if (player.stun > 0 || player.tumbling) {
    const landingSoon = player.vy > 0 && Math.abs(player.y - recovery.platform.y) < 100;
    return cpuInput(world, toward, 0, landingSoon && profile.accuracy > .7 ? BUTTONS.SHIELD : 0);
  }
  const deeplyBelow = player.y > recovery.platform.y + 75;
  const farSide = Math.abs(recovery.x - player.x) > 150;
  if (player.recoveryAvailable && (deeplyBelow || player.jumps <= 0 || farSide && player.y > recovery.platform.y - 20)) {
    return cpuInput(world, toward, -1, BUTTONS.SPECIAL);
  }
  if (player.jumps > 0 && (player.vy > 80 || player.y > recovery.platform.y - 80)) {
    return cpuInput(world, toward, -1);
  }
  if (player.airDodgeAvailable && farSide && player.vy > 220 && profile.accuracy > .75) {
    return cpuInput(world, toward, -1, BUTTONS.SHIELD);
  }
  return cpuInput(world, toward, 0);
}

function decideCpuInput(world, player, difficulty) {
  if (difficulty === 'dummy') return cpuInput(world);
  const profile = CPU_PROFILES[difficulty] || CPU_PROFILES.normal;
  const brain = cpuBrain(world, player);
  const target = cpuTarget(world, player);
  if (!target) return cpuInput(world);

  // Recovery, DI and ledge choices are checked every frame; waiting for the
  // normal decision interval here makes even a strong CPU casually self-destruct.
  if (player.ledge || cpuIsOffstage(world, player)) {
    brain.input = decideCpuRecovery(world, player, profile);
    brain.actionRelease = world.tick + 1;
    return brain.input;
  }
  if (player.grabbedBy != null) {
    const mash = world.tick % 2 ? 1 : -1;
    return cpuInput(world, mash, world.tick % 4 < 2 ? -1 : 1, BUTTONS.ATTACK | BUTTONS.SPECIAL);
  }
  if (player.knockdownFrames > 0) {
    const away = -Math.sign(target.x - player.x || 1);
    return cpuInput(world, world.rng() < profile.defense ? away : 0, 0, BUTTONS.SHIELD);
  }
  if (player.stun > 0 || player.tumbling) {
    const recovery = cpuRecoveryTarget(world, player);
    const towardStage = Math.sign(recovery.x - player.x);
    const tech = player.vy > 0 && Math.abs(player.y - recovery.platform.y) < 90 && profile.accuracy > .68;
    return cpuInput(world, towardStage, 0, tech ? BUTTONS.SHIELD : 0);
  }

  if (world.tick < brain.nextDecision) {
    const heldActions = world.tick < brain.actionRelease ? brain.input.buttons & CPU_ACTION_BUTTONS : 0;
    return { ...brain.input, buttons: brain.input.buttons & CPU_DIRECTION_BUTTONS | heldActions, seq: world.tick };
  }
  brain.nextDecision = world.tick + profile.reaction;

  const dx = target.x - player.x, dy = target.y - player.y;
  const distance = Math.hypot(dx, dy * .72);
  const toward = Math.sign(dx || player.face);
  const threat = cpuIncomingThreat(world, player, target);
  const canAct = !player.action && player.landingLag <= 0 && player.shieldStun <= 0 && player.dodgeFrames <= 0;
  let chosen;

  if (threat && canAct && world.rng() < profile.defense) {
    if (!player.grounded) chosen = cpuInput(world, -threat.direction, 0, player.airDodgeAvailable ? BUTTONS.SHIELD : 0);
    else if (difficulty === 'hard' && world.rng() < .48) chosen = cpuInput(world, 0, 0, BUTTONS.SHIELD);
    else chosen = cpuInput(world, -threat.direction, 0, BUTTONS.SHIELD);
    brain.actionRelease = world.tick + (difficulty === 'easy' ? 3 : 5);
  } else if (world.rules.items && !player.heldItem) {
    const item = world.items.map(entry => ({ entry, distance: Math.hypot(entry.x - player.x, entry.y - player.y) }))
      .filter(entry => entry.distance < (difficulty === 'hard' ? 310 : 210)).sort((a, b) => a.distance - b.distance)[0];
    if (item && item.distance < 55) chosen = cpuInput(world, 0, 0, BUTTONS.GRAB);
    else if (item) chosen = cpuInput(world, Math.sign(item.entry.x - player.x), item.entry.y < player.y - 65 ? -1 : 0);
  }

  if (!chosen && player.heldItem && (distance < 190 || player.heldItem.kind === 'heal-shield' && player.shield < 65)) {
    chosen = cpuInput(world, toward, 0, BUTTONS.ATTACK);
  }
  if (!chosen && canAct && distance < 62 && target.shielding && world.rng() < profile.accuracy) {
    chosen = cpuInput(world, toward, 0, BUTTONS.GRAB);
  }
  if (!chosen && canAct && !player.grounded && distance < 115 && world.rng() < profile.aggression) {
    const vertical = dy < -42 ? -1 : dy > 48 ? 1 : 0;
    chosen = cpuInput(world, toward, vertical, BUTTONS.ATTACK);
  }
  if (!chosen && canAct && distance < 105 && Math.abs(dy) < 85 && world.rng() < profile.aggression) {
    const vertical = dy < -38 ? -1 : target.damage > 105 && world.rng() < .44 ? 0 : dy > 42 ? 1 : 0;
    const useSpecial = world.rng() < (difficulty === 'hard' ? .24 : .13);
    chosen = cpuInput(world, vertical ? 0 : toward, vertical, useSpecial ? BUTTONS.SPECIAL : BUTTONS.ATTACK);
  }
  if (!chosen && canAct && distance < 205 && Math.abs(dy) < 100 && world.rng() < profile.aggression * .72) {
    chosen = cpuInput(world, toward, 0, world.rng() < .36 ? BUTTONS.SPECIAL : BUTTONS.ATTACK);
  }
  const targetOffstage = cpuIsOffstage(world, target);
  if (!chosen && canAct && targetOffstage && !cpuIsOffstage(world, player) && world.rng() < profile.edgeguard) {
    chosen = player.grounded
      ? cpuInput(world, 0, 0, BUTTONS.SPECIAL)
      : cpuInput(world, toward, dy > 15 ? 1 : 0, BUTTONS.ATTACK);
  }
  if (!chosen && canAct && distance > 220 && player.projectileCooldown <= 0 && world.rng() < profile.aggression * .42) {
    // Neutral stick is intentional: X with a horizontal direction would select
    // the side special instead of the fighter's projectile.
    chosen = cpuInput(world, 0, 0, BUTTONS.SPECIAL);
  }
  if (!chosen) {
    const preferredRange = characterOf(player).moves.specialNeutral.projectile ? 155 : 78;
    const move = distance > preferredRange + 30 ? toward : distance < preferredRange - 28 ? -toward : 0;
    const jump = target.y < player.y - 95 && player.grounded && world.rng() < profile.accuracy * .55;
    chosen = cpuInput(world, move, jump ? -1 : 0);
  }

  brain.input = chosen;
  const actions = chosen.buttons & CPU_ACTION_BUTTONS;
  brain.actionRelease = world.tick + (actions === BUTTONS.SHIELD ? 5 : 1);
  return chosen;
}

function finishMatch(world) {
  if (world.phase !== 'active') return;
  const active = world.players.filter(player => !player.eliminated);
  if (world.rules.mode !== 'time' && world.rules.mode !== 'training') {
    const teams = new Set(active.map(player => world.rules.teams ? player.team : player.i));
    if (teams.size <= 1) { world.phase = 'ended'; world.winner = active[0]?.i ?? null; }
    else if (world.remainingTicks <= 0) {
      const ranked = [...active].sort((a, b) => b.stocks - a.stocks || a.damage - b.damage);
      if (ranked.length > 1 && ranked[0].stocks === ranked[1].stocks && Math.abs(ranked[0].damage - ranked[1].damage) < 0.01 && !world.suddenDeath) {
        world.suddenDeath = true; world.remainingTicks = 120 * TICK_RATE;
        for (const player of world.players) { player.damage = 150; player.eliminated = !ranked.slice(0, 2).includes(player); }
        emit(world, 'sudden-death');
      } else { world.phase = 'ended'; world.winner = ranked[0]?.i ?? null; }
    }
  }
  if (world.rules.mode === 'time' && world.remainingTicks <= 0) {
    const best = Math.max(...world.players.map(player => player.score));
    const leaders = world.players.filter(player => player.score === best);
    if (leaders.length === 1) { world.phase = 'ended'; world.winner = leaders[0].i; }
    else if (!world.suddenDeath) {
      world.suddenDeath = true; world.remainingTicks = 120 * TICK_RATE;
      for (const player of world.players) { player.damage = 150; player.eliminated = !leaders.includes(player); player.x = 640 + (leaders.indexOf(player) - (leaders.length - 1) / 2) * 120; player.y = 300; }
      emit(world, 'sudden-death');
    }
  }
  if (world.phase === 'ended') emit(world, 'match-end', { winner: world.winner });
}

function stepWorld(world, inputs = {}) {
  if (world.training?.paused) return world;
  world.tick += 1; updatePlatforms(world);
  if (world.phase === 'countdown') {
    world.countdown -= 1;
    if (world.countdown <= 0) { world.phase = 'active'; emit(world, 'fight'); }
    return world;
  }
  if (world.phase !== 'active') return world;
  if (world.rules.mode !== 'training' && (world.rules.mode === 'time' || world.rules.timeSeconds)) {
    world.remainingTicks = Math.max(0, world.remainingTicks - 1);
  }

  const resolvedInputs = new Map();
  for (const player of world.players) {
    const supplied = inputs[player.i];
    const input = supplied || (player.clientId?.startsWith('cpu:') ? decideCpuInput(world, player, world.training.cpu) : player.lastInput);
    resolvedInputs.set(player.i, input);
  }
  // Arm every player's neutral shield tap before resolving attacks. This keeps
  // same-tick parries fair regardless of roster/update order.
  for (const player of world.players) {
    const input = resolvedInputs.get(player.i);
    const neutralShield = Math.abs(Number(input?.horizontal) || 0) <= .4 && Math.abs(Number(input?.vertical) || 0) <= .4;
    const canParry = player.grounded && neutralShield && pressed(input || {}, player.lastInput, BUTTONS.SHIELD)
      && !player.shielding && !player.action && player.stun <= 0 && player.hitstop <= 0
      && player.dodgeFrames <= 0 && player.landingLag <= 0 && player.shieldStun <= 0
      && player.shieldDropLag <= 0 && player.shieldLock <= 0 && player.knockdownFrames <= 0
      && !player.ledge && player.grabbedBy == null && player.grabbing == null;
    if (canParry) {
      player.parryFrames = Math.max(player.parryFrames, PARRY_FRAMES + 1);
      player.actionName = 'parryReady';
      emit(world, 'parry-ready', { player: player.i });
    }
  }
  for (const player of world.players) {
    const input = resolvedInputs.get(player.i);
    updatePlayer(world, player, input);
  }
  resolvePlayerPushboxes(world);
  updateEntities(world); updateItems(world); updateHazards(world); finishMatch(world);
  return world;
}

function resolvePlayerPushboxes(world) {
  const active = world.players.filter(player => !player.eliminated && !player.respawn && player.grabbedBy == null);
  for (let a = 0; a < active.length; a++) for (let b = a + 1; b < active.length; b++) {
    const first = active[a], second = active[b];
    const firstPassing = first.dodgeFrames > 0 && first.grounded && ['roll', 'techRoll', 'getupRoll', 'ledgeRoll'].includes(first.actionName);
    const secondPassing = second.dodgeFrames > 0 && second.grounded && ['roll', 'techRoll', 'getupRoll', 'ledgeRoll'].includes(second.actionName);
    if (firstPassing || secondPassing) continue;
    if (!first.grounded || !second.grounded || Math.abs(first.y - second.y) > Math.min(first.height, second.height) * .6) continue;
    const overlap = (first.width + second.width) / 2 - Math.abs(first.x - second.x);
    if (overlap <= 0) continue;
    const direction = Math.sign(second.x - first.x) || (first.i < second.i ? 1 : -1);
    first.x -= direction * overlap / 2; second.x += direction * overlap / 2;
    first.vx = Math.min(0, first.vx * direction) * direction;
    second.vx = Math.max(0, second.vx * direction) * direction;
  }
}

function publicSnapshot(world) {
  return {
    tick: world.tick, serverTime: Date.now(),
    ackSeq: Object.fromEntries(world.players.map(player => [player.i, player.ackSeq])),
    phase: world.phase, countdown: world.countdown,
    remainingTicks: world.remainingTicks, winner: world.winner, suddenDeath: world.suddenDeath,
    rules: world.rules, stage: world.stage, platforms: world.platforms,
    players: world.players.map(player => {
      const action = player.action;
      const startup = action ? action.startup ?? action.move.startup : 0;
      const actionPhase = !action ? null : action.charging ? 'charge' : action.frame < startup ? 'startup' : action.frame < startup + action.move.active ? 'active' : 'recovery';
      const phaseStart = !action ? 0 : actionPhase === 'startup' || actionPhase === 'charge' ? 0 : actionPhase === 'active' ? startup : startup + action.move.active;
      const phaseLength = !action ? 1 : actionPhase === 'charge' ? 90 : actionPhase === 'startup' ? Math.max(1, startup) : actionPhase === 'active' ? Math.max(1, action.move.active) : Math.max(1, action.move.recovery);
      const phaseProgress = action ? actionPhase === 'charge' ? action.holdFrames / 90 : clamp((action.frame - phaseStart) / phaseLength, 0, 1) : 0;
      const actionHitbox = action && actionPhase === 'active'
        ? action.name === 'grab'
          ? grabHitbox(player)
          : !action.move.projectileOnly && !action.move.trapOnly && !action.move.defensiveOnly && hasAttackGeometry(action.move) ? attackHitbox(player, action.move) : null
        : null;
      const strikePoints = actionHitbox ? visualStrikePoints(player, action?.move || {}, action?.name, actionHitbox) : [];
      return {
        ...player,
        action: undefined,
        lastInput: undefined,
        hurtboxes: playerHurtboxes(player),
        actionFrame: action?.frame || 0,
        actionPhase,
        actionVariant: action?.variant || null,
        actionMotion: action?.move?.motion || null,
        actionTiming: action ? { startup, active: action.move.active, recovery: action.move.recovery } : null,
        phaseProgress,
        actionHitbox,
        strikePoints,
        chargeFrames: action?.charging ? action.holdFrames : 0,
        chargeScale: action?.chargeScale || 1
      };
    }),
    entities: world.entities, items: world.items.map(item => ({ ...item, definition: item.definition })),
    events: world.events.slice(-20)
  };
}

function trainingCommand(world, command) {
  if (world.rules.mode !== 'training') return false;
  if (command.type === 'pause') world.training.paused = !!command.value;
  else if (command.type === 'hitboxes') world.training.showHitboxes = !!command.value;
  else if (command.type === 'cpu') world.training.cpu = ['dummy', 'easy', 'normal', 'hard'].includes(command.value) ? command.value : 'dummy';
  else if (command.type === 'reset') {
    world.entities = [];
    world.items = [];
    for (const player of world.players) {
      resetPlayerState(world, player, { x: 640 + (player.i - 0.5) * 160, y: 300, damage: player.i ? clamp(Number(command.damage) || 0, 0, 999) : 0 });
      player.respawn = 0; player.shield = 100; player.heldItem = null;
    }
  } else {
    return false;
  }
  return true;
}

function forfeitPlayer(world, index) {
  const player = world.players.find(item => item.i === index);
  if (!player) return false;
  releaseGrab(world, player); player.eliminated = true; player.disconnected = true; player.stocks = 0; player.respawn = 0;
  player.action = null; player.actionBuffer = null; player.shielding = false; player.ledge = null; player.vx = 0; player.vy = 0;
  return true;
}

module.exports = { TICK_RATE, WORLD_W, WORLD_H, BLAST_MARGIN_X, BLAST_TOP, BLAST_BOTTOM, normalizeRules, createWorld, stepWorld, publicSnapshot, trainingCommand, forfeitPlayer };
