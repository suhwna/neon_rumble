const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CPU_PROFILES,
  blazeTargetPriorityBonus,
  blazeAirNeutralWanted,
  blazeNeutralChargeFrames
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
