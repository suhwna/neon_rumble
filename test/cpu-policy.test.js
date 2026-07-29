const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../cpu-policy');

test('CPU profiles preserve ordered reaction and aggression levels', () => {
  assert.ok(CPU_PROFILES.hard.reaction < CPU_PROFILES.normal.reaction);
  assert.ok(CPU_PROFILES.hard.aggression > CPU_PROFILES.normal.aggression);
});

test('BLAZE prioritizes damaged targets without biasing fresh stocks', () => {
  assert.equal(blazeTargetPriorityBonus(60), 0);
  assert.ok(blazeTargetPriorityBonus(120) > blazeTargetPriorityBonus(90));
});

test('BLAZE air-neutral policy reacts to close crowds and attack pressure', () => {
  assert.equal(blazeAirNeutralWanted({
    distance: 82, verticalGap: 20, nearbyEnemies: 2, targetAttacking: false, roll: .7
  }), true);
  assert.equal(blazeAirNeutralWanted({
    distance: 130, verticalGap: 20, nearbyEnemies: 3, targetAttacking: true, roll: 0
  }), false);
});

test('BLAZE charges neutral special only at useful spacing', () => {
  assert.equal(blazeNeutralChargeFrames({ distance: 180, targetRecovering: false }), 1);
  assert.equal(blazeNeutralChargeFrames({ distance: 320, targetRecovering: false }), 12);
  assert.equal(blazeNeutralChargeFrames({ distance: 430, targetRecovering: false }), 18);
});

test('shared combat policy keeps character power out of AI-only spacing rules', () => {
  assert.equal(chooseCombatPlan({
    fighterId: 'blaze', targetShielding: false, targetVulnerable: false,
    quietFrames: 8, projectileReady: false, distance: 120,
    playerDamage: 105, targetDamage: 76
  }), 'pressure');
  assert.equal(fighterDefenseChance(.72, 'blaze', 105), fighterDefenseChance(.72, 'volt', 105));
  assert.equal(preferredCombatRange({
    fighterId: 'blaze', plan: 'bait', pressuring: false, projectileFighter: true
  }), 124);
});

test('BLAZE closes mid range and reserves zoning for deliberate long range', () => {
  assert.equal(chooseCombatPlan({
    fighterId: 'blaze', targetShielding: false, targetVulnerable: false,
    quietFrames: 8, projectileReady: true, distance: 220,
    playerDamage: 40, targetDamage: 50
  }), 'pressure');
  assert.equal(chooseCombatPlan({
    fighterId: 'blaze', targetShielding: false, targetVulnerable: false,
    quietFrames: 8, projectileReady: true, distance: 380,
    playerDamage: 40, targetDamage: 50
  }), 'zone');
});

test('situational normals answer anti-air, low catch, and real air scrambles', () => {
  assert.equal(situationalAttackChoice({
    grounded: true, distance: 86, verticalGap: -55, targetGrounded: false, targetVy: 120
  }).reason, 'anti-air');
  assert.equal(situationalAttackChoice({
    grounded: true, distance: 84, verticalGap: 8, targetGrounded: true, targetLandingLag: 8
  }).reason, 'low-catch');
  assert.equal(situationalAttackChoice({
    grounded: false, distance: 62, verticalGap: 18, targetGrounded: false, nearbyEnemies: 1
  }).reason, 'air-scramble');
  assert.equal(situationalAttackChoice({
    grounded: false, distance: 110, verticalGap: 18, targetGrounded: false, nearbyEnemies: 1
  }), null);
});

test('NOVA recovery charge scales with the route but releases before maximum', () => {
  const shortRoute = novaRecoveryChargeTarget({ horizontalGap: 65, heightBelow: 10 });
  const longRoute = novaRecoveryChargeTarget({ horizontalGap: 230, heightBelow: 150 });
  assert.ok(shortRoute < longRoute);
  assert.ok(longRoute <= .9);
});

test('BOLT boomerang plan observes tactical intent and a real decision cooldown', () => {
  assert.equal(boltBoomerangWanted({ plan: 'pressure', tick: 90, cooldownUntil: 0, difficulty: 'hard', roll: 0 }), false);
  assert.equal(boltBoomerangWanted({ plan: 'zone', tick: 40, cooldownUntil: 60, difficulty: 'hard', roll: 0 }), false);
  assert.equal(boltBoomerangWanted({ plan: 'zone', tick: 90, cooldownUntil: 60, difficulty: 'hard', roll: .2 }), true);
});
