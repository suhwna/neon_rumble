const { createWorld, stepWorld } = require('./engine');
const { FIGHTERS, DEFAULT_RULES } = require('./content');

function runCpuSoak(options = {}) {
  const seeds = options.seeds || [11, 29, 47];
  const ticks = options.ticks || 60 * 180;
  const aggregate = {
    ticks: 0,
    matches: seeds.length,
    actions: {},
    actionsByFighter: Object.fromEntries(FIGHTERS.map(fighter => [fighter.id, {}])),
    hitsByMove: {},
    hitsByFighter: Object.fromEntries(FIGHTERS.map(fighter => [fighter.id, 0])),
    hits: 0,
    kos: 0,
    selfDestructs: 0,
    ledges: 0,
    recoveries: 0,
    winners: {}
  };

  for (const seed of seeds) {
    const roster = FIGHTERS.map((fighter, index) => ({
      slot: index,
      clientId: `cpu:soak-${seed}-${index}`,
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
      rules: { ...DEFAULT_RULES, mode: 'stock', stocks: 9, timeSeconds: Math.max(10, Math.floor(ticks / 60) - 3), items: false, hazards: false }
    });
    let lastEventId = 0;
    for (let frame = 0; frame < ticks && world.phase !== 'ended'; frame++) {
      stepWorld(world);
      aggregate.ticks += 1;
      for (const event of world.events) {
        if (event.id <= lastEventId) continue;
        lastEventId = event.id;
        if (event.type === 'action') {
          const fighter = world.players.find(player => player.i === event.player)?.characterId;
          aggregate.actions[event.action] = (aggregate.actions[event.action] || 0) + 1;
          if (fighter) aggregate.actionsByFighter[fighter][event.action] = (aggregate.actionsByFighter[fighter][event.action] || 0) + 1;
          if (event.action === 'specialUp') aggregate.recoveries += 1;
        } else if (event.type === 'hit') {
          aggregate.hits += 1;
          const fighter = world.players.find(player => player.i === event.attacker)?.characterId;
          const move = event.move || 'unknown';
          aggregate.hitsByMove[move] = (aggregate.hitsByMove[move] || 0) + 1;
          if (fighter) aggregate.hitsByFighter[fighter] += 1;
        }
        else if (event.type === 'ledge') aggregate.ledges += 1;
        else if (event.type === 'ko') {
          aggregate.kos += 1;
          if (event.killer == null || event.killer === event.player) aggregate.selfDestructs += 1;
        }
      }
    }
    const winner = world.players.find(player => player.i === world.winner)?.characterId || 'none';
    aggregate.winners[winner] = (aggregate.winners[winner] || 0) + 1;
  }

  aggregate.selfDestructRate = aggregate.kos ? aggregate.selfDestructs / aggregate.kos : 0;
  aggregate.actionsPerMinute = aggregate.ticks ? Object.values(aggregate.actions).reduce((sum, count) => sum + count, 0) / (aggregate.ticks / 3600) : 0;
  return aggregate;
}

module.exports = { runCpuSoak };
