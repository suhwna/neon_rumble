const test = require('node:test');
const assert = require('node:assert/strict');
const { BUTTONS } = require('../content');
const { planCpuRecovery } = require('../cpu-recovery');

const profile = { defense: .72, accuracy: .95 };
const bounds = { worldWidth: 1280, marginX: 360, bottom: 980 };
const platforms = [{ id: 'main', x: 210, y: 500, w: 860, h: 22 }];

test('CPU recovery spends its air jump before its single-use special', () => {
  const world = { platforms, rng: () => .9 };
  const player = {
    x: 90, y: 610, vy: 180, face: 1, ledge: null, stun: 0,
    freefall: false, jumps: 1, recoveryAvailable: true, airDodgeAvailable: true
  };
  const planned = planCpuRecovery(world, player, profile, bounds);
  assert.equal(planned.vertical, -1);
  assert.equal(planned.actions & BUTTONS.SPECIAL, 0);
});

test('CPU recovery uses up special after the air jump is gone', () => {
  const world = { platforms, rng: () => .9 };
  const player = {
    x: 90, y: 640, vy: 180, face: 1, ledge: null, stun: 0,
    freefall: false, jumps: 0, recoveryAvailable: true, airDodgeAvailable: true
  };
  const planned = planCpuRecovery(world, player, profile, bounds);
  assert.equal(planned.vertical, -1);
  assert.ok(planned.actions & BUTTONS.SPECIAL);
});

test('NOVA releases a charged recovery when the required route is covered', () => {
  const world = { platforms, rng: () => .9 };
  const player = {
    characterId: 'nova',
    x: 110, y: 590, vy: 0, face: 1, ledge: null, stun: 0,
    freefall: false, jumps: 0, recoveryAvailable: true, airDodgeAvailable: true,
    action: {
      name: 'specialUp',
      chargeProgress: .88,
      move: { distanceCharge: true }
    }
  };
  const planned = planCpuRecovery(world, player, profile, bounds);
  assert.equal(planned.vertical, -1);
  assert.equal(planned.actions & BUTTONS.SPECIAL, 0);
});
