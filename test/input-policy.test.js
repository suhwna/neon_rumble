const test = require('node:test');
const assert = require('node:assert/strict');
const { KeyboardIntentTracker, InputTransportPolicy } = require('../input-policy');

test('keyboard intent separates walk, held run, and double-tap dash pulses', () => {
  const tracker = new KeyboardIntentTracker();
  const keys = new Set(['ArrowRight']);
  tracker.keyDown('ArrowRight', 0);
  assert.equal(tracker.horizontal(keys, 20), 0.62);
  assert.equal(tracker.horizontal(keys, 160), 1);
  keys.add('ControlLeft');
  assert.equal(tracker.horizontal(keys, 165), 0.44);
  keys.delete('ControlLeft');
  tracker.keyUp('ArrowRight', 170);
  tracker.keyDown('ArrowRight', 230);
  assert.equal(tracker.horizontal(keys, 235), 1);
});

test('precision modifier overrides a double-tap dash until released', () => {
  const tracker = new KeyboardIntentTracker();
  const keys = new Set(['ArrowRight', 'ControlLeft']);
  tracker.keyDown('ArrowRight', 100);
  tracker.keyUp('ArrowRight', 130);
  tracker.keyDown('ArrowRight', 180);
  assert.equal(tracker.horizontal(keys, 185), 0.44);
  keys.delete('ControlLeft');
  assert.equal(tracker.horizontal(keys, 190), 1);
});

test('input transport makes state edges reliable and sustained frames volatile', () => {
  const metrics = {};
  const policy = new InputTransportPolicy(metrics);
  assert.equal(policy.channel({ buttons: 0, horizontal: 0, vertical: 0 }), 'reliable');
  assert.equal(policy.channel({ buttons: 0, horizontal: 0, vertical: 0 }), 'volatile');
  assert.equal(policy.channel({ buttons: 1, horizontal: 0, vertical: 0 }), 'reliable');
  assert.equal(policy.channel({ buttons: 1, horizontal: 0.6, vertical: 0 }), 'reliable');
  assert.equal(policy.channel({ buttons: 1, horizontal: 1, vertical: 0 }), 'volatile');
  assert.deepEqual(metrics, { reliableInputs: 3, volatileInputs: 2 });
});
