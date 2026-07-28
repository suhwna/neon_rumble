const { runCpuSoak } = require('../simulation-audit');

const report = runCpuSoak({
  seeds: [11, 17, 23, 29, 37, 43, 47, 59, 67, 71, 83, 97],
  ticks: 60 * 420,
  stocks: 3,
  timeSeconds: 420,
  stageIds: ['neon-deck', 'sky-rail', 'reactor-core']
});

const moveTotal = Object.values(report.actions).reduce((sum, count) => sum + count, 0);
const topMoves = Object.entries(report.actions)
  .sort((first, second) => second[1] - first[1])
  .slice(0, 12)
  .map(([move, count]) => ({ move, count, share: `${(count / Math.max(1, moveTotal) * 100).toFixed(1)}%` }));

console.log(JSON.stringify({
  simulatedMinutes: +(report.ticks / 3600).toFixed(1),
  matches: report.matches,
  hits: report.hits,
  kos: report.kos,
  selfDestructRate: `${(report.selfDestructRate * 100).toFixed(1)}%`,
  ledgeGrabs: report.ledges,
  recoverySpecials: report.recoveries,
  actionsPerMinute: +report.actionsPerMinute.toFixed(1),
  winners: report.winners,
  topMoves,
  hitsByMove: report.hitsByMove,
  hitsByFighter: report.hitsByFighter,
  kosByFighter: report.kosByFighter,
  deathsByFighter: report.deathsByFighter,
  selfDestructsByFighter: report.selfDestructsByFighter,
  actionsByFighter: report.actionsByFighter,
  byStage: Object.fromEntries(Object.entries(report.byStage).map(([stageId, stats]) => [stageId, {
    simulatedMinutes: +(stats.ticks / 3600).toFixed(1),
    winners: stats.winners,
    hits: stats.hits,
    hitsByFighter: stats.hitsByFighter,
    kosByFighter: stats.kosByFighter,
    deathsByFighter: stats.deathsByFighter,
    selfDestructsByFighter: stats.selfDestructsByFighter,
    kos: stats.kos,
    selfDestructRate: `${(stats.selfDestructRate * 100).toFixed(1)}%`,
    ledgeGrabs: stats.ledges,
    recoverySpecials: stats.recoveries
  }]))
}, null, 2));
