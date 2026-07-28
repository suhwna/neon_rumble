const test = require('node:test');
const assert = require('node:assert/strict');
const { selectCpuTarget, findIncomingThreat } = require('../cpu-combat');

function player(i, x, overrides = {}) {
  return {
    i, x, y: 400, width: 42, height: 74, team: i,
    eliminated: false, respawn: 0, action: null, stun: 0,
    landingLag: 0, comboTimer: 0, comboAttacker: null,
    characterId: 'volt', damage: 0, ...overrides
  };
}

test('free-for-all target selection respects an existing target lock', () => {
  const self = player(0, 100);
  const locked = player(1, 500);
  const near = player(2, 140);
  const brain = { targetId: 1, targetLockUntil: 80 };
  const world = { tick: 20, players: [self, locked, near], rules: { teams: false }, cpuBrains: new Map() };
  assert.equal(selectCpuTarget(world, self, brain), locked);
});

test('incoming projectile threat only reports projectiles moving toward the CPU', () => {
  const self = player(0, 400);
  const owner = player(1, 700);
  const world = {
    players: [self, owner],
    rules: { teams: false },
    entities: [{ owner: 1, type: 'projectile', x: 610, y: 400, vx: -220 }]
  };
  assert.deepEqual(findIncomingThreat(world, self, owner), { kind: 'projectile', direction: 1 });
  world.entities[0].vx = 220;
  assert.equal(findIncomingThreat(world, self, owner), null);
});
