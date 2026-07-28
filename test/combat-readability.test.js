const test = require('node:test');
const assert = require('node:assert/strict');
const { layerOrder, cue } = require('../combat-readability');

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
