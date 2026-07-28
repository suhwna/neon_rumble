const test = require('node:test');
const assert = require('node:assert/strict');
const MOTION = require('../motion-data.js');

const ACTIONS = [
  'groundNeutral', 'groundSide', 'groundUp', 'groundDown', 'dashAttack',
  'airNeutral', 'airForward', 'airBack', 'airUp', 'airDown',
  'specialNeutral', 'specialSide', 'specialUp', 'specialDown'
];

test('every fighter owns finite per-move silhouette profiles', () => {
  for (const fighter of ['volt', 'blaze', 'bolt', 'nova']) {
    const signatures = new Set();
    for (const action of ACTIONS) {
      const profile = MOTION.profileFor(fighter, action);
      assert.ok(profile, `${fighter} ${action} profile missing`);
      for (const phase of ['windup', 'active', 'recovery']) {
        assert.ok(Object.values(profile[phase]).every(Number.isFinite), `${fighter} ${action} ${phase}`);
      }
      signatures.add(JSON.stringify(profile.active));
    }
    assert.equal(signatures.size, ACTIONS.length, `${fighter} should not reuse active silhouettes`);
  }
});

test('the same action has a distinct active silhouette for every fighter', () => {
  for (const action of ACTIONS) {
    const signatures = new Set(
      ['volt', 'blaze', 'bolt', 'nova'].map(fighter => JSON.stringify(MOTION.profileFor(fighter, action).active))
    );
    assert.equal(signatures.size, 4, `${action} must differ by fighter`);
  }
});
