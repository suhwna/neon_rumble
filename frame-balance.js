'use strict';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function moveClass(name, move, variant = 'normal') {
  if (move.projectile || move.projectileOnly) return 'projectile';
  if (move.defensiveOnly || move.counter) return 'counter';
  if (move.recoveryMove || name === 'specialUp') return 'recovery';
  if (move.jab && move.jab < 3) return 'jab';
  if (move.jab === 3) return 'jabFinisher';
  if (name === 'dashAttack') return 'dash';
  if (name.startsWith('air')) return 'aerial';
  if (name.startsWith('special')) return 'special';
  if (variant === 'tilt' || move.tilt) return 'tilt';
  if (variant === 'smash' || name.startsWith('ground') && move.chargeable) return 'smash';
  return 'normal';
}

function effectiveReach(move) {
  const horizontal = Number(move.reachX) || 0;
  const vertical = (Number(move.reachY) || 0) * 0.78;
  const projectile = (Number(move.projectileRadius) || 0) * 2;
  return Math.max(horizontal, vertical, projectile);
}

function threatScore(name, move, variant = 'normal') {
  const category = moveClass(name, move, variant);
  const damage = Math.max(0, Number(move.damage) || 0);
  const reach = effectiveReach(move);
  const startup = Math.max(1, Number(move.startup) || 1);
  const active = Math.max(1, Number(move.active) || 1);
  let score = damage * 0.3 + reach / 31 + active * 0.2 - startup * 0.07;
  if (move.radial) score += 0.8;
  if (move.dash) score += 0.8;
  if (move.armor || move.armorType) score += 1;
  if (move.sweetspot) score += 0.35;
  if (category === 'projectile') score += 1.5;
  return Math.max(0, score);
}

function targetBlockDisadvantage(category, threat) {
  switch (category) {
    case 'jab': return clamp(Math.round(threat * 0.2), 1, 3);
    case 'jabFinisher': return clamp(Math.round(3 + threat * 0.34), 5, 8);
    case 'tilt': return clamp(Math.round(2 + threat * 0.42), 4, 8);
    case 'smash': return clamp(Math.round(5 + threat * 0.55), 8, 14);
    case 'dash': return clamp(Math.round(5 + threat * 0.52), 8, 14);
    case 'aerial': return clamp(Math.round(1 + threat * 0.36), 3, 8);
    case 'special': return clamp(Math.round(6 + threat * 0.55), 9, 16);
    case 'counter': return clamp(Math.round(7 + threat * 0.5), 10, 17);
    case 'recovery': return clamp(Math.round(7 + threat * 0.52), 10, 18);
    default: return clamp(Math.round(3 + threat * 0.4), 5, 9);
  }
}

function targetWhiffCommitment(category, threat) {
  switch (category) {
    case 'jab': return clamp(Math.round(3 + threat * 0.28), 4, 6);
    case 'jabFinisher': return clamp(Math.round(7 + threat * 0.55), 10, 14);
    case 'tilt': return clamp(Math.round(7 + threat * 0.58), 10, 15);
    case 'smash': return clamp(Math.round(12 + threat * 0.9), 17, 27);
    case 'dash': return clamp(Math.round(12 + threat * 0.85), 17, 26);
    case 'aerial': return clamp(Math.round(7 + threat * 0.58), 10, 17);
    case 'projectile': return clamp(Math.round(8 + threat * 0.72), 12, 20);
    case 'special': return clamp(Math.round(13 + threat * 0.9), 18, 30);
    case 'counter': return clamp(Math.round(15 + threat * 0.85), 20, 31);
    case 'recovery': return clamp(Math.round(16 + threat * 0.9), 21, 32);
    default: return clamp(Math.round(8 + threat * 0.55), 10, 16);
  }
}

function contactCancelWindows(category, move) {
  const authored = Math.max(0, Math.min(Number(move.cancelWindow) || 0, Number(move.recovery) || 0));
  switch (category) {
    case 'jab':
      // Jab strings may advance on whiff, but they still leave a small punishable
      // gap on shield because block-cancel is narrower than the authored chain.
      return { hit: authored, block: Math.min(2, authored), whiff: authored };
    case 'jabFinisher':
      return { hit: authored, block: Math.min(1, authored), whiff: 0 };
    case 'tilt':
      return { hit: authored, block: Math.min(1, authored), whiff: 0 };
    case 'aerial':
      return { hit: authored, block: Math.min(1, authored), whiff: 0 };
    case 'normal':
      return { hit: authored, block: Math.min(1, authored), whiff: 0 };
    case 'projectile':
      // The cast can flow into a buffered action at its authored tail. Its real
      // anti-spam cost is the projectile cooldown and active-entity limit.
      return { hit: authored, block: authored, whiff: authored };
    default:
      return { hit: authored, block: 0, whiff: 0 };
  }
}

