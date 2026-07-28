const test = require('node:test');
const assert = require('node:assert/strict');
const { runCpuSoak } = require('../simulation-audit');

test('four hard CPUs sustain a varied three-minute brawl without frequent self-destruction', () => {
  const report = runCpuSoak({ seeds: [17], ticks: 60 * 180 });
  const categories = new Set(Object.keys(report.actions).map(action =>
    action.startsWith('special') ? 'special'
      : action.startsWith('air') ? 'air'
        : action === 'grab' ? 'grab'
          : action === 'dashAttack' ? 'dash'
            : action.startsWith('ground') ? 'ground' : 'other'
  ));
  assert.ok(report.hits >= 20, `expected combat activity, saw ${report.hits} hits`);
  assert.ok(categories.has('ground'));
  assert.ok(categories.has('air'));
  assert.ok(categories.has('special'));
  assert.ok(categories.has('grab'));
  assert.ok(report.selfDestructRate <= 0.22, `self-destruct rate ${report.selfDestructRate}`);
});
