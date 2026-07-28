const test = require('node:test');
const assert = require('node:assert/strict');
const { AudioFeedback } = require('../audio-feedback');

test('audio feedback remains inert when muted or WebAudio is unavailable', () => {
  const feedback = new AudioFeedback(null);
  assert.equal(feedback.tone(220, 0.1), false);
  assert.equal(feedback.setMuted(true), true);
  assert.equal(feedback.impact(1), false);
});