function shieldStunFrames(move) {
  const damage = Math.max(0, Number(move.damage) || 0);
  const aerialOrProjectile = move.name?.startsWith('air') || move.projectile;
  const typeMultiplier = aerialOrProjectile ? 0.8 : 1;
  const authoredMultiplier = Math.max(0, Number(move.shieldStunMultiplier ?? 1));
  return Math.max(2, Math.floor(damage * 0.8 * typeMultiplier * authoredMultiplier + 2));
}

function blockLagFrames(move) {
  return Math.max(3, Math.min(8, Math.round((Number(move.hitstop) || 3) * 0.72)));
}

function balanceMoveFrames(name, source, variant = 'normal') {
  const move = { ...source, name };
  const category = moveClass(name, move, variant);
  const threat = threatScore(name, move, variant);
  const windows = contactCancelWindows(category, move);

  // Projectiles are balanced by cast recovery, cooldown, travel and active-count
  // limits. A projectile can touch a shield long after its owner is actionable,
  // so an ordinary point-blank on-shield number is misleading for that class.
  if (category === 'projectile') {
    const whiffTarget = targetWhiffCommitment(category, threat);
    move.recovery = Math.max(move.recovery, whiffTarget - Math.max(0, move.active - 1) + windows.whiff);
  } else if (category === 'jab') {
    // Preserve authored jab rhythm. Unlike finishers, a jab's commitment comes
    // from the short gap before its next string hit rather than extra recovery.
    move.recovery = Math.max(1, move.recovery);
  } else {
    const desiredMinus = targetBlockDisadvantage(category, threat);
    const defenderReady = Math.max(3, (Number(move.hitstop) || 3) - 2) + shieldStunFrames(move);
    const attackerBlockLag = blockLagFrames(move);
    const requiredRecovery = defenderReady + desiredMinus - attackerBlockLag
      - Math.max(0, move.active - 1) + windows.block;
    const whiffTarget = targetWhiffCommitment(category, threat);
    const requiredWhiffRecovery = whiffTarget - Math.max(0, move.active - 1) + windows.whiff;
    move.recovery = Math.max(move.recovery, requiredRecovery, requiredWhiffRecovery);
    if (category === 'aerial') {
      // A falling aerial normally lands before its airborne recovery finishes.
      // Its practical shield safety is therefore governed by landing lag.
      const requiredLandingLag = defenderReady + desiredMinus - attackerBlockLag;
      move.landingLag = Math.max(move.landingLag || 0, requiredLandingLag);
    }
  }

  move.recovery = Math.max(1, Math.round(move.recovery));
  move.hitCancelWindow = Math.min(move.recovery, windows.hit);
  move.blockCancelWindow = Math.min(move.recovery, windows.block);
  move.whiffCancelWindow = Math.min(move.recovery, windows.whiff);
  move.blockLag = blockLagFrames(move);
  move.frameClass = category;
  move.frameThreat = Number(threat.toFixed(2));
  move.targetBlockDisadvantage = category === 'projectile' ? null : targetBlockDisadvantage(category, threat);
  move.targetWhiffCommitment = targetWhiffCommitment(category, threat);
  return move;
}

function frameProfile(name, source, variant = 'normal') {
  const move = balanceMoveFrames(name, source, variant);
  const category = move.frameClass;
  const remainingFromFirstActive = Math.max(0, move.active - 1) + move.recovery;
  const whiffCommitment = remainingFromFirstActive - move.whiffCancelWindow;
  const blockAdvantage = category === 'projectile'
    ? null
    : Math.max(3, (Number(move.hitstop) || 3) - 2) + shieldStunFrames(move)
      - (move.blockLag + remainingFromFirstActive - move.blockCancelWindow);
  const landingBlockAdvantage = category === 'aerial'
    ? Math.max(3, (Number(move.hitstop) || 3) - 2) + shieldStunFrames(move)
      - (move.blockLag + move.landingLag)
    : null;
  return {
    category,
    startup: move.startup,
    active: move.active,
    recovery: move.recovery,
    damage: move.damage,
    reach: Number(effectiveReach(move).toFixed(1)),
    threat: move.frameThreat,
    whiffCommitment,
    blockAdvantage,
    landingLag: move.landingLag || 0,
    landingBlockAdvantage,
    targetBlockDisadvantage: move.targetBlockDisadvantage,
    targetWhiffCommitment: move.targetWhiffCommitment,
    projectileCooldown: move.projectileCooldown || 0,
    maxActiveProjectiles: move.maxActiveProjectiles || 0
  };
}

module.exports = {
  balanceMoveFrames,
  blockLagFrames,
  effectiveReach,
  frameProfile,
  moveClass,
  shieldStunFrames,
  threatScore
};
