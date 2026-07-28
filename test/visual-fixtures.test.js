const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../visual-fixtures');
const { FIGHTERS, STAGES, DEFAULT_RULES } = require('../content');

test('motion fixtures create four isolated aerial fighters with authored phases', () => {
  const fixture = build('motion:airNeutral:active', {
    fighters: FIGHTERS, stages: STAGES, defaultRules: DEFAULT_RULES, shieldMax: 50
  });
  assert.equal(fixture.players.length, 4);
  assert.equal(fixture.players.every(player => !player.grounded && player.platformId == null), true);
  assert.equal(fixture.players.every(player => player.actionName === 'airNeutral'), true);
  assert.equal(fixture.players.every(player => player.actionPhase === 'active'), true);
});

test('impact fixture retains two attackers and two victims without game globals', () => {
  const fixture = build('four-player-impact', {
    fighters: FIGHTERS, stages: STAGES, defaultRules: DEFAULT_RULES, shieldMax: 50
  });
  assert.deepEqual(fixture.players.map(player => player.actionName), [
    'groundSide', 'groundHit', 'groundDown', 'groundHit'
  ]);
  assert.equal(fixture.camera.zoom, 1.12);
});
