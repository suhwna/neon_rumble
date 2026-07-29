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

test('every authored move exposes finite human joint bends', () => {
  for (const fighter of ['volt', 'blaze', 'bolt', 'nova']) {
    for (const action of ACTIONS) {
      const joints = MOTION.jointFor(fighter, action);
      assert.ok(joints, `${fighter}.${action} joints`);
      assert.ok(Object.values(joints).every(Number.isFinite), `${fighter}.${action} finite joints`);
      assert.ok(Object.values(joints).some(value => Math.abs(value) >= 2), `${fighter}.${action} visible bend`);
    }
  }
});

test('joint motion anticipates, strikes, and settles instead of snapping backward', () => {
  const startup = MOTION.jointFor('volt', 'groundSide', 'startup', 1);
  const active = MOTION.jointFor('volt', 'groundSide', 'active', .5);
  const earlyRecovery = MOTION.jointFor('volt', 'groundSide', 'recovery', 0);
  const lateRecovery = MOTION.jointFor('volt', 'groundSide', 'recovery', 1);
  assert.ok(startup.frontElbowX * active.frontElbowX <= 0, 'startup anticipates opposite the strike');
  assert.ok(Math.abs(earlyRecovery.frontElbowX) > Math.abs(lateRecovery.frontElbowX), 'recovery settles over time');
});

test('visual transitions stay inside the gameplay phase budget', () => {
  for (const fighter of ['volt', 'blaze', 'bolt', 'nova']) {
    for (const kind of ['entry', 'active', 'phase']) {
      const duration = MOTION.transitionFor(fighter, kind, 3);
      assert.ok(Number.isFinite(duration));
      assert.ok(duration >= 12);
      assert.ok(duration <= 50);
    }
  }
});

test('fighters use distinct bounded render transition styles', () => {
  const signatures = new Set();
  for (const fighter of ['volt', 'blaze', 'bolt', 'nova']) {
    const style = MOTION.styleFor(fighter);
    assert.ok(Object.values(style).every(Number.isFinite), `${fighter} finite style`);
    assert.ok(style.activeMs >= 12 && style.activeMs <= 24, `${fighter} active pose stays responsive`);
    assert.ok(style.phaseMs >= style.activeMs && style.phaseMs <= 40, `${fighter} phase blend`);
    assert.ok(style.entryMs >= style.phaseMs && style.entryMs <= 80, `${fighter} action blend`);
    signatures.add(JSON.stringify(style));
  }
  assert.equal(signatures.size, 4, 'each fighter should carry a distinct motion cadence');
});
