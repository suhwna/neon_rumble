const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { StatsStore } = require('../store');

test('SQLite store persists anonymous player and match statistics', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-store-'));
  const store = new StatsStore(path.join(directory, 'test.sqlite'));
  store.ensurePlayer('p1', 'Alpha'); store.ensurePlayer('p2', 'Beta');
  const world = {
    tick: 3600, winner: 0, rules: { mode: 'stock', stageId: 'neon-deck' },
    players: [
      { i: 0, characterId: 'volt', eliminated: false, stocks: 1, falls: 2, kos: 3, score: 3 },
      { i: 1, characterId: 'blaze', eliminated: true, stocks: 0, falls: 3, kos: 2, score: 2 }
    ]
  };
  store.recordMatch('ABCDE', world, [{ index: 0, clientId: 'p1' }, { index: 1, clientId: 'p2' }]);
  assert.deepEqual(store.getPlayer('p1'), { id: 'p1', nickname: 'Alpha', matches: 1, wins: 1, kos: 3, falls: 2 });
  assert.equal(store.getPlayer('p2').wins, 0);
  store.close(); fs.rmSync(directory, { recursive: true, force: true });
});
