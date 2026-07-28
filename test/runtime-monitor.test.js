const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeMonitor } = require('../runtime-monitor');

test('runtime monitor samples frames, snapshots, slow frames, and resets its window', () => {
  const monitor = new RuntimeMonitor(0);
  for (let frame = 0; frame < 60; frame++) {
    monitor.snapshot();
    assert.equal(monitor.frame(frame * 16, frame === 10 ? 30 : 16), null);
  }
  const sample = monitor.frame(1_010, 16, { players: 4 });
  assert.ok(sample.fps > 55);
  assert.ok(sample.snapshotHz > 55);
  assert.equal(sample.slowFrames, 1);
  assert.equal(sample.players, 4);
  assert.equal(monitor.frames, 0);
});
