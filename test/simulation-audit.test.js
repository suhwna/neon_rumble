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

test('CPU audit reports independent results for every requested stage', () => {
  const stageIds = ['neon-deck', 'sky-rail', 'reactor-core'];
  const report = runCpuSoak({ seeds: [23], ticks: 60 * 45, stageIds });
  assert.equal(report.matches, 3);
  assert.deepEqual(Object.keys(report.byStage), stageIds);
  for (const stageId of stageIds) {
    assert.equal(report.byStage[stageId].matches, 1);
    assert.ok(report.byStage[stageId].ticks > 0);
    assert.ok(report.byStage[stageId].hits > 0, `${stageId} produced no hits`);
  }
});

test('CPU audit can use the real three-stock ruleset for outcome statistics', () => {
  const report = runCpuSoak({
    seeds: [31], ticks: 60 * 120, stocks: 3, timeSeconds: 120, stageIds: ['neon-deck']
  });
  assert.equal(report.matches, 1);
  assert.ok(Object.values(report.winners).reduce((sum, wins) => sum + wins, 0) === 1);
  assert.ok(report.kos > 0);
});
