'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BUTTONS, FIGHTERS } = require('../content');
const { balanceMoveFrames, frameProfile } = require('../frame-balance');
const { createWorld, stepWorld } = require('../engine');

const input = (seq, buttons = 0, horizontal = 0, vertical = 0) => ({
  seq, clientTime: seq * 16, buttons, pressedButtons: buttons, releasedButtons: 0, horizontal, vertical
});

function duel() {
  const world = createWorld({
    rules: { mode: 'training', stocks: 3 },
    roster: [
      { slot: 0, clientId: 'attacker', characterId: 'volt' },
      { slot: 1, clientId: 'defender', characterId: 'blaze' }
    ]
  });
  world.phase = 'active';
  const platform = world.platforms[0];
  for (const player of world.players) {
    player.y = platform.y - player.height / 2;
    player.grounded = true;
    player.invincible = 0;
  }
  world.players[0].x = 600;
  world.players[1].x = 650;
  return world;
}

test('frame balance accounts for reach, damage, active frames and startup', () => {
  const base = { startup: 6, active: 3, recovery: 6, damage: 7, reachX: 60, reachY: 45, hitstop: 4, cancelWindow: 4 };
  const light = frameProfile('groundSide', { ...base, chargeable: true }, 'smash');
  const threatening = frameProfile('groundSide', {
    ...base, chargeable: true, damage: 16, reachX: 110, active: 6
  }, 'smash');
  assert.ok(threatening.threat > light.threat);
  assert.ok(threatening.recovery >= light.recovery);
  assert.ok(threatening.whiffCommitment > light.whiffCommitment);
  assert.ok(threatening.blockAdvantage <= light.blockAdvantage);
});

test('whiff and shield contact use stricter cancel windows than a clean hit', () => {
  for (const fighter of FIGHTERS) {
    for (const [name, source] of Object.entries(fighter.moves)) {
      const move = balanceMoveFrames(name, source, name.startsWith('ground') && source.chargeable ? 'smash' : 'normal');
      assert.ok(move.blockCancelWindow <= move.hitCancelWindow, `${fighter.id}.${name} block cancel`);
      assert.ok(move.whiffCancelWindow <= move.hitCancelWindow, `${fighter.id}.${name} whiff cancel`);
      if (!['jab', 'projectile'].includes(move.frameClass)) {
        assert.ok(move.whiffCancelWindow <= move.blockCancelWindow, `${fighter.id}.${name} whiff versus block cancel`);
      }
      if (['smash', 'dash', 'special', 'counter', 'recovery'].includes(move.frameClass)) {
        assert.equal(move.whiffCancelWindow, 0, `${fighter.id}.${name} must finish recovery after a whiff`);
        assert.equal(move.blockCancelWindow, 0, `${fighter.id}.${name} must finish recovery on shield`);
      }
    }
  }
});

test('melee attacks meet their risk-based shield and whiff targets', () => {
  for (const fighter of FIGHTERS) {
    for (const [name, source] of Object.entries(fighter.moves)) {
      if (source.projectile || source.projectileOnly || source.defensiveOnly || source.trapOnly) continue;
      const variant = name.startsWith('ground') && source.chargeable ? 'smash' : 'normal';
      const profile = frameProfile(name, source, variant);
      assert.ok(profile.blockAdvantage <= -profile.targetBlockDisadvantage,
        `${fighter.id}.${name} is ${profile.blockAdvantage} on shield, target -${profile.targetBlockDisadvantage}`);
      if (profile.category === 'aerial') {
        assert.ok(profile.landingBlockAdvantage <= -profile.targetBlockDisadvantage,
          `${fighter.id}.${name} landing is ${profile.landingBlockAdvantage} on shield`);
      }
      assert.ok(profile.whiffCommitment >= profile.targetWhiffCommitment,
        `${fighter.id}.${name} whiff ${profile.whiffCommitment}, target ${profile.targetWhiffCommitment}`);
    }
  }
});

test('projectiles retain meaningful cast commitment and authored rate limits', () => {
  for (const fighter of FIGHTERS) {
    for (const [name, source] of Object.entries(fighter.moves)) {
      if (!source.projectile && !source.projectileOnly) continue;
      const profile = frameProfile(name, source);
      assert.equal(profile.blockAdvantage, null);
      assert.ok(profile.whiffCommitment >= profile.targetWhiffCommitment, `${fighter.id}.${name} cast commitment`);
      assert.ok(profile.projectileCooldown >= 40, `${fighter.id}.${name} cooldown`);
      assert.ok(profile.maxActiveProjectiles >= 1 && profile.maxActiveProjectiles <= 2, `${fighter.id}.${name} active limit`);
    }
  }
});

test('the live action state distinguishes a shielded attack from a whiff', () => {
  const blocked = duel();
  stepWorld(blocked, {
    0: input(1, BUTTONS.ATTACK),
    1: input(1, BUTTONS.SHIELD)
  });
  for (let seq = 2; seq <= 8 && blocked.players[0].action?.contactKind !== 'block'; seq++) {
    stepWorld(blocked, {
      0: input(seq),
      1: input(seq, BUTTONS.SHIELD)
    });
  }
  assert.equal(blocked.players[0].action?.contactKind, 'block');
  assert.ok(blocked.players[0].action.move.blockCancelWindow < blocked.players[0].action.move.hitCancelWindow);

  const whiffed = duel();
  whiffed.players[1].x = 1000;
  stepWorld(whiffed, { 0: input(1, BUTTONS.ATTACK), 1: input(1) });
  for (let seq = 2; seq <= 5; seq++) stepWorld(whiffed, { 0: input(seq), 1: input(seq) });
  assert.equal(whiffed.players[0].action?.contactKind, 'whiff');
  assert.ok(whiffed.players[0].action.move.whiffCancelWindow >= 0);
});
