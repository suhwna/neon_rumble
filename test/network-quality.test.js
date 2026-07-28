const test = require('node:test');
const assert = require('node:assert/strict');
const { NetworkQualityTracker } = require('../network-quality.js');

const metrics = () => ({
  inputAckMs: 0, correctionPx: 0, correctionPeakPx: 0, hardCorrections: 0
});

test('network tracker measures newest acknowledged input without stale queue bias', () => {
  const output = metrics(), tracker = new NetworkQualityTracker(output);
  tracker.sent(1, 100);
  tracker.sent(2, 130);
  tracker.sent(3, 160);
  assert.equal(tracker.acknowledged(2, 250), 120);
  assert.equal(tracker.pending.has(1), false);
  assert.equal(tracker.pending.has(2), false);
  assert.equal(tracker.pending.has(3), true);
});

test('network tracker records smooth and hard correction budgets', () => {
  const output = metrics(), tracker = new NetworkQualityTracker(output);
  assert.equal(tracker.correction(20, 100), null);
  assert.equal(output.hardCorrections, 0);
  assert.equal(tracker.correction(110, 400), 0.45);
  assert.equal(output.hardCorrections, 1);
  tracker.correction(120, 500);
  assert.equal(output.hardCorrections, 1, 'one correction episode should not count every frame');
  assert.equal(tracker.correction(240, 800), 1);
  assert.equal(output.emergencyCorrections, 1);
  assert.equal(output.correctionPeakPx, 240);
});
