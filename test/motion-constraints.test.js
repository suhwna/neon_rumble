const test = require('node:test');
const assert = require('node:assert/strict');
const { constrainPose } = require('../motion-constraints');

test('authored attack poses remain inside readable humanoid bounds', () => {
  const pose = constrainPose({
    bodyX: 90, bodyY: -80, rotation: 2.4,
    scaleX: 2, scaleY: .2,
    frontHandX: 120, frontHandY: -100,
    backHandX: -120, backHandY: 90,
    frontFootX: 100, backFootX: -100,
    frontFootLift: 90, backFootLift: -20
  });
  assert.equal(pose.bodyX, 27);
  assert.equal(pose.rotation, .58);
  assert.equal(pose.scaleX, 1.36);
  assert.equal(pose.scaleY, .7);
  assert.equal(pose.frontHandX, 68);
  assert.equal(pose.backFootX, -57);
  assert.equal(pose.backFootLift, 0);
});

test('intentional spin actions preserve full rotation', () => {
  assert.equal(constrainPose({ rotation: Math.PI * 2 }, { spinning: true }).rotation, Math.PI * 2);
});
