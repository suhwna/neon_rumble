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
  }), 112);
});

test('BOLT boomerang plan observes tactical intent and a real decision cooldown', () => {
  assert.equal(boltBoomerangWanted({ plan: 'pressure', tick: 90, cooldownUntil: 0, difficulty: 'hard', roll: 0 }), false);
  assert.equal(boltBoomerangWanted({ plan: 'zone', tick: 40, cooldownUntil: 60, difficulty: 'hard', roll: 0 }), false);
  assert.equal(boltBoomerangWanted({ plan: 'zone', tick: 90, cooldownUntil: 60, difficulty: 'hard', roll: .2 }), true);
});
