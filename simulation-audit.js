const { createWorld, stepWorld } = require('./engine');
const { FIGHTERS, STAGES, DEFAULT_RULES } = require('./content');

function createStats(matches = 0) {
  return {
    ticks: 0,
    matches,
    actions: {},
    actionsByFighter: Object.fromEntries(FIGHTERS.map(fighter => [fighter.id, {}])),
    hitsByMove: {},
    hitsByFighter: Object.fromEntries(FIGHTERS.map(fighter => [fighter.id, 0])),
    kosByFighter: Object.fromEntries(FIGHTERS.map(fighter => [fighter.id, 0])),
    deathsByFighter: Object.fromEntries(FIGHTERS.map(fighter => [fighter.id, 0])),
    selfDestructsByFighter: Object.fromEntries(FIGHTERS.map(fighter => [fighter.id, 0])),
    hits: 0,
    kos: 0,
    selfDestructs: 0,
    ledges: 0,
    recoveries: 0,
    winners: {}
  };
}

function increment(stats, key, amount = 1) {
  stats[key] = (stats[key] || 0) + amount;
}

function finalizeStats(stats) {
  stats.selfDestructRate = stats.kos ? stats.selfDestructs / stats.kos : 0;
  stats.actionsPerMinute = stats.ticks
    ? Object.values(stats.actions).reduce((sum, count) => sum + count, 0) / (stats.ticks / 3600)
    : 0;
  return stats;
}

function runCpuSoak(options = {}) {
  const seeds = options.seeds || [11, 29, 47];
  const ticks = options.ticks || 60 * 180;
  const stocks = Math.max(1, Number(options.stocks) || 9);
  const timeSeconds = Math.max(10, Number(options.timeSeconds) || Math.floor(ticks / 60) - 3);
  const validStageIds = new Set(STAGES.map(stage => stage.id));
  const requestedStages = options.stageIds || [options.stageId || DEFAULT_RULES.stageId];
  const stageIds = [...new Set(requestedStages)].filter(stageId => validStageIds.has(stageId));
  if (!stageIds.length) stageIds.push(DEFAULT_RULES.stageId);
  const aggregate = createStats(seeds.length * stageIds.length);
  aggregate.byStage = Object.fromEntries(stageIds.map(stageId => [stageId, createStats(seeds.length)]));

  for (const stageId of stageIds) {
    const stageStats = aggregate.byStage[stageId];
    for (const seed of seeds) {
    const roster = FIGHTERS.map((fighter, index) => ({
      slot: index,
      clientId: `cpu:soak-${stageId}-${seed}-${index}`,
      nickname: `CPU ${fighter.id}`,
      characterId: fighter.id,
      palette: index,
      team: index
    }));
    const world = createWorld({
      seed,
      cpu: 'hard',
      roster,
      // The requested budget includes the three-second countdown, so the
      // active match expires within the audit loop instead of producing an
      // artificial "none" winner with three seconds left.
      rules: { ...DEFAULT_RULES, mode: 'stock', stocks, timeSeconds, items: false, hazards: false, stageId }
    });
    let lastEventId = 0;
    for (let frame = 0; frame < ticks && world.phase !== 'ended'; frame++) {
      stepWorld(world);
      aggregate.ticks += 1;
      stageStats.ticks += 1;
      for (const event of world.events) {
        if (event.id <= lastEventId) continue;
        lastEventId = event.id;
        if (event.type === 'action') {
          const fighter = world.players.find(player => player.i === event.player)?.characterId;
          for (const stats of [aggregate, stageStats]) {
            increment(stats.actions, event.action);
            if (fighter) increment(stats.actionsByFighter[fighter], event.action);
            if (event.action === 'specialUp') stats.recoveries += 1;
          }
        } else if (event.type === 'hit') {
          const fighter = world.players.find(player => player.i === event.attacker)?.characterId;
          const move = event.move || 'unknown';
          for (const stats of [aggregate, stageStats]) {
            stats.hits += 1;
            increment(stats.hitsByMove, move);
            if (fighter) stats.hitsByFighter[fighter] += 1;
          }
        }
        else if (event.type === 'ledge') {
          aggregate.ledges += 1;
          stageStats.ledges += 1;
        }
        else if (event.type === 'ko') {
          const victim = world.players.find(player => player.i === event.player)?.characterId;
          const killer = world.players.find(player => player.i === event.killer)?.characterId;
          const selfDestruct = event.killer == null || event.killer === event.player;
          for (const stats of [aggregate, stageStats]) {
            stats.kos += 1;
            if (victim) stats.deathsByFighter[victim] += 1;
            if (killer && !selfDestruct) stats.kosByFighter[killer] += 1;
            if (selfDestruct) {
              stats.selfDestructs += 1;
              if (victim) stats.selfDestructsByFighter[victim] += 1;
            }
          }
        }
      }
    }
    const winner = world.players.find(player => player.i === world.winner)?.characterId || 'none';
    increment(aggregate.winners, winner);
    increment(stageStats.winners, winner);
    }
    finalizeStats(stageStats);
  }

  return finalizeStats(aggregate);
}

module.exports = { runCpuSoak };
