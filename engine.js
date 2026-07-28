const { BUTTONS, FIGHTERS, STAGES, ITEMS, DEFAULT_RULES } = require('./content');
const {
  CPU_PROFILES,
  blazeAirNeutralWanted,
  blazeNeutralChargeFrames,
  chooseCombatPlan,
  fighterDefenseChance,
  preferredCombatRange,
  boltBoomerangWanted
} = require('./cpu-policy');
const { selectRecoveryTarget, isOffstage } = require('./cpu-navigation');
const { selectCpuTarget, findIncomingThreat } = require('./cpu-combat');
const { planCpuRecovery } = require('./cpu-recovery');

const TICK_RATE = 60;
const WORLD_W = 1280;
const WORLD_H = 720;
const BLAST_MARGIN_X = 360;
const BLAST_TOP = -300;
const BLAST_BOTTOM = WORLD_H + 260;
const ACTION_BUFFER_FRAMES = 10;
const JAB_CHAIN_BUFFER_FRAMES = 24;
const JAB_CHAIN_WINDOW_FRAMES = 24;
const JUMP_BUFFER_FRAMES = 10;
// Grounded Z stays a jab/tilt until the player deliberately holds it for
// fourteen frames. Shorter gates overlapped ordinary keyboard press duration
// and caused accidental smash charges under network sampling.
const SMASH_HOLD_FRAMES = 14;
const SMASH_MAX_HOLD_FRAMES = 90;
const SMASH_MAX_DAMAGE_SCALE = 1.4;
const SPECIAL_TURNAROUND_FRAMES = 4;
const DASH_DURATION_FRAMES = 16;
const PIVOT_DASH_WINDOW = 6;
const PARRY_FRAMES = 6;
const PARRY_MISS_LAG_FRAMES = 10;
const PARRY_ATTACKER_FREEZE_FRAMES = 20;
const PARRY_INVINCIBLE_FRAMES = 8;
const SHIELD_MAX = 50;
const REGRAB_LOCK_FRAMES = 60;
const LEDGE_HANG_MAX_FRAMES = 300;
const TECH_MAX_IMPACT_SPEED = 620;
const ULTIMATE_READY = 100;
const ULTIMATE_MOVES = Object.freeze({
  volt: {
    motion: 'ultimateVolt', startup: 22, active: 3, recovery: 32,
    damage: 31, kx: 545, ky: 330, hitstop: 12, knockbackGrowth: 1.32,
    radius: 110, targetOffset: 220,
    projectileOnly: true, ultimateKind: 'volt'
  },
  blaze: {
    motion: 'ultimateBlaze', startup: 20, active: 8, recovery: 40,
    damage: 34, kx: 620, ky: 285, hitstop: 13, knockbackGrowth: 1.36,
    reachX: 145, reachY: 82, dash: 'ultimate', dashSpeed: 780,
    startupDrag: .5, recoveryDrag: .48, armor: true, armorThreshold: 10,
    ultimateKind: 'blaze'
  },
  bolt: {
    motion: 'ultimateBolt', startup: 19, active: 2, recovery: 34,
    damage: 31, kx: 575, ky: 245, hitstop: 12, knockbackGrowth: 1.34,
    projectileSpeed: 680, radius: 38,
    projectileOnly: true, ultimateKind: 'bolt'
  },
  nova: {
    motion: 'ultimateNova', startup: 22, active: 3, recovery: 36,
    damage: 30, kx: 480, ky: 365, hitstop: 12, knockbackGrowth: 1.3,
    radius: 150, pullStrength: 1.2,
    projectileOnly: true, ultimateKind: 'nova'
  }
});
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
    grounded: false, platformId: null, jumps: 2, fastFalling: false, fastFallFlashFrames: 0,
    damage: rules.mode === 'training' ? Number(entry.damage || 0) : 0,
    stocks: rules.mode === 'time' ? 0 : rules.stocks, score: 0, kos: 0, falls: 0,
    shield: SHIELD_MAX, shielding: false, parryFrames: 0, shieldLock: 0, shieldStun: 0, shieldDropLag: 0,
    shieldHoldFrames: 0, shieldReleaseQueued: false, shieldOffsetX: 0, shieldOffsetY: 0,
    action: null, actionName: 'idle', stun: 0, hitstop: 0, invincible: 90, dodgeFrames: 0,
    dodgeTotalFrames: 0, dodgeElapsed: 0, dodgeSerial: 0, dodgeStartVx: 0, dodgeStartVy: 0, dodgeInitialVx: 0, dodgeInitialVy: 0, dodgeWindupFrames: 0, dodgeNeutral: false,
    airDodgeAvailable: true, recoveryAvailable: true, ledge: null, ledgeInvincible: 0, ledgeCatchFrames: 0, ledgeGrabLockFrames: 0, ledgeHangFrames: 0,
    ledgeTransition: null, ledgeTransitionFrames: 0, ledgeTransitionTotal: 0,
    ledgeJumpRefreshPending: false, canLedgeInvincible: true, ledgeGrabs: 0,
    grabbedBy: null, grabbing: null, grabFrames: 0, grabEscape: 0, grabPummelCooldown: 0, grabImmunity: 0, pendingThrow: null,
    comboCount: 0, comboTimer: 0, comboAttacker: null, lastDamager: null, staleQueue: [], jabStep: 0, jabTimer: 0,
    charge: null, heldItem: null, jumpBuff: 0, jumpBuffMultiplier: 1, projectileCooldown: 0, projectileCooldownMax: 0,
    ultimateMeter: rules.mode === 'training' ? ULTIMATE_READY : 0,
    respawn: 0, respawnPlatformFrames: 0, eliminated: false, disconnected: false,
    lastInput: { buttons: 0, horizontal: 0, vertical: 0, seq: 0 },
    ackSeq: 0, lastTapLeft: -999, lastTapRight: -999,
    specialFlickDirection: 0, specialFlickFrames: 0, specialFlickFacing: 0,
    landingLag: 0, pendingLandingLag: 0, skidFrames: 0,
    movementState: 'idle', dashFrames: 0, dashAge: 0, dashDirection: 0, dashBrakeFrames: 0,
    jumpSquatDash: false, dashJumpVx: 0,
    horizontalHoldFrames: 0, horizontalHoldDirection: 0, hitId: 0, doubleJumpSerial: 0,
    coyoteFrames: 0, jumpBuffer: 0, actionBuffer: null,
    tumbling: false, tumbleRecoverFrames: 0, freefall: false, techWindow: 0, knockdownFrames: 0, launchDecay: 0, criticalFlightFrames: 0, sdiCooldown: 0, canSdi: false, lastSdiHorizontal: 0, lastSdiVertical: 0,
    dizzyFrames: 0, lastMashButtons: 0, lastMashHorizontal: 0, lastMashVertical: 0,
    footstoolCooldown: 0, footstoolCount: 0, offscreenDamageClock: 0,
    dodgeFatigue: 0, dodgeFatigueCooldown: 0, shortHopFrames: 0, jumpSquatFrames: 0, jumpSquatShort: false, jumpSquatAttack: null, shieldBuffer: 0,
    dropThroughFrames: 0
  };
}

