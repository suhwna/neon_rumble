const test = require('node:test');
const assert = require('node:assert/strict');
const { layerOrder, cue, crowding } = require('../combat-readability');

test('active attacks and hit reactions draw above neutral fighters without slot priority', () => {
  const players = [
    { i: 0, actionName: 'idle', y: 400 },
    { i: 1, actionName: 'groundSide', actionPhase: 'active', y: 400 },
    { i: 2, actionName: 'groundHit', y: 400 },
    { i: 3, actionName: 'walk', y: 400 }
  ];
  assert.deepEqual(layerOrder(players).map(player => player.i), [0, 3, 1, 2]);
  assert.equal(cue(players[1]), 'active');
  assert.equal(cue(players[2]), 'hit');
});

test('crowding only strengthens silhouettes for spatially overlapping fighters', () => {
  const players = [
    { i: 0, x: 400, y: 300 },
    { i: 1, x: 438, y: 315 },
    { i: 2, x: 367, y: 278 },
    { i: 3, x: 700, y: 300 }
  ];
  assert.equal(crowding(players[0], players), 2);
  assert.equal(crowding(players[3], players), 0);
  players[2].eliminated = true;
  assert.equal(crowding(players[0], players), 1);
});
