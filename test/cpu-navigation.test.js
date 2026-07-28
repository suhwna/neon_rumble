const test = require('node:test');
const assert = require('node:assert/strict');
const { selectRecoveryTarget, isOffstage } = require('../cpu-navigation');

const platforms = [
  { id: 'main', x: 200, y: 500, w: 880, passThrough: false },
  { id: 'upper', x: 500, y: 320, w: 220, passThrough: true }
];

test('CPU recovery prefers a solid ledge when below the stage', () => {
  const target = selectRecoveryTarget(platforms, { x: 120, y: 570 });
  assert.equal(target.platform.id, 'main');
  assert.equal(target.x, 192);
});

test('offstage detection ignores overhead pass-through platforms', () => {
  assert.equal(isOffstage(platforms, { x: 640, y: 420, grounded: false, ledge: null }), false);
  assert.equal(isOffstage(platforms, { x: 90, y: 560, grounded: false, ledge: null }), true);
});
