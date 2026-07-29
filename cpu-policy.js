const CPU_PROFILES = Object.freeze({
  easy: Object.freeze({ reaction: 10, aggression: .48, defense: .18, accuracy: .56, edgeguard: .15 }),
  normal: Object.freeze({ reaction: 6, aggression: .72, defense: .43, accuracy: .79, edgeguard: .4 }),
  hard: Object.freeze({ reaction: 4, aggression: .9, defense: .72, accuracy: .95, edgeguard: .68 })
});

function blazeTargetPriorityBonus(targetDamage) {
  return Math.max(0, Number(targetDamage) - 72) * 1.15;
}

function blazeAirNeutralWanted({ distance, verticalGap, nearbyEnemies, targetAttacking, roll }) {
  if (distance > 112 || Math.abs(verticalGap) > 80) return false;
  const urgency = nearbyEnemies >= 2 || targetAttacking ? .82 : .52;
  return roll < urgency;
}

function blazeNeutralChargeFrames({ distance, targetRecovering }) {
  if (targetRecovering) return 8;
  if (distance >= 390) return 18;
  if (distance >= 285) return 12;
  return 1;
}

function chooseCombatPlan({
  fighterId, targetShielding, targetVulnerable, quietFrames,
  projectileReady, distance, playerDamage, targetDamage
}) {
  if (targetShielding || targetVulnerable || quietFrames >= 54) return 'pressure';
  if (playerDamage > targetDamage + 38) return 'bait';
  // BLAZE's projectile is a deliberate long-range callout, not its default
  // neutral. Zoning at mid range made the heavyweight stop just outside the
  // reach where its armored approach and large normals become useful.
  if (fighterId === 'blaze') return projectileReady && distance >= 315 ? 'zone' : 'pressure';
  if (projectileReady && distance > 145) return 'zone';
  return 'pressure';
}

function fighterDefenseChance(baseChance, fighterId, damage, forcingInitiative = false) {
  return forcingInitiative ? baseChance * .68 : baseChance;
}

function preferredCombatRange({ fighterId, plan, pressuring, projectileFighter }) {
  if (fighterId === 'blaze') {
    if (pressuring) return 88;
    if (plan === 'zone' && projectileFighter) return 215;
    return 124;
  }
  if (pressuring) return 78;
  if (plan === 'zone' && projectileFighter) return 165;
  return 112;
}

function situationalAttackChoice({
  grounded, distance, verticalGap, targetGrounded, targetVy = 0,
  targetActionName = '', targetKnockdownFrames = 0, targetLandingLag = 0,
  nearbyEnemies = 0
}) {
  if (grounded) {
    const descendingAbove = !targetGrounded && verticalGap < -28 && targetVy >= -90;
    if (descendingAbove && distance < 112) return Object.freeze({ horizontal: 0, vertical: -1, reason: 'anti-air' });
    const lowTarget = targetGrounded && (
      targetKnockdownFrames > 0
      || targetLandingLag >= 6
      || ['crouch', 'crawl', 'spotDodge'].includes(targetActionName)
    );
    if (lowTarget && distance > 48 && distance < 112) return Object.freeze({ horizontal: 0, vertical: 1, reason: 'low-catch' });
    return null;
  }
  const airScramble = distance < 76 && Math.abs(verticalGap) < 50 && nearbyEnemies >= 1;
  return airScramble ? Object.freeze({ horizontal: 0, vertical: 0, reason: 'air-scramble' }) : null;
}

function novaRecoveryChargeTarget({ horizontalGap, heightBelow, emergency = false }) {
  const horizontalNeed = Math.max(0, Math.min(1, (Number(horizontalGap) - 36) / 220));
  const verticalNeed = Math.max(0, Math.min(1, (Number(heightBelow) + 28) / 190));
  return Math.max(.32, Math.min(.9, Math.max(horizontalNeed, verticalNeed, emergency ? .56 : 0)));
}

function boltBoomerangWanted({ plan, tick, cooldownUntil, difficulty, roll }) {
  if (plan !== 'zone' || tick < cooldownUntil) return false;
  return roll < (difficulty === 'hard' ? .62 : .42);
}

module.exports = {
  CPU_PROFILES,
  blazeTargetPriorityBonus,
  blazeAirNeutralWanted,
  blazeNeutralChargeFrames,
  chooseCombatPlan,
  fighterDefenseChance,
  preferredCombatRange,
  situationalAttackChoice,
  novaRecoveryChargeTarget,
  boltBoomerangWanted
};
