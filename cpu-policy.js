const CPU_PROFILES = Object.freeze({
  easy: Object.freeze({ reaction: 10, aggression: .48, defense: .18, accuracy: .56, edgeguard: .15 }),
  normal: Object.freeze({ reaction: 6, aggression: .72, defense: .43, accuracy: .79, edgeguard: .4 }),
  hard: Object.freeze({ reaction: 4, aggression: .9, defense: .72, accuracy: .95, edgeguard: .68 })
});

function blazeTargetPriorityBonus(targetDamage) {
  return Math.max(0, Number(targetDamage) - 72) * 1.15;
}

function blazeAirNeutralWanted({ distance, verticalGap, nearbyEnemies, targetAttacking, roll }) {
  if (distance > 104 || Math.abs(verticalGap) > 74) return false;
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
  if (projectileReady && distance > 145) return 'zone';
  return 'pressure';
}

function fighterDefenseChance(baseChance, fighterId, damage, forcingInitiative = false) {
  return forcingInitiative ? baseChance * .68 : baseChance;
}

function preferredCombatRange({ fighterId, plan, pressuring, projectileFighter }) {
  if (pressuring) return 78;
  if (plan === 'zone' && projectileFighter) return 165;
  return 112;
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
  boltBoomerangWanted
};
