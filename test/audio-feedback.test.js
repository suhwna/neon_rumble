const test = require('node:test');
const assert = require('node:assert/strict');
const { AudioFeedback } = require('../audio-feedback');

test('audio feedback remains inert when muted or WebAudio is unavailable', () => {
  const feedback = new AudioFeedback(null);
  assert.equal(feedback.tone(220, 0.1), false);
  assert.equal(feedback.setMuted(true), true);
  assert.equal(feedback.impact(1), false);
});

test('impact feedback layers a short contact click over the launch body', () => {
  const feedback = new AudioFeedback(null);
  const tones = [];
  feedback.tone = (...args) => { tones.push(args); return true; };
  assert.equal(feedback.impact(1.1, { sweet: true }), true);
  assert.equal(tones.length, 2);
  assert.equal(tones[0][2], 'square');
  assert.equal(tones[1][2], 'square');
  assert.ok(tones[1][1] < tones[0][1], 'contact click must end before the launch body');

  tones.length = 0;
  feedback.impact(.4, { pummel: true });
  assert.equal(tones.length, 1, 'rapid pummels stay single-layered');
});