function createWorld(options = {}) {
  const rules = normalizeRules(options.rules);
  const stage = STAGES.find(item => item.id === rules.stageId);
  const roster = options.roster || [];
  return {
    tick: 0, phase: rules.mode === 'training' ? 'active' : 'countdown',
    countdown: rules.mode === 'training' ? 0 : 180, rules,
    remainingTicks: rules.timeSeconds * TICK_RATE,
    players: roster.map((entry, index) => createPlayer(entry, index, roster.length, rules)),
    platforms: stage.platforms.map(platform => ({ ...platform, baseX: platform.x, baseY: platform.y })),
    stage: { id: stage.id, name: stage.name, color: stage.color },
    hazards: stage.hazards.map(hazard => ({ ...hazard })),
    entities: [], items: [], pendingMoveHits: [], nextEntityId: 1,
    nextItemTick: 720 + Math.floor((options.seed || 7) % 480),
    events: [], eventId: 1, winner: null, suddenDeath: false,
    rng: makeRng(options.seed), cpuBrains: new Map(),
    training: { paused: false, showHitboxes: false, cpu: options.cpu || 'dummy' },
    oneOnOneDamage: roster.length === 2 && !rules.items && !rules.teams && rules.mode !== 'training'
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
function hasInvincibility(player) {
  return player.invincible > 0
    || !!player.ledge && player.ledgeCatchFrames <= 0 && player.ledgeInvincible > 0;
}

function releaseGrab(world, player) {
  if (player.grabbing != null) {
    const held = world.players.find(other => other.i === player.grabbing);
    if (held) {
      held.grabbedBy = null;
      held.grabImmunity = Math.max(held.grabImmunity || 0, REGRAB_LOCK_FRAMES);
    }
  }
  if (player.grabbedBy != null) {
    const holder = world.players.find(other => other.i === player.grabbedBy);
    if (holder) { holder.grabbing = null; holder.grabFrames = 0; holder.grabEscape = 0; holder.grabPummelCooldown = 0; holder.pendingThrow = null; }
    player.grabImmunity = Math.max(player.grabImmunity || 0, REGRAB_LOCK_FRAMES);
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
  player.jumps = 2; player.fastFalling = false; player.fastFallFlashFrames = 0; player.airDodgeAvailable = true; player.recoveryAvailable = true;
  player.action = null; player.actionName = 'fall'; player.actionBuffer = null; player.charge = null;
  player.stun = 0; player.hitstop = 0; player.dodgeFrames = 0; player.dodgeTotalFrames = 0; player.dodgeElapsed = 0; player.dodgeSerial = 0; player.dodgeStartVx = 0; player.dodgeStartVy = 0; player.dodgeInitialVx = 0; player.dodgeInitialVy = 0; player.dodgeWindupFrames = 0; player.dodgeNeutral = false; player.landingLag = 0; player.pendingLandingLag = 0;
  player.shielding = false; player.parryFrames = 0; player.shieldStun = 0; player.shieldDropLag = 0; player.shieldHoldFrames = 0; player.shieldReleaseQueued = false; player.shieldOffsetX = 0; player.shieldOffsetY = 0; player.skidFrames = 0;
  player.movementState = 'idle'; player.dashFrames = 0; player.dashAge = 0; player.dashDirection = 0; player.dashBrakeFrames = 0; player.jumpSquatDash = false; player.dashJumpVx = 0;
  player.horizontalHoldFrames = 0; player.horizontalHoldDirection = 0; player.ledge = null; player.ledgeInvincible = 0; player.ledgeCatchFrames = 0; player.ledgeGrabLockFrames = 0; player.ledgeHangFrames = 0; player.ledgeTransition = null; player.ledgeTransitionFrames = 0; player.ledgeTransitionTotal = 0; player.ledgeJumpRefreshPending = false; player.ledgeGrabs = 0; player.canLedgeInvincible = true;
  player.coyoteFrames = 0; player.jumpBuffer = 0; player.comboCount = 0; player.comboTimer = 0; player.comboAttacker = null; player.staleQueue = []; player.jabStep = 0; player.jabTimer = 0; player.lastDamager = null;
  player.tumbling = false; player.tumbleRecoverFrames = 0; player.freefall = false; player.techWindow = 0; player.knockdownFrames = 0; player.launchDecay = 0; player.criticalFlightFrames = 0; player.sdiCooldown = 0; player.canSdi = false; player.lastSdiHorizontal = 0; player.lastSdiVertical = 0;
  player.dodgeFatigue = 0; player.dodgeFatigueCooldown = 0; player.shortHopFrames = 0; player.jumpSquatFrames = 0; player.jumpSquatShort = false; player.jumpSquatAttack = null; player.shieldBuffer = 0; player.dropThroughFrames = 0; player.doubleJumpSerial = 0;
  player.dizzyFrames = 0; player.lastMashButtons = 0; player.lastMashHorizontal = 0; player.lastMashVertical = 0; player.footstoolCooldown = 0; player.footstoolCount = 0; player.offscreenDamageClock = 0;
  player.specialFlickDirection = 0; player.specialFlickFrames = 0; player.specialFlickFacing = 0;
  player.grabEscape = 0; player.grabPummelCooldown = 0; player.grabImmunity = 0; player.pendingThrow = null;
  player.projectileCooldown = 0; player.projectileCooldownMax = 0; player.jumpBuff = 0; player.jumpBuffMultiplier = 1;
  player.invincible = options.invincible ?? 0; player.respawnPlatformFrames = 0; player.eliminated = false; player.disconnected = false;
}

function isDashState(player) {
  return player.dashFrames > 0 && (player.movementState === 'dash' || player.movementState === 'pivot');
}

function isRunningAttackState(player) {
  return isDashState(player) || player.movementState === 'run';
}

function beginDash(player, direction, pivot = false) {
  const character = characterOf(player);
  const dashSpeed = pivot ? character.pivotDashSpeed : character.dashSpeed;
  player.dashFrames = DASH_DURATION_FRAMES;
  player.dashAge = 0;
  player.dashDirection = direction;
  player.dashBrakeFrames = 0;
  player.skidFrames = 0;
  player.movementState = pivot ? 'pivot' : 'dash';
  player.actionName = player.movementState;
  player.face = direction;
  player.vx = direction * dashSpeed;
}

function beginDashBrake(player) {
  const character = characterOf(player);
  player.dashFrames = 0;
  player.dashAge = 0;
  player.dashBrakeFrames = character.dashBrakeFrames;
  player.movementState = 'brake';
  player.actionName = 'brake';
}

function moveName(player, input, special) {
  const up = input.vertical < -0.45;
  const down = input.vertical > 0.45;
  const side = Math.abs(input.horizontal) > 0.35;
  if (special) return up ? 'specialUp' : down ? 'specialDown' : side ? 'specialSide' : 'specialNeutral';
  if (!player.grounded) return up ? 'airUp' : down ? 'airDown' : side ? Math.sign(input.horizontal) === player.face ? 'airForward' : 'airBack' : 'airNeutral';
  return side ? isRunningAttackState(player) ? 'dashAttack' : 'groundSide' : up ? 'groundUp' : down ? 'groundDown' : 'groundNeutral';
}

function bufferActionInput(player, input, previous) {
  const directionalAction = pressed(input, previous, BUTTONS.ATTACK) || pressed(input, previous, BUTTONS.SPECIAL);
  if (pressed(input, previous, BUTTONS.UP) && (!directionalAction || input.vertical > -0.45)) player.jumpBuffer = JUMP_BUFFER_FRAMES;
  else if (player.jumpBuffer > 0 && player.hitstop === 0) player.jumpBuffer = bit(input.buttons, BUTTONS.UP) ? Math.max(1, player.jumpBuffer - 1) : player.jumpBuffer - 1;
  const ultimatePressed = player.grounded && player.ultimateMeter >= ULTIMATE_READY
    && bit(input.buttons, BUTTONS.ATTACK) && bit(input.buttons, BUTTONS.SPECIAL)
    && (pressed(input, previous, BUTTONS.ATTACK) || pressed(input, previous, BUTTONS.SPECIAL));
  if (ultimatePressed) player.actionBuffer = {
    type: 'ultimate', input: { ...input }, frames: ACTION_BUFFER_FRAMES,
    pendingHold: false, holdFrames: 0, triggerButton: BUTTONS.ATTACK | BUTTONS.SPECIAL
  };
  else if (pressed(input, previous, BUTTONS.GRAB)) player.actionBuffer = { type: 'grab', input: { ...input }, frames: ACTION_BUFFER_FRAMES };
  else if (pressed(input, previous, BUTTONS.SPECIAL)) player.actionBuffer = {
    type: 'special', input: { ...input }, frames: ACTION_BUFFER_FRAMES,
    pendingHold: false, holdFrames: 0, triggerButton: BUTTONS.SPECIAL
  };
  else if (pressed(input, previous, BUTTONS.ATTACK)) {
    const directional = Math.abs(input.horizontal) > .35 || Math.abs(input.vertical) > .45;
    const dashAttackIntent = player.grounded
      && Math.abs(input.horizontal) > .35
      && isRunningAttackState(player);
    const bufferingJabFollowup = player.action?.move?.jab > 0 && player.action.move.jab < 3;
    const canChargeSmash = player.grounded && !player.heldItem && !dashAttackIntent && !bufferingJabFollowup
      && bit(input.buttons, BUTTONS.ATTACK);
    player.actionBuffer = {
      type: 'attack',
      input: { ...input },
      frames: bufferingJabFollowup ? JAB_CHAIN_BUFFER_FRAMES : ACTION_BUFFER_FRAMES,
      variant: directional && !canChargeSmash && !dashAttackIntent ? 'tilt' : 'normal',
      pendingHold: canChargeSmash,
      holdFrames: canChargeSmash ? 1 : 0,
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
        if (buffered.type !== 'ultimate' && bit(input.buttons, heldButton)) {
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
  const dashJump = isDashState(player);
  player.jumpSquatFrames = 3;
  player.jumpSquatShort = !!attack;
  player.jumpSquatAttack = attack ? { ...attack, input: { ...attack.input } } : null;
  player.jumpSquatDash = dashJump;
  player.dashJumpVx = dashJump ? player.vx : 0;
  player.dashFrames = 0;
  player.dashAge = 0;
  player.dashBrakeFrames = 0;
  player.movementState = 'jumpSquat';
  player.jumpBuffer = 0;
  player.actionName = 'jumpSquat';
  player.vx *= dashJump ? .99 : .94;
}

function processJumpSquat(world, player, input, previous) {
  const character = characterOf(player);
  if (Math.abs(input.horizontal) > .12) {
    const dashDirection = Math.sign(player.dashJumpVx || player.vx || input.horizontal);
    const preservingDash = player.jumpSquatDash && Math.sign(input.horizontal) === dashDirection;
    const desired = preservingDash ? dashDirection * character.dashSpeed * .94 : input.horizontal * 360 * character.speed;
    player.vx = approach(player.vx, desired, preservingDash ? 24 : Math.sign(desired) !== Math.sign(player.vx) ? 120 : 58);
    player.face = Math.sign(input.horizontal);
  } else player.vx *= player.jumpSquatDash ? .995 : .98;
  if (released(input, previous, BUTTONS.UP)) player.jumpSquatShort = true;
  if (player.actionBuffer?.type === 'attack') {
    player.jumpSquatAttack = { ...player.actionBuffer, input: { ...player.actionBuffer.input } };
    player.jumpSquatShort = true;
    player.actionBuffer = null;
  }
  player.jumpSquatFrames -= 1;
  if (player.jumpSquatFrames > 0) { player.actionName = 'jumpSquat'; return; }
  const shortHop = player.jumpSquatShort, attack = player.jumpSquatAttack;
  const dashJump = player.jumpSquatDash, storedDashVx = player.dashJumpVx;
  player.jumpSquatFrames = 0; player.jumpSquatShort = false; player.jumpSquatAttack = null;
  player.jumpSquatDash = false; player.dashJumpVx = 0; player.movementState = 'air';
  player.shortHopFrames = shortHop ? 4 : 0;
  player.vy = -(shortHop ? 470 : 590) * character.jump * (player.jumpBuff ? player.jumpBuffMultiplier || 1.3 : 1);
  if (dashJump && Math.sign(player.vx || storedDashVx) === Math.sign(storedDashVx)) {
    player.vx = Math.sign(storedDashVx) * Math.max(Math.abs(player.vx), Math.abs(storedDashVx) * .92);
  }
  player.jumps = 1; player.coyoteFrames = 0; player.grounded = false; player.platformId = null; player.actionName = 'jump';
  player.tumbling = false; player.techWindow = 0;
  if (attack) {
    startMove(world, player, moveName(player, attack.input, false));
    if (shortHop && player.action?.name?.startsWith('air')) player.action.move.shortHop = true;
  }
}

function freshHorizontalDirection(input, previous) {
  if (input.horizontal < -.75 && previous.horizontal >= -.35) return -1;
  if (input.horizontal > .75 && previous.horizontal <= .35) return 1;
  return 0;
}

function tryFootstool(world, player) {
  if (player.grounded || player.ledge || player.footstoolCooldown > 0) return false;
  const feetY = player.y + player.height / 2;
  const target = world.players
    .filter(other => other.i !== player.i && !other.eliminated && other.respawn <= 0 && !other.ledge && !hasInvincibility(other) && other.grabbedBy == null
      && (world.rules.friendlyFire || !world.rules.teams || other.team !== player.team)
      && Math.abs(other.x - player.x) <= (player.width + other.width) * .34
      && feetY >= other.y - other.height / 2 - 12
      && feetY <= other.y - other.height / 2 + 30)
    .sort((first, second) => Math.abs(first.x - player.x) - Math.abs(second.x - player.x))[0];
  if (!target) return false;
  const reboundScale = Math.max(.55, 1 - (player.footstoolCount || 0) * .18);
  player.vy = -620 * characterOf(player).jump * reboundScale;
  player.jumpBuffer = 0; player.fastFalling = false; player.actionName = 'footstool';
  player.footstoolCooldown = 18; player.footstoolCount = Math.min(4, (player.footstoolCount || 0) + 1);
  target.lastDamager = player.i;
  if (!target.ledge && !target.action) {
    target.actionBuffer = null;
    if (target.grounded) {
      target.stun = Math.max(target.stun, 12);
      target.actionName = 'footstooled';
    } else {
      target.vy = Math.max(target.vy, 210);
      target.stun = Math.max(target.stun, 18);
      target.tumbling = true;
      target.actionName = 'tumble';
    }
  }
  emit(world, 'footstool', { player: player.i, target: target.i, x: target.x, y: target.y - target.height / 2 });
  return true;
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
  const tiltRecoveryBonus = player.characterId === 'blaze' && name === 'groundDown'
    ? 3
    : ({ volt: 1, blaze: 1, bolt: 2, nova: 2 })[player.characterId] || 1;
  const tiltStartupBonus = player.characterId === 'blaze' && name === 'groundDown' ? 1 : 0;
  const definition = tilt ? {
    ...source,
    startup: Math.max(3, source.startup - 2 - tiltStartupBonus),
    recovery: Math.max(5, Math.round(source.recovery * .7) - tiltRecoveryBonus),
    cancelWindow: Math.max(5, source.cancelWindow || 0),
    damage: source.damage * .72,
    kx: source.kx * .7,
    ky: source.ky * .76,
    reachX: source.reachX * .9,
    reachY: source.reachY * .92,
    chargeable: false,
    tilt: true
  } : source;
  const knockbackScale = 1 + Math.max(0, chargeScale - 1) * 0.625;
  const angleShift = name === 'groundSide' ? clamp(Number(options.input?.vertical) || 0, -1, 1) : 0;
  const angleKyScale = angleShift < -.45 ? 1.24 : angleShift > .45 ? .58 : 1;
  const move = {
    ...definition,
    name,
    staleKey: tilt ? `${name}:tilt` : variant === 'smash' ? `${name}:smash` : name,
    damage: definition.damage * chargeScale,
    kx: definition.kx * knockbackScale,
    ky: definition.ky * knockbackScale * angleKyScale,
    angleShift,
    hitboxShiftY: angleShift * Math.min(18, definition.reachY * .24)
  };
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
    startedAirborne: !player.grounded,
    specialTurnaround: options.specialTurnaround || null,
    inputHorizontal: clamp(Number(options.input?.horizontal) || 0, -1, 1),
    inputVertical: clamp(Number(options.input?.vertical) || 0, -1, 1)
  };
  if (player.grounded) {
    player.movementState = 'action';
    player.dashFrames = 0;
    player.dashAge = 0;
    player.dashBrakeFrames = 0;
  }
  player.actionName = name;
  if (!source.jab) { player.jabStep = 0; player.jabTimer = 0; }
  player.shielding = false; player.parryFrames = 0; player.shieldHoldFrames = 0; player.shieldReleaseQueued = false; player.tumbling = false; player.tumbleRecoverFrames = 0; player.freefall = false; player.techWindow = 0; player.knockdownFrames = 0;
  emit(world, 'action', { player: player.i, action: name, variant: player.action.variant });
  return true;
}

function startUltimate(world, player) {
  if (!player.grounded || (player.ultimateMeter || 0) < ULTIMATE_READY || player.action || player.eliminated || player.respawn > 0) return false;
  const source = ULTIMATE_MOVES[player.characterId];
  if (!source) return false;
  const move = { ...source, name: 'ultimate', cancelWindow: 0 };
  player.ultimateMeter = 0;
  player.action = {
    name: 'ultimate', move, variant: player.characterId,
    frame: 0, startup: move.startup, hit: [], activated: false,
    inputHorizontal: player.face, inputVertical: 0
  };
  player.actionName = 'ultimate';
  player.actionBuffer = null; player.jumpBuffer = 0; player.shieldBuffer = 0;
  player.shielding = false; player.parryFrames = 0; player.shieldHoldFrames = 0; player.shieldReleaseQueued = false; player.tumbling = false;
  player.knockdownFrames = 0; player.vx *= player.grounded ? .35 : .75;
  const color = colorOf(player);
  if (move.ultimateKind === 'volt') {
    world.entities.push({
      id: world.nextEntityId++, type: 'ultimate', kind: 'ultimateVolt', owner: player.i,
      x: clamp(player.x + player.face * (move.targetOffset || 220), 80, WORLD_W - 80), y: player.y,
      radius: move.radius || 110, damage: move.damage, kx: move.kx, ky: move.ky,
      knockbackGrowth: move.knockbackGrowth, hitstop: move.hitstop,
      arm: move.startup, life: move.startup + 5, persistent: true,
      color, hitPlayers: []
    });
  } else if (move.ultimateKind === 'nova') {
    world.entities.push({
      id: world.nextEntityId++, type: 'ultimate', kind: 'ultimateNova', owner: player.i,
      x: clamp(player.x + player.face * 145, 100, WORLD_W - 100), y: player.y,
      radius: move.radius || 150, damage: move.damage, kx: move.kx, ky: move.ky,
      knockbackGrowth: move.knockbackGrowth, hitstop: move.hitstop,
      pullStrength: move.pullStrength || 1.2, arm: move.startup, life: move.startup + 6,
      persistent: true, color, hitPlayers: []
    });
  }
  emit(world, 'ultimate-start', { player: player.i, fighter: player.characterId, x: player.x, y: player.y });
  return true;
}

function segmentEntryTime(startX, startY, endX, endY, minX, minY, maxX, maxY) {
  const dx = endX - startX, dy = endY - startY;
  let enter = 0, exit = 1;
  for (const [start, delta, low, high] of [[startX, dx, minX, maxX], [startY, dy, minY, maxY]]) {
    if (Math.abs(delta) < 0.0001) {
      // Travelling exactly along a solid floor's outer edge is not entering it.
      if (start <= low + 0.5 || start >= high - 0.5) return null;
      continue;
    }
    const first = (low - start) / delta, second = (high - start) / delta;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (enter > exit) return null;
  }
  return enter > 0.0001 && enter <= 1 ? enter : null;
}

function clampWarpToSolid(world, player, startX, startY, targetX, targetY) {
  const halfWidth = player.width / 2, halfHeight = player.height / 2;
  let firstHit = 1;
  for (const platform of world.platforms) {
    if (!platform.ground) continue;
    const groundDepth = platform.groundDepth || 320;
    const minX = platform.x - halfWidth;
    const maxX = platform.x + platform.w + halfWidth;
    const minY = platform.y - halfHeight;
    const maxY = platform.y + groundDepth + halfHeight;
    const entry = segmentEntryTime(startX, startY, targetX, targetY, minX, minY, maxX, maxY);
    if (entry != null) firstHit = Math.min(firstHit, entry);
  }
  if (firstHit >= 1) return { x: targetX, y: targetY, blocked: false };
  const distance = Math.hypot(targetX - startX, targetY - startY);
  const safeTime = Math.max(0, firstHit - 2 / Math.max(2, distance));
  return {
    x: startX + (targetX - startX) * safeTime,
    y: startY + (targetY - startY) * safeTime,
    blocked: true
  };
}

function novaWarpDestination(world, player, action, progress) {
  const { move } = action;
  const startX = Number.isFinite(action.warpOriginX) ? action.warpOriginX : player.x;
  const startY = Number.isFinite(action.warpOriginY) ? action.warpOriginY : player.y;
  const distanceCharge = clamp(Number(progress) || 0, 0, 1);
  let targetX = startX, targetY = startY, exitX = 0, exitY = 0;

  if (move.teleport) {
    const minimum = action.previewWarp ? 0 : move.teleportMin ?? move.teleport;
    const maximum = move.teleportMax ?? move.teleport;
    const distance = minimum + (maximum - minimum) * distanceCharge;
    const exitSpeed = (move.teleportExitSpeedMin ?? move.teleportExitSpeed ?? 0)
      + ((move.teleportExitSpeedMax ?? move.teleportExitSpeed ?? 0) - (move.teleportExitSpeedMin ?? move.teleportExitSpeed ?? 0)) * distanceCharge;
    targetX = clamp(startX + (action.warpFace || player.face) * distance, -80, WORLD_W + 80);
    exitX = (action.warpFace || player.face) * exitSpeed;
  }

  if (move.teleportY) {
    const aimedWarp = move.recoveryKind === 'warp';
    const aimX = aimedWarp && Math.abs(action.warpAimX ?? action.inputHorizontal) > .2
      ? (action.warpAimX ?? action.inputHorizontal)
      : 0;
    const sideMix = Math.abs(aimX);
    const minimumY = action.previewWarp ? 0 : move.teleportYMin ?? move.teleportY;
    const maximumY = move.teleportYMax ?? move.teleportY;
    const minimumX = action.previewWarp ? 0 : move.teleportHorizontalMin ?? move.teleportHorizontal ?? 0;
    const maximumX = move.teleportHorizontalMax ?? move.teleportHorizontal ?? 0;
    const teleportY = minimumY + (maximumY - minimumY) * distanceCharge;
    const teleportHorizontal = minimumX + (maximumX - minimumX) * distanceCharge;
    const riseSpeed = (move.riseSpeedMin ?? move.riseSpeed ?? 420)
      + ((move.riseSpeedMax ?? move.riseSpeed ?? 420) - (move.riseSpeedMin ?? move.riseSpeed ?? 420)) * distanceCharge;
    const recoveryExitSpeed = (move.recoveryExitSpeedMin ?? move.recoveryExitSpeed ?? teleportHorizontal)
      + ((move.recoveryExitSpeedMax ?? move.recoveryExitSpeed ?? teleportHorizontal) - (move.recoveryExitSpeedMin ?? move.recoveryExitSpeed ?? teleportHorizontal)) * distanceCharge;
    const neutralBonusScale = action.previewWarp ? distanceCharge : 1;
    targetY = startY - teleportY - (move.warpNeutralBonus || 0) * (1 - sideMix) * neutralBonusScale;
    targetX = clamp(startX + aimX * teleportHorizontal, -BLAST_MARGIN_X + 70, WORLD_W + BLAST_MARGIN_X - 70);
    exitY = -riseSpeed - (move.warpNeutralBonus || 0) * (1 - sideMix);
    exitX = aimX * recoveryExitSpeed * .72;
  }

  return { ...clampWarpToSolid(world, player, startX, startY, targetX, targetY), exitX, exitY };
}

function previewDistanceCharge(world, player, action, maxHoldFrames) {
  if (!Number.isFinite(action.warpOriginX)) {
    action.warpOriginX = player.x;
    action.warpOriginY = player.y;
    action.warpFace = player.face;
    action.warpAimX = action.inputHorizontal;
    action.warpChargeStartFrames = action.holdFrames;
    action.previewWarp = true;
  }
  const progress = clamp(
    (action.holdFrames - action.warpChargeStartFrames)
      / Math.max(1, maxHoldFrames - action.warpChargeStartFrames),
    0,
    1
  );
  action.chargeProgress = progress;
  const destination = novaWarpDestination(world, player, action, progress);
  player.x = destination.x;
  player.y = destination.y;
  player.vx = 0;
  player.vy = 0;
  if (action.move.teleportY) {
    player.grounded = false;
    player.platformId = null;
  }
}

function activateMove(world, player, action) {
  if (action.activated) return;
  action.activated = true;
  const { move } = action;
  const distanceCharge = clamp(Number(action.chargeProgress) || 0, 0, 1);
  if (move.teleport || move.teleportY) {
    const destination = novaWarpDestination(world, player, action, distanceCharge);
    player.x = destination.x;
    player.y = destination.y;
    player.vx = destination.exitX;
    player.vy = destination.exitY;
    if (move.teleportY && Math.abs(action.warpAimX ?? action.inputHorizontal) > .2) {
      player.face = Math.sign(action.warpAimX ?? action.inputHorizontal);
    }
    if (move.teleportY) {
    if (move.warpInvincible) player.invincible = Math.max(player.invincible, move.warpInvincible);
    player.jumps = 0;
    }
  }
  if (move.recoveryMove) {
    player.vy = -(move.riseSpeed || 560) * characterOf(player).jump;
    player.vx = player.face * (move.riseHorizontal || 100); player.jumps = 0;
  }
  if (move.dash) player.vx = player.face * (move.dashSpeed || 500) * characterOf(player).speed;
  if (move.projectile) spawnProjectile(world, player, move);
  if (move.trap && move.trap !== true) spawnTrap(world, player, move);
  if (move.ultimateKind === 'bolt') {
    world.entities.push({
      id: world.nextEntityId++, type: 'ultimateProjectile', kind: 'ultimateBolt', owner: player.i,
      x: player.x + player.face * 42, y: player.y - 8,
      vx: player.face * (move.projectileSpeed || 680), vy: 0,
      radius: move.radius || 38, damage: move.damage, kx: move.kx, ky: move.ky,
      knockbackGrowth: move.knockbackGrowth, hitstop: move.hitstop,
      life: 92, persistent: true, color: colorOf(player), hitPlayers: []
    });
  }
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
    returnDamageScale: move.returnDamageScale, crowdDamageScale: move.crowdDamageScale,
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

function beginGrab(world, player, variant = 'normal') {
  const dash = variant === 'dash', shield = variant === 'shield';
  const move = dash
    ? { startup: 7, active: 3, recovery: 22, grabReach: 76, grabHeight: 48 }
    : { startup: shield ? 9 : 5, active: 3, recovery: 17, grabReach: 58, grabHeight: 48 };
  player.action = { name: 'grab', frame: 0, move, hit: [], variant };
  player.movementState = 'action';
  player.dashFrames = 0;
  player.dashAge = 0;
  player.dashBrakeFrames = 0;
  player.actionName = 'grab';
  player.parryFrames = 0; player.shieldHoldFrames = 0; player.shieldReleaseQueued = false; player.tumbling = false; player.techWindow = 0; player.knockdownFrames = 0;
  emit(world, 'action', { player: player.i, action: 'grab', variant });
}

function resolveGrab(world, player) {
  if (player.grabbing != null) return;
  const hitbox = grabHitbox(player);
  const target = world.players
    .filter(other => other.i !== player.i && !other.eliminated && other.respawn <= 0 && !hasInvincibility(other) && other.grabbedBy == null && (other.grabImmunity || 0) <= 0
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
  player.invincible = Math.max(player.invincible, releaseFrame + recovery);
}

function throwTarget(world, player) {
  const target = world.players.find(other => other.i === player.grabbing);
  const queued = player.pendingThrow;
  if (!target || !queued) { player.grabbing = null; player.pendingThrow = null; return; }
  const { up, down, back, name } = queued;
  const direction = back ? -player.face : player.face;
  const move = back
    ? { name, damage: 10, kx: 390, ky: 175, knockbackGrowth: 1.08, hitstop: 7 }
    : up
      ? { name, damage: 9, kx: 135, ky: 400, knockbackGrowth: .96, hitstop: 6 }
      : down
        ? { name, damage: 6, kx: 90, ky: 170, knockbackGrowth: .48, hitstun: 18, hitstop: 5 }
        : { name, damage: 7, kx: 240, ky: 135, knockbackGrowth: .72, hitstop: 5 };
  target.grabImmunity = Math.max(target.grabImmunity || 0, REGRAB_LOCK_FRAMES);
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
  if (hasInvincibility(target) || target.eliminated || target.respawn > 0) return false;
  if (world.rules.teams && !world.rules.friendlyFire && attacker.team === target.team) return false;
  const interruptedFreefall = !!target.freefall;
  const crouchKnockbackMultiplier = target.grounded && ['crouch', 'crawl'].includes(target.actionName) ? .85 : 1;
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
    attacker.hitstop = Math.max(attacker.hitstop || 0, PARRY_ATTACKER_FREEZE_FRAMES);
    target.hitstop = Math.max(target.hitstop || 0, 3);
    target.parryFrames = 0; target.shielding = false; target.shieldBuffer = 0;
    target.shieldDropLag = 0; target.invincible = Math.max(target.invincible || 0, PARRY_INVINCIBLE_FRAMES);
    target.actionName = 'parrySuccess';
    emit(world, 'parry', {
      player: target.i, attacker: attacker.i,
      x: move.contactX ?? target.x + direction * target.width * .45,
      y: move.contactY ?? target.y
    });
    return true;
  }
  const moveName = move.staleKey || move.name || move.kind || move.projectile || 'environment';
  const ultimateHit = String(moveName).startsWith('ultimate');
  const stale = staleMultiplier(attacker, moveName);
  const shortHopMultiplier = move.shortHop ? 0.85 : 1;
  if (target.shielding && !move.shieldPoke) {
    const shieldDamage = move.damage * stale * shortHopMultiplier * Math.max(0, move.shieldDamageMultiplier ?? 1);
    target.shield = Math.max(0, target.shield - shieldDamage * 1.19);
    target.shieldStun = Math.max(target.shieldStun || 0, Math.floor(shieldDamage * 0.8 * (move.name?.startsWith('air') || move.projectile ? 0.8 : 1) + 2));
    const shieldPush = Math.min(145, (target.shieldStun + 1) * 9.9);
    target.vx = direction * shieldPush; attacker.vx -= direction * Math.min(170, 18 + shieldDamage * 6);
    target.hitstop = Math.max(3, move.hitstop - 2); attacker.hitstop = 3;
    if (target.shield <= 0) {
      target.shield = SHIELD_MAX * .25; target.shielding = false; target.stun = 87; target.dizzyFrames = 87;
      target.shieldLock = 120; target.shieldHoldFrames = 0; target.shieldReleaseQueued = false;
      emit(world, 'shield-break', {
        player: target.i,
        x: target.x + (target.shieldOffsetX || 0),
        y: target.y + (target.shieldOffsetY || 0),
        radius: Math.max(target.width * .9 + 15, target.height * .75 + 12),
        color: colorOf(target)
      });
    }
    else emit(world, 'shield-hit', {
      player: target.i, attacker: attacker.i, ultimate: ultimateHit,
      x: move.contactX ?? target.x, y: move.contactY ?? target.y,
      color: colorOf(attacker)
    });
    recordStale(attacker, moveName); target.hitId += 1; return true;
  }
  if (target.comboTimer <= 0 || target.comboAttacker !== attacker.i) {
    target.comboCount = 0;
    target.comboAttacker = attacker.i;
  }
  const comboMultiplier = Math.max(.65, 1 - target.comboCount * .06);
  const activeFighterCount = world.players.filter(player => !player.eliminated && !player.respawn).length;
  const crowdFight = activeFighterCount >= 3;
  const oneOnOneMultiplier = world.oneOnOneDamage ? 1.2 : 1;
  const crowdDamageMultiplier = crowdFight ? move.crowdDamageScale ?? 1 : 1;
  const damage = move.damage * stale * shortHopMultiplier * comboMultiplier * oneOnOneMultiplier * crowdDamageMultiplier;
  if (move.noFlinch) {
    target.damage += damage;
    target.comboCount += 1; target.comboTimer = 90; target.comboAttacker = attacker.i; recordStale(attacker, moveName);
    if (!ultimateHit && attacker.i >= 0) attacker.ultimateMeter = clamp((attacker.ultimateMeter || 0) + damage * 1.15, 0, ULTIMATE_READY);
    target.ultimateMeter = clamp((target.ultimateMeter || 0) + damage * .72, 0, ULTIMATE_READY);
    const hitlag = Math.max(0, Number(move.hitstop) || 0);
    attacker.hitstop = Math.max(attacker.hitstop || 0, Math.min(2, hitlag));
    target.hitstop = Math.max(target.hitstop || 0, Math.min(2, hitlag));
    target.lastDamager = attacker.i; target.hitId += 1;
    emit(world, 'hit', {
      attacker: attacker.i, player: target.i, damage, targetDamage: target.damage,
      comboCount: target.comboCount, comboMultiplier, x: move.contactX ?? target.x, y: move.contactY ?? target.y,
      power: hitlag, launchSpeed: 0, launchAngle: 0, critical: false, finisherFlight: false,
      ultimate: ultimateHit, move: moveName, quality: 'noFlinch', color: colorOf(attacker)
    });
    return true;
  }
  const knockbackGrowth = Math.max(0, Number(move.knockbackGrowth ?? 1));
  // Ultimate knockback uses the defender's percent after this hit is applied.
  // Including the current hit makes a strong move at 0% launch slightly farther
  // than a weak move that leaves the defender at the same pre-hit percent.
  const projectedDamage = target.damage + damage;
  const targetDefinition = characterOf(target);
  const crowdWeight = crowdFight ? targetDefinition.crowdWeight ?? 1 : 1;
  const scale = (1 + projectedDamage / 85 * knockbackGrowth) / (targetDefinition.weight * crowdWeight);
  const launchGrowth = !move.groundedFlinch && knockbackGrowth >= .65
    ? 1 + clamp((target.damage - 70) / 110, 0, 1) * .28
    : 1;
  const rage = 1 + clamp(((attacker.damage || 0) - 35) / 115, 0, 1) * 0.1;
  const armorAction = target.action;
  const armorStartup = armorAction ? armorAction.startup ?? armorAction.move.startup : 0;
  const armorType = armorAction?.move?.armorType
    || (armorAction?.move?.armorThreshold != null ? 'heavy' : armorAction?.move?.armor ? 'super' : null);
  const armorThreshold = Number(crowdFight
    ? armorAction?.move?.crowdArmorThreshold ?? armorAction?.move?.armorThreshold ?? 0
    : armorAction?.move?.armorThreshold ?? 0);
  const armorStartupFrames = Number(crowdFight
    ? armorAction?.move?.crowdArmorStartupFrames ?? armorAction?.move?.armorStartupFrames ?? 0
    : armorAction?.move?.armorStartupFrames ?? 0);
  const armorStart = Math.max(0, armorStartup - armorStartupFrames);
  const ultimateArmor = armorAction?.name === 'ultimate'
    && armorAction.frame < armorStartup + armorAction.move.active;
  const armored = ultimateArmor || !!armorType
    && armorAction.frame >= armorStart
    && armorAction.frame < armorStartup + armorAction.move.active
    && (armorType === 'super' || armorType === 'heavy' && damage <= armorThreshold);
  if (!armored) {
    if (target.action?.name === 'ultimate') {
      for (const entity of world.entities) {
        if (entity.owner === target.i && entity.type === 'ultimate' && entity.arm > 0) entity.life = 0;
      }
      emit(world, 'ultimate-cancel', { player: target.i, attacker: attacker.i });
    }
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
    target.action = null; target.charge = null; target.shielding = false; target.actionName = 'hit'; target.ledge = null; target.ledgeTransition = null; target.ledgeTransitionFrames = 0; target.ledgeTransitionTotal = 0; target.ledgeJumpRefreshPending = false; target.freefall = false;
    target.dizzyFrames = 0;
    target.knockdownFrames = 0; target.techWindow = 0; target.tumbleRecoverFrames = 0;
    target.canLedgeInvincible = true; target.ledgeGrabs = 0;
    target.ledgeGrabLockFrames = Math.max(target.ledgeGrabLockFrames || 0, 55);
  }
  target.damage += damage;
  target.comboCount += 1; target.comboTimer = 90; target.comboAttacker = attacker.i; recordStale(attacker, moveName);
  if (!ultimateHit && attacker.i >= 0) attacker.ultimateMeter = clamp((attacker.ultimateMeter || 0) + damage * 1.15, 0, ULTIMATE_READY);
  target.ultimateMeter = clamp((target.ultimateMeter || 0) + damage * 0.72, 0, ULTIMATE_READY);
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
  let launchX = direction * (move.fixedKx ?? move.kx) * scale * rage * launchGrowth * crouchKnockbackMultiplier;
  let launchY = (move.meteor ? Math.abs(move.fixedKy ?? move.ky) * scale : -Math.abs(move.fixedKy ?? move.ky) * Math.min(scale, 2.2)) * rage * launchGrowth * crouchKnockbackMultiplier;
  if (requestedGroundedFlinch && !groundedFlinch) {
    const escapePush = 150 + Math.min(3, target.comboCount - 3) * 22;
    launchX = direction * Math.max(Math.abs(launchX) * 1.35, escapePush);
    launchY = -Math.max(Math.abs(launchY), 125);
  }
  const launch = groundedFlinch ? { vx: launchX, vy: 0 } : applyDirectionalInfluence(launchX, launchY, target.lastInput);
  const armoredVx = target.vx, armoredVy = target.vy;
  const armoredGrounded = target.grounded, armoredPlatformId = target.platformId;
  target.vx = launch.vx; target.vy = launch.vy; target.canSdi = !armored; target.sdiCooldown = 1; target.lastSdiHorizontal = 0; target.lastSdiVertical = 0;
  const uncappedLaunchSpeed = Math.hypot(target.vx, target.vy);
  if (uncappedLaunchSpeed > 1120) {
    const cap = 1120 / uncappedLaunchSpeed;
    target.vx *= cap;
    target.vy *= cap;
  }
  if (armored) {
    target.vx = armoredVx; target.vy = armoredVy;
    target.grounded = armoredGrounded; target.platformId = armoredPlatformId;
  }
  const launchSpeed = armored ? 0 : Math.hypot(target.vx, target.vy);
  const critical = !armored && (launchSpeed >= 720 || (target.damage >= 110 && launchSpeed >= 560));
  const finisherFlight = !armored && !groundedFlinch && target.damage >= 110 && launchSpeed >= 620;
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
  if (!armored) target.grounded = groundedFlinch;
  target.hitId += 1;
  if (!armored) {
    target.tumbling = !groundedFlinch;
    if (interruptedFreefall && !groundedFlinch) {
      target.recoveryAvailable = true;
      target.jumps = 0;
    }
  }
  emit(world, 'hit', { attacker: attacker.i, player: target.i, damage, targetDamage: target.damage, comboCount: target.comboCount, comboMultiplier, x: move.contactX ?? target.x, y: move.contactY ?? target.y, power: move.hitstop, launchSpeed, launchAngle: Math.atan2(target.vy, target.vx), critical, finisherFlight, ultimate: ultimateHit, move: moveName, quality: move.sweet ? 'sweet' : 'normal', color: colorOf(attacker) });
  return true;
}

function basePlayerHurtboxes(player) {
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
  const crouched = player.actionName === 'crouch' || player.actionName === 'crawl' || player.actionName === 'landing' || player.actionName === 'groundHit';
  const compressed = crouched ? .7 : 1;
  const centerY = player.y + (crouched ? player.height * .16 : 0);
  return [
    { part: 'head', x: player.x, y: centerY - player.height * .3 * compressed, radius: Math.max(10, player.width * .22) },
    { part: 'body', x: player.x, y: centerY - player.height * .02, radius: Math.max(11, player.width * .28) },
    { part: 'legs', x: player.x, y: centerY + player.height * .28 * compressed, radius: Math.max(10, player.width * .23) }
  ];
}

function playerHurtboxes(player) {
  if (!player.shielding) return basePlayerHurtboxes(player);
  const shieldScale = .58 + .42 * clamp(player.shield / SHIELD_MAX, 0, 1);
  const visualRadius = Math.max(player.width * .9 + 15, player.height * .75 + 12);
  return [{
    part: 'shield',
    x: player.x + (player.shieldOffsetX || 0),
    y: player.y + (player.shieldOffsetY || 0),
    radius: visualRadius * shieldScale
  }, ...basePlayerHurtboxes(player)];
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
  const width = player.action?.move?.grabReach || 58;
  const height = player.action?.move?.grabHeight || 48;
  return { type: 'box', x: player.x + player.face * width / 2, y: player.y, w: width, h: height, grab: true };
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

function resolveMoveHits(world, player, action = player.action) {
  if (!action) return;
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
    const contactData = contact ? {
      contactX: contact.x,
      contactY: contact.y,
      shieldPoke: target.shielding && touchedHurtbox.part !== 'shield'
    } : {};
    const resolvedMove = sweet
      ? { ...move, ...contactData, damage: move.damage * 1.12, kx: move.kx * 1.15, ky: move.ky * 1.15, hitstop: Math.min(10, move.hitstop + 1), sweet: true }
      : { ...move, ...contactData };
    if (overlaps && facing && hitPlayer(world, player, target, resolvedMove, move.radial ? Math.sign(target.x - player.x || attackFace) : attackFace)) action.hit.push(target.i);
  }
}

function resolvePendingMoveHits(world) {
  const pending = world.pendingMoveHits || [];
  world.pendingMoveHits = [];
  for (const entry of pending) resolveMoveHits(world, entry.player, entry.action);
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
  return { type: 'box', x: player.x + direction * (near + far) / 2, y: player.y + (move.hitboxShiftY || 0), w: far - near, h: move.reachY * .82 };
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

function processAction(world, player, input, previous) {
  if (!player.action) return;
  const action = player.action;
  const { move } = action;
  const startup = action.startup ?? move.startup;
  if (action.name.startsWith('special') && !action.activated && action.frame < Math.min(startup, SPECIAL_TURNAROUND_FRAMES)) {
    const direction = freshHorizontalDirection(input, previous);
    if (direction && direction !== player.face) {
      player.face = direction;
      action.inputHorizontal = direction;
      action.specialTurnaround = 'direction';
      emit(world, 'special-turnaround', { player: player.i, action: action.name, kind: 'direction', direction });
    }
  }
  if (move.chargeable && !action.charged) {
    const chargeButton = action.chargeButton || (action.name.startsWith('special') ? BUTTONS.SPECIAL : BUTTONS.ATTACK);
    const maxHoldFrames = move.maxChargeFrames || SMASH_MAX_HOLD_FRAMES;
    const minHoldFrames = move.minChargeFrames || SMASH_HOLD_FRAMES;
    const held = bit(input.buttons, chargeButton);
    if (held) action.holdFrames = Math.min(maxHoldFrames, action.holdFrames + 1);
    if (action.frame >= startup - 1 && held && action.holdFrames < maxHoldFrames) {
      action.charging = action.variant === 'smash' || move.distanceCharge || action.holdFrames >= 10;
      player.vx *= player.grounded ? .7 : .96;
      if (move.distanceCharge) previewDistanceCharge(world, player, action, maxHoldFrames);
      return;
    }
    if (!held || action.holdFrames >= maxHoldFrames) {
      if (action.charging || action.holdFrames >= maxHoldFrames) {
      const chargeProgress = move.distanceCharge && action.previewWarp
        ? clamp(Number(action.chargeProgress) || 0, 0, 1)
        : clamp(
          (Math.max(minHoldFrames, action.holdFrames) - minHoldFrames)
            / Math.max(1, maxHoldFrames - minHoldFrames),
          0,
          1
        );
      const maxDamageScale = move.chargeDamageScale || SMASH_MAX_DAMAGE_SCALE;
      const scale = 1 + chargeProgress * (maxDamageScale - 1);
      const knockbackScale = 1 + (scale - 1) * .625;
      move.damage *= scale; move.kx *= knockbackScale; move.ky *= knockbackScale;
      action.chargeProgress = chargeProgress;
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
  else if (active && !move.projectileOnly && !move.trapOnly && !move.defensiveOnly) {
    (world.pendingMoveHits ||= []).push({ player, action });
  }
  const totalFrames = startup + move.active + move.recovery;
  const cancelIntent = !!player.actionBuffer || player.jumpBuffer > 0
    || (player.shieldBuffer > 0 && bit(input.buttons, BUTTONS.SHIELD));
  const interruptible = action.name !== 'grab' && cancelIntent && move.cancelWindow > 0
    && action.frame >= totalFrames - move.cancelWindow;
  if (action.frame >= totalFrames || interruptible) {
    if (move.jab && move.jab < 3) { player.jabStep = move.jab; player.jabTimer = JAB_CHAIN_WINDOW_FRAMES; }
    else if (move.jab === 3) { player.jabStep = 0; player.jabTimer = 0; }
    player.pendingLandingLag = 0;
    const entersFreefall = action.name === 'specialUp' && !player.grounded && move.causesFreefall !== false;
    player.action = null;
    player.freefall = entersFreefall;
    player.actionName = player.grounded ? 'idle' : entersFreefall ? 'freefall' : 'fall';
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

function resolveGroundBodyCollision(player, oldX, oldY, platforms) {
  const halfW = player.width / 2, halfH = player.height / 2;
  for (const platform of platforms) {
    if (!platform.ground) continue;
    const bottom = platform.y + (platform.groundDepth || 320);
    const verticalOverlap = player.y + halfH > platform.y + 2 && player.y - halfH < bottom;
    const horizontalOverlap = player.x + halfW > platform.x && player.x - halfW < platform.x + platform.w;
    if (!verticalOverlap || !horizontalOverlap) continue;

    const ledgeVertical = player.y >= platform.y - Math.min(18, player.height * .22) && player.y < platform.y + 36;
    const ledgeApproachReach = Math.max(24, halfW + 8);
    const approachingLedge = ledgeVertical && (
      Math.abs(player.x - platform.x) < ledgeApproachReach
      || Math.abs(player.x - (platform.x + platform.w)) < ledgeApproachReach
    );
    const recoveryCanSnap = player.action?.name === 'specialUp' || player.action?.move?.recoveryMove;
    const canSnapAtLedge = !player.grounded && !player.ledge && player.coyoteFrames <= 0
      && player.grabbedBy == null && player.ledgeGrabs < 6 && player.ledgeGrabLockFrames <= 0
      && player.stun <= 0 && (!player.action || recoveryCanSnap);
    if (approachingLedge && canSnapAtLedge) continue;

    const enteredFromLeft = oldX + halfW <= platform.x + 1;
    const enteredFromRight = oldX - halfW >= platform.x + platform.w - 1;
    if (enteredFromLeft) {
      player.x = platform.x - halfW;
      player.vx = Math.min(0, player.vx);
      return platform;
    }
    if (enteredFromRight) {
      player.x = platform.x + platform.w + halfW;
      player.vx = Math.max(0, player.vx);
      return platform;
    }

    // Reject an upward pass through the floor top without teleporting actors
    // that were already placed inside the body by training/debug scenarios.
    const bodyTop = platform.y + 8;
    const crossedTopFromBelow = oldY - halfH >= bodyTop && player.y - halfH < bodyTop;
    if (crossedTopFromBelow) {
      player.y = bodyTop + halfH;
      player.vy = Math.max(0, player.vy);
      return platform;
    }

    // A teleport, dodge, or high-speed action can begin a tick already inside
    // the solid body. Eject it through the nearest face so it cannot continue
    // falling through the deck on subsequent ticks.
    const faces = [
      { side: 'top', distance: player.y + halfH - platform.y },
      { side: 'left', distance: player.x + halfW - platform.x },
      { side: 'right', distance: platform.x + platform.w - (player.x - halfW) },
      { side: 'bottom', distance: bottom - (player.y - halfH) }
    ].filter(face => face.distance >= 0).sort((first, second) => first.distance - second.distance);
    const nearest = faces[0]?.side;
    if (nearest === 'top') {
      player.y = platform.y - halfH;
      player.vy = Math.min(0, player.vy);
    } else if (nearest === 'left') {
      player.x = platform.x - halfW;
      player.vx = Math.min(0, player.vx);
    } else if (nearest === 'right') {
      player.x = platform.x + platform.w + halfW;
      player.vx = Math.max(0, player.vx);
    } else if (nearest === 'bottom') {
      player.y = bottom + halfH;
      player.vy = Math.max(0, player.vy);
    }
    if (nearest) return platform;
  }
  return null;
}

function performDodge(player, name, baseFrames, baseInvincible, vx = 0, vy = null, options = {}) {
  const fatigue = Math.floor(player.dodgeFatigue || 0);
  const initialVx = player.vx, initialVy = player.vy;
  player.dodgeFrames = baseFrames + fatigue * 3;
  player.dodgeTotalFrames = player.dodgeFrames;
  player.dodgeElapsed = 0;
  player.dodgeSerial = (player.dodgeSerial || 0) + 1;
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
  player.actionName = name; player.shielding = false; player.parryFrames = 0; player.shieldHoldFrames = 0; player.shieldReleaseQueued = false;
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
  else performDodge(player, 'airDodge', 44, 16, dodgeX * 430, dodgeY * 396, { windupFrames: 2 });
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
  if (pressed(input, previous, BUTTONS.ATTACK) || bit(input.buttons, BUTTONS.ATTACK)
    || pressed(input, previous, BUTTONS.SPECIAL) || bit(input.buttons, BUTTONS.SPECIAL)) {
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
  const recoveryCanSnap = player.action?.name === 'specialUp' || player.action?.move?.recoveryMove;
  if (player.grounded || player.ledge || player.coyoteFrames > 0 || player.grabbedBy != null
    || player.ledgeGrabs >= 6 || player.ledgeGrabLockFrames > 0 || player.stun > 0
    || player.action && !recoveryCanSnap) return false;
  for (const platform of world.platforms.filter(item => !item.passThrough)) {
    const ledges = [{ x: platform.x, face: 1 }, { x: platform.x + platform.w, face: -1 }];
    for (const ledge of ledges) {
      const belowTop = player.y >= platform.y - Math.min(18, player.height * .22);
      if (Math.abs(player.x - ledge.x) < 24 && belowTop && player.y < platform.y + 36) {
        const holder = world.players.find(other => other.i !== player.i && other.ledge
          && other.ledge.platformId === platform.id && Math.abs(other.ledge.x - ledge.x) < 2);
        if (holder) {
          holder.ledge = null; holder.ledgeInvincible = 0; holder.invincible = 0;
          holder.ledgeHangFrames = 0;
          holder.vx = -ledge.face * 165; holder.vy = 75; holder.canLedgeInvincible = false;
          holder.ledgeJumpRefreshPending = false; holder.actionName = 'ledgeTrumped';
          emit(world, 'ledge-trump', { player: player.i, target: holder.i, x: ledge.x, y: platform.y });
        }
        player.ledge = { platformId: platform.id, x: ledge.x, y: platform.y, face: ledge.face };
        player.x = ledge.x - ledge.face * 16; player.y = platform.y + 20; player.vx = 0; player.vy = 0; player.criticalFlightFrames = 0;
        player.face = ledge.face; player.actionName = 'ledgeCatch'; player.tumbling = false; player.freefall = false; player.techWindow = 0; player.ledgeCatchFrames = 2;
        player.ledgeHangFrames = 0;
        player.ledgeJumpRefreshPending = player.jumps <= 0;
        player.airDodgeAvailable = true; player.recoveryAvailable = true; player.fastFalling = false;
        player.ledgeGrabs += 1;
        if (player.canLedgeInvincible) player.ledgeInvincible = Math.max(12, 31 - player.ledgeGrabs * 2);
        else player.ledgeInvincible = 0;
        player.invincible = 0;
        emit(world, 'ledge', { player: player.i }); return true;
      }
    }
  }
  return false;
}

function ledgeStandPosition(player, platform, ledgeX, face, offset) {
  return {
    x: clamp(ledgeX + face * offset, platform.x + player.width / 2, platform.x + platform.w - player.width / 2),
    y: platform.y - player.height / 2
  };
}

function beginLedgeTransition(player, platform, type, frames, offset, invincibleFrames) {
  if (!player.ledge || !platform) return false;
  const ledgeX = player.ledge.x, face = player.ledge.face;
  const destination = type === 'jump'
    ? {
        x: ledgeX + face * Math.max(30, player.width * .62),
        y: platform.y - player.height / 2 - 6
      }
    : ledgeStandPosition(player, platform, ledgeX, face, offset);
  player.ledgeTransition = {
    type, platformId: platform.id, ledgeX, face,
    startX: player.x, startY: player.y,
    endX: destination.x, endY: destination.y
  };
  player.ledgeTransitionFrames = frames;
  player.ledgeTransitionTotal = frames;
  player.ledge = null;
  player.ledgeHangFrames = 0;
  player.ledgeJumpRefreshPending = false;
  player.ledgeInvincible = 0;
  player.actionBuffer = null; player.jumpBuffer = 0; player.shieldBuffer = 0;
  player.invincible = Math.max(0, invincibleFrames);
  player.vx = 0; player.vy = 0;
  player.grounded = false; player.platformId = null;
  player.canLedgeInvincible = false;
  player.actionName = type === 'getup' ? 'ledgeGetup'
    : type === 'attack' ? 'ledgeAttackClimb'
      : type === 'roll' ? 'ledgeRollClimb' : 'ledgeJumpClimb';
  return true;
}

function processLedgeTransition(world, player) {
  const transition = player.ledgeTransition;
  if (!transition || player.ledgeTransitionFrames <= 0) return false;
  const platform = world.platforms.find(item => item.id === transition.platformId);
  if (!platform) {
    player.ledgeTransition = null; player.ledgeTransitionFrames = 0; player.ledgeTransitionTotal = 0;
    player.actionName = 'fall';
    return false;
  }
  player.invincible = Math.max(0, player.invincible - 1);
  player.ledgeTransitionFrames -= 1;
  const progress = 1 - player.ledgeTransitionFrames / Math.max(1, player.ledgeTransitionTotal);
  const eased = progress * progress * (3 - 2 * progress);
  player.x = transition.startX + (transition.endX - transition.startX) * eased;
  player.y = transition.startY + (transition.endY - transition.startY) * eased;
  player.vx = 0; player.vy = 0;
  player.actionName = transition.type === 'getup' ? 'ledgeGetup'
    : transition.type === 'attack' ? 'ledgeAttackClimb'
      : transition.type === 'roll' ? 'ledgeRollClimb' : 'ledgeJumpClimb';
  if (player.ledgeTransitionFrames > 0) return true;

  player.x = transition.endX; player.y = transition.endY;
  player.ledgeTransition = null; player.ledgeTransitionTotal = 0;
  if (transition.type === 'jump') {
    player.ledgeGrabLockFrames = Math.max(player.ledgeGrabLockFrames || 0, 24);
    player.vx = transition.face * 150;
    player.vy = -430;
    player.jumps = Math.max(1, player.jumps);
    player.actionName = 'ledgeJump';
    return true;
  }

  player.grounded = true; player.platformId = platform.id; player.vy = 0;
  player.canLedgeInvincible = true; player.ledgeGrabs = 0;
  if (transition.type === 'attack') {
    player.invincible = 0;
    startMove(world, player, 'groundNeutral');
  } else if (transition.type === 'roll') {
    player.invincible = 0;
    performDodge(player, 'ledgeRoll', 18, 10, transition.face * 420);
  } else {
    player.actionName = 'ledgeGetup';
  }
  return true;
}

function processLedge(world, player, input, previous) {
  if (!player.ledge) return false;
  if (player.ledgeCatchFrames > 0) {
    player.invincible = 0;
    player.actionName = 'ledgeCatch';
    return true;
  }
  if (player.ledgeJumpRefreshPending) {
    player.jumps = Math.max(1, player.jumps);
    player.ledgeJumpRefreshPending = false;
  }
  player.ledgeHangFrames = (player.ledgeHangFrames || 0) + 1;
  if (player.ledgeHangFrames >= LEDGE_HANG_MAX_FRAMES) {
    player.ledge = null;
    player.ledgeHangFrames = 0;
    player.ledgeJumpRefreshPending = false;
    player.ledgeInvincible = 0;
    player.invincible = 0;
    player.vx = -player.face * 45;
    player.vy = 105;
    player.fastFalling = false;
    player.canLedgeInvincible = false;
    player.ledgeGrabLockFrames = Math.max(player.ledgeGrabLockFrames || 0, 45);
    player.actionName = 'fall';
    emit(world, 'ledge-timeout', { player: player.i });
    return true;
  }
  player.ledgeInvincible = Math.max(0, player.ledgeInvincible - 1);
  player.invincible = Math.max(player.invincible, player.ledgeInvincible);
  const inward = input.horizontal * player.ledge.face > 0.35;
  const outward = input.horizontal * player.ledge.face < -0.35;
  const inwardPressed = inward && previous.horizontal * player.ledge.face <= .35;
  const outwardPressed = outward && previous.horizontal * player.ledge.face >= -.35;
  const platform = world.platforms.find(item => item.id === player.ledge.platformId);
  if (pressed(input, previous, BUTTONS.UP)) {
    beginLedgeTransition(player, platform, 'jump', 6, 18, 6);
  } else if (pressed(input, previous, BUTTONS.ATTACK) || pressed(input, previous, BUTTONS.SPECIAL)) {
    beginLedgeTransition(player, platform, 'attack', 8, 38, 8);
  } else if (pressed(input, previous, BUTTONS.SHIELD) || pressed(input, previous, BUTTONS.GRAB)) {
    beginLedgeTransition(player, platform, 'roll', 9, 38, 9);
  } else if (inwardPressed) {
    beginLedgeTransition(player, platform, 'getup', 10, 38, 8);
  } else if (pressed(input, previous, BUTTONS.DOWN) || outwardPressed) {
    const fastDrop = pressed(input, previous, BUTTONS.DOWN);
    player.ledge = null; player.ledgeHangFrames = 0; player.ledgeJumpRefreshPending = false; player.ledgeInvincible = 0; player.invincible = 0; player.vy = fastDrop ? 260 : 80; player.fastFalling = fastDrop; player.canLedgeInvincible = false;
    player.actionName = fastDrop ? 'fastFall' : 'fall';
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
    player.shield = Math.min(SHIELD_MAX, player.shield + item.amount);
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
  const specialFlickDirection = freshHorizontalDirection(input, previous);
  if (specialFlickDirection) {
    player.specialFlickDirection = specialFlickDirection;
    player.specialFlickFrames = SPECIAL_TURNAROUND_FRAMES;
    player.specialFlickFacing = player.face;
  } else player.specialFlickFrames = Math.max(0, (player.specialFlickFrames || 0) - 1);
  player.ackSeq = Math.max(player.ackSeq, input.seq);
  player.projectileCooldown = Math.max(0, (player.projectileCooldown || 0) - 1);
  player.grabImmunity = Math.max(0, (player.grabImmunity || 0) - 1);
  player.ledgeGrabLockFrames = Math.max(0, (player.ledgeGrabLockFrames || 0) - 1);
  const character = characterOf(player);
  if (player.grounded && player.platformId) {
    const platform = world.platforms.find(item => item.id === player.platformId);
    if (platform) player.x += platform.deltaX || 0;
  }

  if (player.eliminated) { player.lastInput = input; return; }
  if (player.respawn > 0) {
    player.respawn -= 1;
    if (player.respawn === 0) {
      resetPlayerState(world, player, { x: 640, y: 132, invincible: 120 });
      player.shield = SHIELD_MAX;
      player.respawnPlatformFrames = 120;
      player.grounded = true;
      player.actionName = 'respawn';
    }
    player.lastInput = input; return;
  }
  if (player.respawnPlatformFrames > 0) {
    const leavePlatform = input.buttons !== 0 || Math.abs(input.horizontal) > .25 || Math.abs(input.vertical) > .25;
    player.respawnPlatformFrames = Math.max(0, player.respawnPlatformFrames - 1);
    player.invincible = player.respawnPlatformFrames;
    player.vx = 0; player.vy = 0; player.grounded = true; player.platformId = null;
    player.y = 132 + (120 - player.respawnPlatformFrames) * .08;
    player.actionName = 'respawn';
    if (leavePlatform || player.respawnPlatformFrames === 0) {
      player.respawnPlatformFrames = 0;
      player.grounded = false;
      player.vy = 45;
      player.actionName = 'fall';
    }
    player.lastInput = input;
    return;
  }
  bufferActionInput(player, input, previous);
  if (player.freefall) {
    player.actionBuffer = null;
    player.jumpBuffer = 0;
    player.shieldBuffer = 0;
  }
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
    } else if ((pressed(input, previous, BUTTONS.ATTACK) || pressed(input, previous, BUTTONS.GRAB)) && player.grabPummelCooldown === 0) {
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
  if (processLedgeTransition(world, player)) { player.lastInput = input; return; }

  const wasStunned = player.stun > 0;
  player.invincible = Math.max(0, player.invincible - 1);
  player.parryFrames = Math.max(0, player.parryFrames - 1);
  if (player.dizzyFrames > 0 && player.stun > 0) {
    const buttonMash = ((input.buttons ^ previous.buttons) & 255).toString(2).replace(/0/g, '').length;
    const axisMash = (Math.abs(input.horizontal - (player.lastMashHorizontal || 0)) > .65 ? 1 : 0)
      + (Math.abs(input.vertical - (player.lastMashVertical || 0)) > .65 ? 1 : 0);
    const mash = buttonMash + axisMash;
    if (mash > 0) {
      const reduction = mash * 2;
      player.stun = Math.max(0, player.stun - reduction);
      player.dizzyFrames = Math.max(0, player.dizzyFrames - reduction);
      emit(world, 'stun-mash', { player: player.i, reduction });
    }
    player.lastMashButtons = input.buttons;
    player.lastMashHorizontal = input.horizontal;
    player.lastMashVertical = input.vertical;
  }
  player.stun = Math.max(0, player.stun - 1);
  player.dizzyFrames = Math.min(player.stun, Math.max(0, (player.dizzyFrames || 0) - 1));
  if (wasStunned && player.stun === 0 && !player.grounded && player.tumbling) {
    player.tumbleRecoverFrames = 8;
    player.actionName = 'airRecover';
  } else if (player.tumbleRecoverFrames > 0) {
    player.tumbleRecoverFrames -= 1;
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
  player.fastFallFlashFrames = Math.max(0, (player.fastFallFlashFrames || 0) - 1);
  player.footstoolCooldown = Math.max(0, (player.footstoolCooldown || 0) - 1);
  player.dodgeFatigueCooldown = Math.max(0, (player.dodgeFatigueCooldown || 0) - 1);
  if (player.dashFrames > 0) {
    player.dashFrames -= 1;
    player.dashAge = Math.min(DASH_DURATION_FRAMES, (player.dashAge || 0) + 1);
  } else player.dashAge = 0;
  if (player.dodgeFatigueCooldown === 0) player.dodgeFatigue = Math.max(0, (player.dodgeFatigue || 0) - 0.012);
  player.coyoteFrames = player.grounded ? 6 : Math.max(0, player.coyoteFrames - 1);
  if (!player.grounded && player.coyoteFrames === 0 && player.jumps === 2 && !player.ledge) player.jumps = 1;
  if (player.jumpSquatFrames > 0) { processJumpSquat(world, player, input, previous); player.lastInput = input; return; }
  if (processKnockdown(world, player, input, previous)) { player.lastInput = input; return; }
  if (player.action) processAction(world, player, input, previous);
  const spotCancel = player.actionName === 'spotDodge' && player.dodgeFrames > 0 && player.dodgeFrames <= 5
    && (player.actionBuffer?.type === 'attack' || player.actionBuffer?.type === 'special');
  if (spotCancel) player.dodgeFrames = 0;
  const locked = player.stun > 0 || player.freefall || player.dodgeFrames > 0 || player.landingLag > 0 || player.shieldStun > 0 || player.shieldDropLag > 0 || player.action;

  if (!locked && player.shieldBuffer > 0 && bit(input.buttons, BUTTONS.SHIELD)) {
    player.shieldBuffer = 0;
    if (!player.grounded && player.airDodgeAvailable) {
      performAirDodge(player, input);
    } else if (player.grounded && input.vertical > 0.4) {
      performDodge(player, 'spotDodge', 24, 14, 0);
    } else if (player.grounded && Math.abs(input.horizontal) > 0.4) {
      performDodge(player, 'roll', 22, 16, input.horizontal * 600 * character.speed);
    } else if (player.grounded && player.shieldLock === 0) {
      player.shielding = true; player.shieldHoldFrames = 1; player.shieldReleaseQueued = false; player.actionName = 'shield';
    }
  }
  if (player.shielding) {
    player.shieldHoldFrames = Math.min(999, (player.shieldHoldFrames || 0) + 1);
    const shieldShift = bit(input.buttons, BUTTONS.SPECIAL) && !pressed(input, previous, BUTTONS.SPECIAL);
    const shieldSpotDodge = !shieldShift && player.grounded && pressed(input, previous, BUTTONS.DOWN);
    const shieldRoll = !shieldShift && player.grounded && Math.abs(input.horizontal) > 0.4 && (pressed(input, previous, BUTTONS.LEFT) || pressed(input, previous, BUTTONS.RIGHT));
    if (player.shieldStun > 0) { player.actionName = 'shieldHit'; player.vx *= .92; }
    else if (shieldSpotDodge) performDodge(player, 'spotDodge', 24, 14, 0);
    else if (shieldRoll) performDodge(player, 'roll', 22, 16, input.horizontal * 600 * character.speed);
    else if ((!bit(input.buttons, BUTTONS.SHIELD) && player.shieldHoldFrames >= 3) || !player.grounded || player.shieldLock > 0) {
      player.shielding = false;
      player.shieldHoldFrames = 0; player.shieldReleaseQueued = false;
      player.shieldDropLag = Math.max(player.shieldDropLag, 11);
    }
    else {
      player.shield = Math.max(0, player.shield - 0.06);
      player.vx *= 0.82;
      if (player.shield <= 0) {
        player.shield = SHIELD_MAX * .25; player.shielding = false; player.stun = 87; player.dizzyFrames = 87;
        player.shieldLock = 120; player.shieldHoldFrames = 0; player.shieldReleaseQueued = false;
        emit(world, 'shield-break', {
          player: player.i,
          x: player.x + (player.shieldOffsetX || 0),
          y: player.y + (player.shieldOffsetY || 0),
          radius: Math.max(player.width * .9 + 15, player.height * .75 + 12),
          color: colorOf(player)
        });
      } else if (shieldShift) {
        player.actionBuffer = null;
        player.shieldOffsetX = approach(player.shieldOffsetX || 0, input.horizontal * 11, 4);
        player.shieldOffsetY = approach(player.shieldOffsetY || 0, input.vertical * 9, 3);
        player.actionName = 'shieldShift';
      } else {
        player.shieldOffsetX = approach(player.shieldOffsetX || 0, 0, 4);
        player.shieldOffsetY = approach(player.shieldOffsetY || 0, 0, 3);
      }
    }
  } else {
    player.shieldOffsetX = approach(player.shieldOffsetX || 0, 0, 4);
    player.shieldOffsetY = approach(player.shieldOffsetY || 0, 0, 3);
    if (player.shieldLock === 0) player.shield = Math.min(SHIELD_MAX, player.shield + 0.09);
  }

  if (!locked && player.shielding && player.grounded && player.jumpBuffer > 0) {
    player.shielding = false; player.shieldHoldFrames = 0; player.shieldReleaseQueued = false;
  }

  const shieldAttackPressed = pressed(input, previous, BUTTONS.ATTACK);
  const shieldGrabPressed = pressed(input, previous, BUTTONS.GRAB);
  if (!locked && player.shielding && player.grounded && (shieldAttackPressed || shieldGrabPressed)) {
    player.actionBuffer = null; player.shielding = false; player.parryFrames = 0; player.shieldHoldFrames = 0;
    if (shieldAttackPressed && input.vertical < -.45) startMove(world, player, 'groundUp', 1, { variant: 'smash', input });
    else beginGrab(world, player, 'shield');
  } else if (!locked && player.shielding && player.grounded && pressed(input, previous, BUTTONS.SPECIAL) && input.vertical < -.45) {
    player.actionBuffer = null; player.shielding = false; player.parryFrames = 0; player.shieldHoldFrames = 0;
    if (player.recoveryAvailable) {
      player.recoveryAvailable = false;
      startMove(world, player, 'specialUp', 1, { input });
    }
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
    if (buffered.type === 'ultimate') {
      if (player.grounded) startUltimate(world, player);
    } else if (buffered.type === 'grab') {
      if (Math.abs(buffered.input.horizontal) > .35) player.face = Math.sign(buffered.input.horizontal);
      if (!pickupItem(world, player)) {
        if (player.grounded) beginGrab(world, player, isRunningAttackState(player) ? 'dash' : 'normal');
        else performAirDodge(player, buffered.input);
      }
    } else if (player.heldItem && buffered.type === 'attack') {
      if (Math.abs(buffered.input.horizontal) > .35) player.face = Math.sign(buffered.input.horizontal);
      useHeldItem(world, player);
    } else if (buffered.type === 'special') {
      const name = moveName(player, buffered.input, true);
      if (name !== 'specialUp' || player.recoveryAvailable) {
        if (name === 'specialUp') player.recoveryAvailable = false;
        let specialTurnaround = null;
        if (name === 'specialNeutral'
          && player.specialFlickFrames > 0
          && player.specialFlickDirection
          && player.specialFlickDirection === -player.specialFlickFacing) {
          player.face = player.specialFlickDirection;
          player.vx = player.specialFlickDirection * Math.abs(player.vx);
          specialTurnaround = 'momentum';
          emit(world, 'special-turnaround', {
            player: player.i, action: name, kind: 'momentum', direction: player.face
          });
        } else if (Math.abs(buffered.input.horizontal) > .35) player.face = Math.sign(buffered.input.horizontal);
        startMove(world, player, name, 1, { input: buffered.input, specialTurnaround });
        player.specialFlickFrames = 0;
      }
    } else if (buffered.type === 'attack') {
      let name = moveName(player, buffered.input, false);
      if (player.grounded && (buffered.variant === 'tilt' || buffered.variant === 'smash')) {
        const up = buffered.input.vertical < -.45;
        const down = buffered.input.vertical > .45;
        const side = Math.abs(buffered.input.horizontal) > .35;
        name = side || buffered.variant === 'smash' && !up && !down
          ? 'groundSide'
          : up ? 'groundUp' : down ? 'groundDown' : 'groundNeutral';
      }
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
  const canGroundMove = movementUnlocked && player.grounded && !player.action && player.jumpSquatFrames === 0;
  const canAirDrift = movementUnlocked && !player.grounded && (!player.action
    || player.action.name.startsWith('air')
    || player.action.move.recoveryDrift && player.action.activated
    || !player.action.move.dash && !player.action.move.recoveryMove && !player.action.move.teleport && !player.action.move.teleportY);
  const heldDirection = Math.abs(input.horizontal) > .12 ? Math.sign(input.horizontal) : 0;
  if (heldDirection && heldDirection === player.horizontalHoldDirection) player.horizontalHoldFrames = Math.min(120, (player.horizontalHoldFrames || 0) + 1);
  else {
    player.horizontalHoldDirection = heldDirection;
    player.horizontalHoldFrames = heldDirection ? 1 : 0;
  }
  if (canGroundMove || canAirDrift) {
    const freshGroundDirection = canGroundMove && input.horizontal < -.8 && pressed(input, previous, BUTTONS.LEFT)
      ? -1
      : canGroundMove && input.horizontal > .8 && pressed(input, previous, BUTTONS.RIGHT) ? 1 : 0;
    if (freshGroundDirection) {
      const activeDash = isDashState(player);
      if (activeDash && freshGroundDirection !== player.dashDirection) {
        if (player.dashAge <= PIVOT_DASH_WINDOW) beginDash(player, freshGroundDirection, true);
        else beginDashBrake(player);
      } else {
        const lastTap = freshGroundDirection < 0 ? player.lastTapLeft : player.lastTapRight;
        if (world.tick - lastTap <= 8) beginDash(player, freshGroundDirection);
      }
      if (freshGroundDirection < 0) player.lastTapLeft = world.tick;
      else player.lastTapRight = world.tick;
    }
    if (Math.abs(input.horizontal) > 0.12 && !player.action && player.movementState !== 'brake') {
      if (player.grounded && !isDashState(player) && Math.sign(input.horizontal) !== Math.sign(player.vx) && Math.abs(player.vx) > 245) player.skidFrames = character.skid;
      player.face = Math.sign(input.horizontal);
    }
    if (canGroundMove) {
      const magnitude = Math.abs(input.horizontal);
      const running = player.horizontalHoldFrames >= 10;
      const crouching = input.vertical > .55 && magnitude < .25 && !bit(input.buttons, BUTTONS.SHIELD);
      const crawling = !!character.canCrawl && input.vertical > .55 && magnitude >= .25 && !bit(input.buttons, BUTTONS.SHIELD);
      const dashExpired = player.dashFrames === 0 && (player.movementState === 'dash' || player.movementState === 'pivot');
      if (dashExpired) {
        if (magnitude > .12 && Math.sign(input.horizontal) === player.dashDirection) player.movementState = 'run';
        else beginDashBrake(player);
      }
      if (crouching || crawling) {
        player.dashFrames = 0; player.dashAge = 0; player.dashBrakeFrames = 0;
        player.movementState = crouching ? 'crouch' : 'crawl';
        const targetVx = crawling ? input.horizontal * 112 * character.speed : 0;
        player.vx = approach(player.vx, targetVx, crouching ? character.dashBrakeControl : 72);
        player.actionName = player.movementState;
      } else if (player.dashBrakeFrames > 0 || player.movementState === 'brake') {
        player.vx = approach(player.vx, 0, character.dashBrakeControl);
        player.dashBrakeFrames = Math.max(0, player.dashBrakeFrames - 1);
        player.movementState = 'brake';
        player.actionName = 'brake';
        if (player.dashBrakeFrames === 0 && Math.abs(player.vx) < 1) {
          player.vx = 0;
          player.movementState = magnitude > .12 ? 'walk' : 'idle';
        }
      } else if (isDashState(player)) {
        if (player.movementState === 'pivot' && player.dashAge >= 4) player.movementState = 'dash';
        const targetVx = player.dashDirection * (player.movementState === 'pivot' ? character.pivotDashSpeed : character.dashSpeed);
        player.vx = approach(player.vx, targetVx, character.dashAcceleration);
        player.actionName = player.movementState;
      } else {
        const state = magnitude <= .12 ? 'idle' : magnitude >= .8 && running ? 'run' : 'walk';
        const groundSpeed = state === 'run' ? character.runSpeed : character.walkSpeed;
        const targetVx = state === 'idle' ? 0 : input.horizontal * groundSpeed;
        const reversing = targetVx && Math.sign(targetVx) !== Math.sign(player.vx);
        const fromDash = player.movementState === 'run' && Math.abs(player.vx) > character.runSpeed + 8;
        const control = targetVx === 0 ? 145 : reversing ? 175 : fromDash ? Math.max(70, character.dashBrakeControl * .5) : 52;
        player.vx = approach(player.vx, targetVx, control);
        player.movementState = state;
        player.actionName = state;
        if (player.skidFrames > 0) { player.skidFrames -= 1; player.vx *= .88; }
      }
    } else if (canAirDrift) {
      const freefallControl = player.freefall ? .38 : 1;
      const targetVx = Math.abs(input.horizontal) > .12 ? input.horizontal * (player.freefall ? 255 : 345) * character.air : player.vx;
      const airControl = (Math.sign(targetVx) !== Math.sign(player.vx) ? 34 : 24) * freefallControl;
      const recoveryControl = player.action?.move?.recoveryDrift ? player.action.move.recoveryDriftControl || 1 : 1;
      player.vx = approach(player.vx, targetVx, airControl * character.air * recoveryControl);
    }
    const horizontalSpeedLimit = Math.max(character.dashSpeed + 15, 500 * character.speed);
    player.vx = clamp(player.vx, -horizontalSpeedLimit, horizontalSpeedLimit);
    if (!player.action && player.jumpBuffer > 0 && !player.grounded && tryFootstool(world, player)) {
      player.coyoteFrames = 0;
    } else if (!player.action && player.jumpBuffer > 0 && player.jumps > 0 && (player.grounded || player.coyoteFrames > 0 || player.jumps < 2)) {
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
  const fastFallAllowed = movementUnlocked && !player.grounded && !player.tumbling
    && (!player.action || !player.action.move.recoveryMove && !player.action.move.teleportY);
  if (fastFallAllowed && pressed(input, previous, BUTTONS.DOWN) && player.vy > 0 && !player.fastFalling) {
    player.fastFalling = true;
    player.fastFallFlashFrames = 8;
    emit(world, 'fast-fall', { player: player.i, x: player.x, y: player.y - player.height / 2 });
  }
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

  const oldX = player.x, oldY = player.y;
  const standingPlatform = player.grounded ? world.platforms.find(platform => platform.id === player.platformId) : null;
  if (canGroundMove && standingPlatform?.passThrough && pressed(input, previous, BUTTONS.DOWN)) player.dropThroughFrames = 8;
  const finisherFlight = player.criticalFlightFrames > 0;
  if (!finisherFlight) player.vy += player.fastFalling ? 38 : 24;
  player.x += player.vx / TICK_RATE; player.y += player.vy / TICK_RATE;
  if (finisherFlight) player.criticalFlightFrames -= 1;
  const dropping = player.dropThroughFrames > 0;
  const landing = findLanding(player, oldY, world.platforms, dropping);
  if (!landing) resolveGroundBodyCollision(player, oldX, oldY, world.platforms);
  if (landing) {
    const wasAirborne = !player.grounded;
    const landingSpeed = player.vy;
    const landingLag = currentLandingLag(player);
    player.y = landing.y - player.height / 2; player.vy = 0; player.grounded = true; player.platformId = landing.id;
    if (wasAirborne) player.vx *= landingLag ? .84 : .88;
    player.jumps = 2; player.coyoteFrames = 6; player.airDodgeAvailable = true; player.recoveryAvailable = true; player.fastFalling = false; player.freefall = false; player.ledgeJumpRefreshPending = false; player.criticalFlightFrames = 0; player.canLedgeInvincible = true; player.ledgeGrabs = 0; player.footstoolCount = 0;
    if (wasAirborne && player.actionName === 'airDodge') {
      const neutralAirDodge = !!player.dodgeNeutral;
      player.dodgeFrames = 0; player.dodgeTotalFrames = 0; player.dodgeElapsed = 0;
      player.dodgeWindupFrames = 0; player.dodgeNeutral = false;
      player.landingLag = neutralAirDodge ? 9 : 12;
      player.vx *= neutralAirDodge ? .84 : .68; player.actionName = 'landing';
    } else if (wasAirborne && player.tumbling && landingSpeed > 120) {
      player.action = null; player.actionBuffer = null; player.stun = 0; player.pendingLandingLag = 0; player.tumbling = false;
      const impactSpeed = Math.hypot(player.vx, landingSpeed);
      const techable = impactSpeed <= TECH_MAX_IMPACT_SPEED;
      if (player.techWindow > 0 && techable) {
        const direction = Math.abs(input.horizontal) > 0.4 ? Math.sign(input.horizontal) : 0;
        const incomingVx = player.vx;
        player.techWindow = 0;
        if (direction) performDodge(player, 'techRoll', 16, 12, direction * 470 * character.speed + incomingVx * .2);
        else { player.dodgeFrames = 10; player.invincible = Math.max(player.invincible, 14); player.vx *= 0.32; }
        if (direction) player.face = direction;
        if (!direction) player.actionName = 'tech';
        emit(world, 'tech', { player: player.i, direction, x: player.x, y: landing.y, impactSpeed, color: 'blue' });
      } else {
        player.knockdownFrames = 45; player.techWindow = 0; player.vx *= 0.28; player.actionName = 'knockdown';
        emit(world, 'knockdown', { player: player.i, x: player.x, y: landing.y, impactSpeed, techable, color: techable ? 'blue' : 'red' });
      }
    } else if (wasAirborne && landingLag) { player.landingLag = landingLag; player.pendingLandingLag = 0; player.action = null; player.actionName = 'landing'; }
    else if (wasAirborne && landingSpeed > 160 && player.dodgeFrames === 0) { player.landingLag = landingSpeed > 520 ? 6 : 4; player.actionName = 'landing'; }
    if (wasAirborne && landingSpeed > 280) emit(world, 'land', { player: player.i, x: player.x, y: landing.y, speed: landingSpeed });
  } else { player.grounded = false; player.platformId = null; tryLedge(world, player); }

  if (!player.action && player.jumpSquatFrames === 0 && player.stun === 0 && player.dodgeFrames === 0 && player.landingLag === 0 && player.shieldStun === 0 && player.shieldDropLag === 0 && player.knockdownFrames === 0 && !player.shielding && !player.ledge && player.grabbing == null && player.grabbedBy == null) {
    if (!player.grounded && player.footstoolCooldown > 12) player.actionName = 'footstool';
    else if (!player.grounded && player.tumbleRecoverFrames > 0) player.actionName = 'airRecover';
    else if (!player.grounded && player.freefall) { player.movementState = 'air'; player.actionName = 'freefall'; }
    else if (!player.grounded && player.tumbling) { player.movementState = 'air'; player.actionName = 'tumble'; }
    else if (!player.grounded) { player.movementState = 'air'; player.actionName = player.vy < 0 ? 'jump' : 'fall'; }
    else if (player.movementState === 'brake' || player.dashBrakeFrames > 0) player.actionName = 'brake';
    else if (player.movementState === 'pivot' && player.dashFrames > 0) player.actionName = 'pivot';
    else if (player.movementState === 'dash' && player.dashFrames > 0) player.actionName = 'dash';
    else if (player.skidFrames > 0) player.actionName = 'skid';
    else if (input.vertical > .55 && Math.abs(input.horizontal) < .25) player.actionName = 'crouch';
    else if (player.actionName === 'crawl' && input.vertical > .55 && Math.abs(input.horizontal) >= .25) player.actionName = 'crawl';
    else if (player.movementState === 'run' && Math.abs(player.vx) > 18) player.actionName = 'run';
    else if (Math.abs(player.vx) > 18) player.actionName = 'walk';
    else { player.movementState = 'idle'; player.actionName = 'idle'; }
  }

  const outsideCamera = player.x < 0 || player.x > WORLD_W || player.y < 0 || player.y > WORLD_H;
  if (outsideCamera && !isOutOfBounds(player) && world.rules.mode !== 'training') {
    player.offscreenDamageClock = (player.offscreenDamageClock || 0) + 1;
    if (player.offscreenDamageClock >= TICK_RATE) {
      player.offscreenDamageClock = 0; player.damage += 1;
      emit(world, 'offscreen-damage', { player: player.i, damage: player.damage });
    }
  } else player.offscreenDamageClock = 0;
  if (isOutOfBounds(player)) knockout(world, player);
  player.lastInput = input;
}

function knockout(world, player) {
  const killer = world.players.find(other => other.i === player.lastDamager && other.i !== player.i);
  const upperExit = player.y < BLAST_TOP;
  const upperRoll = upperExit ? world.rng() : 1;
  const koStyle = upperRoll < .35 ? 'star' : upperRoll < .7 ? 'screen' : 'blast';
  const respawnDelay = koStyle === 'blast' ? 90 : 150;
  if (killer) { killer.kos += 1; killer.score += 1; }
  player.falls += 1; if (world.rules.mode === 'time') player.score -= 1;
  emit(world, 'ko', {
    player: player.i,
    killer: killer?.i ?? null,
    style: koStyle,
    x: player.x,
    y: player.y,
    characterId: player.characterId,
    palette: player.palette
  });
  releaseGrab(world, player);
  if (world.suddenDeath) {
    player.eliminated = true; player.stocks = 0; player.respawn = 0;
    const survivors = world.players.filter(other => !other.eliminated && other.i !== player.i);
    world.phase = 'ended'; world.winner = survivors[0]?.i ?? killer?.i ?? null;
  } else if (world.rules.mode === 'time' || world.rules.mode === 'training') player.respawn = respawnDelay;
  else {
    player.stocks -= 1;
    if (player.stocks <= 0) { player.stocks = 0; player.eliminated = true; }
    else player.respawn = respawnDelay;
  }
  player.x = -999; player.y = -999; player.vx = 0; player.vy = 0;
  player.respawnPlatformFrames = 0;
  player.action = null; player.actionBuffer = null; player.shielding = false; player.ledge = null; player.ledgeTransition = null; player.ledgeTransitionFrames = 0; player.ledgeTransitionTotal = 0; player.ledgeJumpRefreshPending = false; player.dodgeFrames = 0;
  player.tumbling = false; player.freefall = false; player.techWindow = 0; player.knockdownFrames = 0; player.criticalFlightFrames = 0;
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
    if (entity.type === 'projectile' || entity.type === 'bomb' || entity.type === 'ultimateProjectile') {
      entity.x += entity.vx / TICK_RATE; entity.y += entity.vy / TICK_RATE;
      if (entity.type === 'bomb') entity.vy += 22;
      if (entity.kind === 'star') { entity.y += Math.sin(entity.age * .42) * 2.2; entity.vx *= .996; }
    }
    if (entity.kind === 'boomerang' && entity.life < 50 && !entity.returning) {
      entity.vx *= -1;
      entity.returning = true;
      entity.damage *= entity.returnDamageScale || .62;
      entity.kx *= .82;
      entity.ky *= .82;
      entity.hitPlayers = [];
    }
  }
  resolveProjectileClashes(world);
  for (const entity of world.entities) {
    if (entity.life <= 0) continue;
    const owner = world.players.find(player => player.i === entity.owner);
    if (entity.kind === 'ultimateNova' && entity.arm > 0) {
      for (const target of world.players) {
        if (!owner || target.i === owner.i || target.eliminated || target.respawn > 0) continue;
        const dx = entity.x - target.x, dy = entity.y - target.y, distance = Math.hypot(dx, dy);
        if (distance > 1 && distance < entity.radius * 1.12) {
          const strength = 1 - distance / (entity.radius * 1.12);
          target.vx += dx / distance * (5 + strength * 14) * (entity.pullStrength || 1);
          target.vy += dy / distance * (1.2 + strength * 4);
        }
      }
    }
    if (entity.arm > 0) continue;
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
        crowdDamageScale: entity.crowdDamageScale,
        fixedKx: entity.fixedKx, fixedKy: entity.fixedKy,
        knockbackGrowth: entity.knockbackGrowth, groundedFlinch: entity.groundedFlinch,
        hitstop: entity.hitstop ?? 6, hitstun: entity.hitstun, noFlinch: !!entity.noFlinch,
        shieldPoke: target.shielding && touchedHurtbox.part !== 'shield',
        contactX: entity.x + Math.cos(contactAngle) * radius,
        contactY: entity.y + Math.sin(contactAngle) * radius
      } : null;
      const hitDirection = entity.kind === 'gravity' ? Math.sign(entity.x - target.x || owner.face) : Math.sign(target.x - entity.x || owner.face);
      if (touchedHurtbox && hitPlayer(world, owner, target, entityMove, hitDirection)) {
        (entity.hitPlayers ||= []).push(target.i);
        if (entity.stunBonus) target.stun = Math.max(target.stun, entity.stunBonus);
        if (entity.kind === 'arc' && entity.chainRadius) {
          const chained = world.players.filter(other => other.i !== owner.i && other.i !== target.i && !other.eliminated && !entity.hitPlayers.includes(other.i) && Math.hypot(other.x - target.x, other.y - target.y) <= entity.chainRadius).sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0];
          if (chained && hitPlayer(world, owner, chained, { name: 'arcChain', damage: entity.damage * .65, kx: 0, ky: 0, hitstop: 2, noFlinch: true }, Math.sign(chained.x - target.x || owner.face))) { entity.hitPlayers.push(chained.i); emit(world, 'chain', { player: chained.i, from: target.i, x: chained.x, y: chained.y }); }
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
  if (!world.cpuBrains.has(player.i)) world.cpuBrains.set(player.i, {
    nextDecision: 0,
    input: cpuInput(world),
    actionRelease: 0,
    targetId: null,
    targetLockUntil: 0,
    utilityCooldownUntil: 0,
    observedTargetId: null,
    observedHitId: 0,
    observedTargetHitId: 0,
    lastExchangeTick: 0,
    plan: 'pressure',
    planUntil: 0
  });
  return world.cpuBrains.get(player.i);
}

function decideCpuInput(world, player, difficulty) {
  if (difficulty === 'dummy') return cpuInput(world);
  const profile = CPU_PROFILES[difficulty] || CPU_PROFILES.normal;
  const combatProfile = profile;
  const brain = cpuBrain(world, player);
  const target = selectCpuTarget(world, player, brain);
  if (!target) return cpuInput(world);

  if (brain.observedTargetId !== target.i) {
    brain.observedTargetId = target.i;
    brain.observedHitId = player.hitId;
    brain.observedTargetHitId = target.hitId;
    brain.lastExchangeTick = world.tick;
    brain.planUntil = 0;
  } else if (brain.observedHitId !== player.hitId || brain.observedTargetHitId !== target.hitId) {
    brain.observedHitId = player.hitId;
    brain.observedTargetHitId = target.hitId;
    brain.lastExchangeTick = world.tick;
  }
  const quietFrames = Math.max(0, world.tick - brain.lastExchangeTick);

  // Recovery, DI and ledge choices are checked every frame; waiting for the
  // normal decision interval here makes even a strong CPU casually self-destruct.
  if (player.ledge || isOffstage(world.platforms, player)) {
    const recoveryIntent = planCpuRecovery(world, player, profile, {
      worldWidth: WORLD_W, marginX: BLAST_MARGIN_X, bottom: BLAST_BOTTOM
    });
    brain.input = cpuInput(
      world, recoveryIntent.horizontal, recoveryIntent.vertical, recoveryIntent.actions
    );
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
  if (player.stun > 0) {
    const recovery = selectRecoveryTarget(world.platforms, player);
    const towardStage = Math.sign(recovery.x - player.x);
    const tech = player.vy > 0 && Math.abs(player.y - recovery.platform.y) < 90 && profile.accuracy > .68;
    return cpuInput(world, towardStage, 0, tech ? BUTTONS.SHIELD : 0);
  }

  // A deliberate smash must keep Attack held past the fourteen-frame charge
  // threshold. Preserve that committed input even after the normal reaction
  // interval expires; otherwise every CPU "smash" degrades into a tilt.
  if (world.tick < brain.actionRelease && (brain.input.buttons & CPU_ACTION_BUTTONS)) {
    return { ...brain.input, seq: world.tick };
  }
  if (world.tick < brain.nextDecision) {
    const heldActions = world.tick < brain.actionRelease ? brain.input.buttons & CPU_ACTION_BUTTONS : 0;
    return { ...brain.input, buttons: brain.input.buttons & CPU_DIRECTION_BUTTONS | heldActions, seq: world.tick };
  }
  brain.nextDecision = world.tick + combatProfile.reaction;

  const dx = target.x - player.x, dy = target.y - player.y;
  const distance = Math.hypot(dx, dy * .72);
  const toward = Math.sign(dx || player.face);
  const targetOffstage = isOffstage(world.platforms, target);
  const support = player.grounded
    ? world.platforms.find(platform => platform.id === player.platformId)
      || world.platforms.find(platform => player.x >= platform.x && player.x <= platform.x + platform.w
        && Math.abs(player.y + player.height / 2 - platform.y) < 18)
    : null;
  const edgeClearance = support
    ? toward < 0 ? player.x - support.x : support.x + support.w - player.x
    : Infinity;
  const riskyEdgePursuit = targetOffstage && !!support && edgeClearance < 110;
  const threat = findIncomingThreat(world, player, target);
  const projectileFighter = !!characterOf(player).moves.specialNeutral.projectile;
  if (world.tick >= brain.planUntil) {
    brain.plan = chooseCombatPlan({
      fighterId: player.characterId,
      targetShielding: target.shielding,
      targetVulnerable: target.stun > 0 || target.landingLag > 0,
      quietFrames,
      projectileReady: projectileFighter && player.projectileCooldown <= 0,
      distance,
      playerDamage: player.damage,
      targetDamage: target.damage
    });
    brain.planUntil = world.tick + (difficulty === 'hard' ? 42 : 60);
  }
  const forcingInitiative = difficulty === 'hard' && quietFrames >= 54;
  const pressuring = brain.plan === 'pressure' || forcingInitiative;
  const defenseChance = fighterDefenseChance(
    combatProfile.defense, player.characterId, player.damage, forcingInitiative
  );
  const aggression = combatProfile.aggression;
  const canAct = !player.action && player.landingLag <= 0 && player.shieldStun <= 0 && player.dodgeFrames <= 0;
  const targetMove = target.action?.move;
  const targetStartup = target.action?.startup ?? targetMove?.startup ?? 0;
  const targetRecovering = !!target.action && target.action.frame >= targetStartup + (targetMove?.active || 0);
  const nearbyEnemies = world.players.filter(other =>
    other.i !== player.i && !other.eliminated && !other.respawn
    && (!world.rules.teams || other.team !== player.team)
    && Math.hypot(other.x - player.x, (other.y - player.y) * .72) < 120
  ).length;
  let chosen;
  let actionHoldFrames = 1;

  if (threat && canAct && world.rng() < defenseChance) {
    if (player.characterId === 'blaze' && player.grounded && distance < 145
      && world.rng() < (difficulty === 'hard' ? .23 : .14)) {
      chosen = cpuInput(world, 0, 1, BUTTONS.SPECIAL);
    } else if (!player.grounded) chosen = cpuInput(world, -threat.direction, 0, player.airDodgeAvailable ? BUTTONS.SHIELD : 0);
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
  if (!chosen && canAct && player.characterId === 'bolt' && !targetOffstage) {
    const returningBoomerang = world.entities.find(entity =>
      entity.owner === player.i && entity.kind === 'boomerang' && entity.returning && entity.life > 0
    );
    if (returningBoomerang
      && Math.abs(returningBoomerang.y - target.y) < 90
      && Math.abs(returningBoomerang.x - target.x) < 300) {
      // Put the opponent between BOLT and the returning orb. This turns the
      // authored return pass into real pressure instead of letting the generic
      // CPU walk beside its own projectile and waste the second hit.
      const oppositeSide = Math.sign(target.x - returningBoomerang.x || -returningBoomerang.vx || player.face);
      const setupX = target.x + oppositeSide * 85;
      const setupDistance = setupX - player.x;
      if (Math.abs(setupDistance) > 38) chosen = cpuInput(world, Math.sign(setupDistance), 0);
      else if (distance < 105) chosen = cpuInput(world, toward, 0, BUTTONS.ATTACK);
    }
  }
  if (!chosen && canAct && player.characterId === 'bolt' && player.grounded
    && distance > 145 && distance < 360 && player.projectileCooldown <= 0
    && boltBoomerangWanted({
      plan: brain.plan,
      tick: world.tick,
      cooldownUntil: brain.boomerangPlanUntil || 0,
      difficulty,
      roll: world.rng()
    })
    && !world.entities.some(entity => entity.owner === player.i && entity.kind === 'boomerang' && entity.life > 0)) {
    chosen = cpuInput(world, 0, 0, BUTTONS.SPECIAL);
    brain.boomerangPlanUntil = world.tick + 72;
  }
  if (!chosen && canAct && player.characterId === 'blaze' && player.grounded
    && !targetOffstage && !target.shielding && distance > 115 && distance < 250
    && edgeClearance > 145 && world.tick >= (brain.armoredApproachUntil || 0)
    && world.rng() < (difficulty === 'hard' ? .38 : .22)) {
    // BLAZE is too slow to win a pure footrace. Its authored side special is
    // the safe armored commitment for crossing mid range, but only when there
    // is stage behind it and the target is not waiting with a shield.
    chosen = cpuInput(world, toward, 0, BUTTONS.SPECIAL);
    brain.armoredApproachUntil = world.tick + 84;
  }
  if (!chosen && canAct && player.characterId === 'blaze' && !player.grounded
    && blazeAirNeutralWanted({
      distance,
      verticalGap: dy,
      nearbyEnemies,
      targetAttacking: !!target.action,
      roll: world.rng()
    })) {
    // The armored neutral-air is BLAZE's authored scramble breaker. A neutral
    // stick keeps crowded landings from degrading into slower vertical aerials.
    chosen = cpuInput(world, 0, 0, BUTTONS.ATTACK);
  }
  if (!chosen && canAct && player.characterId === 'blaze' && player.grounded
    && !targetOffstage && player.projectileCooldown <= 0
    && distance >= 275 && distance <= 520 && Math.abs(dy) < 105
    && edgeClearance > 120) {
    const chargeFrames = blazeNeutralChargeFrames({ distance, targetRecovering });
    if (chargeFrames > 1 && world.rng() < (difficulty === 'hard' ? .54 : .34)) {
      chosen = cpuInput(world, 0, 0, BUTTONS.SPECIAL);
      actionHoldFrames = chargeFrames;
    }
  }
  if (!chosen && canAct && distance < 62 && target.shielding && world.rng() < combatProfile.accuracy) {
    chosen = cpuInput(world, toward, 0, BUTTONS.GRAB);
  }
  if (!chosen && canAct && player.grounded && target.grounded
    && distance < 58 && Math.abs(dy) < 48
    && world.tick >= (brain.grabMixupUntil || 0)
    && (target.shielding || target.dodgeFrames > 0 || world.rng() < (difficulty === 'hard' ? .16 : .08))) {
    // A grab is a close-range answer, not a diversity quota. It enters the
    // mix only when normal pressure would be beaten by shield/dodge or as an
    // occasional hard read at point blank.
    chosen = cpuInput(world, toward, 0, BUTTONS.GRAB);
    brain.grabMixupUntil = world.tick + 54;
  }
  if (!chosen && canAct && difficulty === 'hard' && targetRecovering
    && distance < 145 && Math.abs(dy) < 82) {
    if (target.shielding && distance < 68) chosen = cpuInput(world, toward, 0, BUTTONS.GRAB);
    else {
      const vertical = dy < -34 ? -1 : dy > 42 ? 1 : 0;
      chosen = cpuInput(world, vertical ? 0 : toward, vertical, BUTTONS.ATTACK);
    }
  }
  if (!chosen && canAct && player.grounded && target.damage < 78
    && world.tick >= (brain.utilityCooldownUntil || 0)) {
    const activeOwnTrap = world.entities.some(entity => entity.owner === player.i && entity.type === 'trap' && entity.life > 0);
    const targetApproaching = Math.sign(target.vx || 0) === -Math.sign(dx || 1) && Math.abs(target.vx) > 90;
    const punishableTarget = target.stun > 0 || target.landingLag >= 7 || target.knockdownFrames > 0;
    const wantsDownSpecial = player.characterId === 'volt'
      ? distance > 55 && distance < 94 && Math.abs(dy) < 48 && (targetApproaching || punishableTarget)
      : player.characterId === 'bolt'
        ? target.grounded && distance > 72 && distance < 118 && Math.abs(dy) < 52 && punishableTarget
        : player.characterId === 'nova'
          ? target.grounded && distance > 105 && distance < 190 && !activeOwnTrap && targetApproaching
          : false;
    if (wantsDownSpecial) {
      chosen = cpuInput(world, 0, 1, BUTTONS.SPECIAL);
      brain.utilityCooldownUntil = world.tick + (player.characterId === 'nova' ? 150 : 90);
    }
  }
  const groundedFinisher = !chosen && canAct && player.grounded
    && distance < 105 && Math.abs(dy) < 82 && target.damage >= 78;
  const guaranteedPunish = groundedFinisher && (target.stun >= 12 || target.landingLag >= 9 || target.dizzyFrames > 0);
  const smashChance = difficulty === 'easy' ? .12 : difficulty === 'hard' ? .36 : .26;
  const stationaryEnough = !isRunningAttackState(player) && Math.abs(player.vx) < characterOf(player).runSpeed * .72;
  if (groundedFinisher && stationaryEnough && (guaranteedPunish || world.rng() < smashChance)) {
    const vertical = dy < -34 ? -1 : dy > 42 ? 1 : 0;
    chosen = cpuInput(world, vertical ? 0 : toward, vertical, BUTTONS.ATTACK);
    actionHoldFrames = 18 + Math.floor(combatProfile.accuracy * 8);
  }
  // Neutral Attack at point-blank range gives every CPU access to its authored
  // jab string. Previously the held approach direction converted virtually all
  // grounded attacks into side tilts.
  if (!chosen && canAct && player.grounded && distance < 68 && Math.abs(dy) < 60
    && !target.shielding && (distance < 52 || world.rng() < .46)) {
    chosen = cpuInput(world, 0, 0, BUTTONS.ATTACK);
  }
  // Preserve a real dash-attack branch instead of letting it occur only by
  // accident when a generic tilt happens during a run.
  if (!chosen && canAct && player.grounded && isRunningAttackState(player)
    && distance < 138 && Math.abs(dy) < 72 && world.rng() < aggression) {
    chosen = cpuInput(world, toward, 0, BUTTONS.ATTACK);
  }
  if (!chosen && canAct && !player.grounded && distance < 115 && world.rng() < aggression) {
    const closeScramble = distance < 62 && Math.abs(dy) < 34;
    if (closeScramble) chosen = cpuInput(world, 0, 0, BUTTONS.ATTACK);
    else {
      const vertical = dy < -35 ? -1 : dy > 38 ? 1 : 0;
      chosen = cpuInput(world, vertical ? 0 : toward, vertical, BUTTONS.ATTACK);
    }
  }
  if (!chosen && canAct && distance < 105 && Math.abs(dy) < 85 && world.rng() < aggression) {
    const useSpecial = world.rng() < (difficulty === 'easy' ? .06 : .075);
    const catchesLow = target.grounded
      && (target.actionName === 'crouch' || target.actionName === 'crawl' || target.knockdownFrames > 0 || dy > 28);
    if (player.grounded && distance < 52 && !target.shielding) {
      chosen = cpuInput(world, 0, 0, useSpecial ? BUTTONS.SPECIAL : BUTTONS.ATTACK);
    }
    else {
      const vertical = dy < -30 ? -1 : catchesLow || dy > 38 ? 1 : 0;
      chosen = cpuInput(world, vertical ? 0 : toward, vertical, useSpecial ? BUTTONS.SPECIAL : BUTTONS.ATTACK);
    }
  }
  if (!chosen && canAct && distance < 205 && Math.abs(dy) < 100
    && world.rng() < aggression * (pressuring ? .92 : .72)) {
    const useSpecial = !riskyEdgePursuit && world.rng() < (brain.plan === 'zone' ? .34 : .2);
    chosen = cpuInput(world, riskyEdgePursuit ? 0 : toward, 0, useSpecial ? BUTTONS.SPECIAL : BUTTONS.ATTACK);
  }
  if (!chosen && canAct && targetOffstage && !isOffstage(world.platforms, player) && world.rng() < combatProfile.edgeguard) {
    chosen = player.grounded
      ? cpuInput(world, 0, 0, BUTTONS.SPECIAL)
      : cpuInput(world, toward, dy > 15 ? 1 : 0, BUTTONS.ATTACK);
  }
  if (!chosen && canAct && distance > 220 && player.projectileCooldown <= 0 && world.rng() < aggression * .42) {
    // Neutral stick is intentional: X with a horizontal direction would select
    // the side special instead of the fighter's projectile.
    chosen = cpuInput(world, 0, 0, BUTTONS.SPECIAL);
  }
  if (!chosen) {
    const preferredRange = preferredCombatRange({
      fighterId: player.characterId,
      plan: brain.plan,
      pressuring,
      projectileFighter
    });
    const move = riskyEdgePursuit ? 0 : distance > preferredRange + 30 ? toward : distance < preferredRange - 28 ? -toward : 0;
    const jump = target.y < player.y - 95 && player.grounded && world.rng() < combatProfile.accuracy * .55;
    chosen = cpuInput(world, move, jump ? -1 : 0);
  }

  brain.input = chosen;
  const actions = chosen.buttons & CPU_ACTION_BUTTONS;
  brain.actionRelease = world.tick + (actions === BUTTONS.SHIELD ? 5
    : actions & (BUTTONS.ATTACK | BUTTONS.SPECIAL) ? actionHoldFrames
      : 1);
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

  world.pendingMoveHits = [];
  const resolvedInputs = new Map();
  for (const player of world.players) {
    const supplied = inputs[player.i];
    const input = supplied || (player.clientId?.startsWith('cpu:') ? decideCpuInput(world, player, world.training.cpu) : player.lastInput);
    resolvedInputs.set(player.i, input);
  }
  // Ledge-catch vulnerability advances once per world tick, not once during a
  // player's update, so the two exposed frames do not depend on roster order.
  for (const player of world.players) {
    if (player.ledge && player.ledgeCatchFrames > 0) player.ledgeCatchFrames -= 1;
  }
  // Arm shield-release parries before resolving attacks. Ultimate-style parries
  // require a shield to be held for at least three frames, then released during
  // the six-frame drop window. The prepass keeps same-tick results roster-order
  // independent.
  for (const player of world.players) {
    const input = resolvedInputs.get(player.i);
    const neutralShield = Math.abs(Number(input?.horizontal) || 0) <= .4 && Math.abs(Number(input?.vertical) || 0) <= .4;
    const startsShield = player.grounded && neutralShield && pressed(input || {}, player.lastInput, BUTTONS.SHIELD)
      && !player.shielding && !player.action && player.stun <= 0 && player.hitstop <= 0
      && player.dodgeFrames <= 0 && player.landingLag <= 0 && player.shieldStun <= 0
      && player.shieldDropLag <= 0 && player.shieldLock <= 0 && player.knockdownFrames <= 0
      && !player.ledge && player.grabbedBy == null && player.grabbing == null;
    if (startsShield) {
      player.shielding = true; player.shieldHoldFrames = 0; player.shieldReleaseQueued = false;
      player.actionName = 'shield';
    }
    const releasedShield = released(input || {}, player.lastInput, BUTTONS.SHIELD);
    const canParry = player.grounded && player.shielding && player.shieldHoldFrames >= 3 && releasedShield
      && !player.action && player.stun <= 0 && player.hitstop <= 0 && player.dodgeFrames <= 0
      && player.landingLag <= 0 && player.shieldStun <= 0 && player.shieldLock <= 0
      && player.knockdownFrames <= 0 && !player.ledge && player.grabbedBy == null && player.grabbing == null;
    if (canParry) {
      player.parryFrames = Math.max(player.parryFrames, PARRY_FRAMES + 1);
      player.shielding = false; player.shieldHoldFrames = 0; player.shieldReleaseQueued = false;
      player.shieldDropLag = PARRY_MISS_LAG_FRAMES;
      player.actionName = 'parryReady';
      emit(world, 'parry-ready', { player: player.i });
    }
  }
  for (const player of world.players) {
    const input = resolvedInputs.get(player.i);
    updatePlayer(world, player, input);
  }
  resolvePendingMoveHits(world);
  resolvePlayerPushboxes(world);
  updateEntities(world); updateItems(world); updateHazards(world); finishMatch(world);
  return world;
}

function resolvePlayerPushboxes(world) {
  const active = world.players.filter(player => !player.eliminated && !player.respawn && player.grabbedBy == null);
  for (let a = 0; a < active.length; a++) for (let b = a + 1; b < active.length; b++) {
    const first = active[a], second = active[b];
    const firstWarpCharging = first.action?.charging && first.action.move?.distanceCharge;
    const secondWarpCharging = second.action?.charging && second.action.move?.distanceCharge;
    if (firstWarpCharging || secondWarpCharging) continue;
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
      const chargeMaximum = action?.move?.maxChargeFrames || SMASH_MAX_HOLD_FRAMES;
      const phaseLength = !action ? 1 : actionPhase === 'charge' ? chargeMaximum : actionPhase === 'startup' ? Math.max(1, startup) : actionPhase === 'active' ? Math.max(1, action.move.active) : Math.max(1, action.move.recovery);
      const phaseProgress = action ? actionPhase === 'charge'
        ? action.move.distanceCharge ? clamp(Number(action.chargeProgress) || 0, 0, 1) : action.holdFrames / chargeMaximum
        : clamp((action.frame - phaseStart) / phaseLength, 0, 1) : 0;
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
        actionAngleShift: action?.move?.angleShift || 0,
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
  else if (command.type === 'bot-character') {
    const fighter = FIGHTERS.find(item => item.id === command.value);
    const bot = world.players.find(player => String(player.clientId || '').startsWith('cpu:'));
    if (!fighter || !bot) return false;
    const feetY = bot.y + bot.height / 2;
    releaseGrab(world, bot);
    bot.characterId = fighter.id;
    bot.width = fighter.width;
    bot.height = fighter.height;
    bot.y = feetY - bot.height / 2;
    bot.action = null;
    bot.actionName = bot.grounded ? 'idle' : bot.vy < 0 ? 'jump' : 'fall';
    bot.actionBuffer = null;
    bot.charge = null;
    bot.hitstop = 0;
    bot.stun = 0;
    bot.shielding = false;
    bot.parryFrames = 0;
    bot.shieldStun = 0;
    bot.shieldDropLag = 0;
    bot.dodgeFrames = 0;
    bot.dodgeTotalFrames = 0;
    bot.dodgeElapsed = 0;
    bot.landingLag = 0;
    bot.pendingLandingLag = 0;
    bot.tumbling = false;
    bot.tumbleRecoverFrames = 0;
    bot.freefall = false;
    bot.ledgeJumpRefreshPending = false;
    bot.techWindow = 0;
    bot.knockdownFrames = 0;
    bot.criticalFlightFrames = 0;
    bot.invincible = Math.max(bot.invincible, 30);
    world.entities = world.entities.filter(entity => entity.owner !== bot.i);
    emit(world, 'bot-character', { player: bot.i, characterId: fighter.id });
  }
  else if (command.type === 'reset') {
    world.entities = [];
    world.items = [];
    for (const player of world.players) {
      resetPlayerState(world, player, { x: 640 + (player.i - 0.5) * 160, y: 300, damage: player.i ? clamp(Number(command.damage) || 0, 0, 999) : 0 });
      player.respawn = 0; player.shield = SHIELD_MAX; player.heldItem = null; player.ultimateMeter = ULTIMATE_READY;
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
  player.action = null; player.actionBuffer = null; player.shielding = false; player.ledge = null; player.ledgeTransition = null; player.ledgeTransitionFrames = 0; player.ledgeTransitionTotal = 0; player.vx = 0; player.vy = 0;
  return true;
}

module.exports = { TICK_RATE, WORLD_W, WORLD_H, BLAST_MARGIN_X, BLAST_TOP, BLAST_BOTTOM, normalizeRules, createWorld, stepWorld, publicSnapshot, trainingCommand, forfeitPlayer };
