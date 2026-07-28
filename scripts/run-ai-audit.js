const { runCpuSoak } = require('../simulation-audit');

const report = runCpuSoak({
  seeds: [11, 17, 23, 29, 37, 43, 47, 59, 67, 71, 83, 97],
  ticks: 60 * 300
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
  actionsByFighter: report.actionsByFighter
}, null, 2));
