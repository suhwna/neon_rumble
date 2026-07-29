'use strict';

const { FIGHTERS } = require('../content');
const { frameProfile } = require('../frame-balance');

function tiltDefinition(fighter, name, source) {
  const recoveryBonus = fighter.id === 'blaze' && name === 'groundDown'
    ? 3
    : ({ volt: 1, blaze: 1, bolt: 2, nova: 2 })[fighter.id] || 1;
  const startupBonus = fighter.id === 'blaze' && name === 'groundDown' ? 1 : 0;
  return {
    ...source,
    startup: Math.max(3, source.startup - 2 - startupBonus),
    recovery: Math.max(5, Math.round(source.recovery * 0.7) - recoveryBonus),
    cancelWindow: Math.max(5, source.cancelWindow || 0),
    damage: source.damage * 0.72,
    kx: source.kx * 0.7,
    ky: source.ky * 0.76,
    reachX: source.reachX * 0.9,
    reachY: source.reachY * 0.92,
    chargeable: false,
    tilt: true
  };
}

for (const fighter of FIGHTERS) {
  console.log(`\n${fighter.name}`);
  console.table(Object.entries(fighter.moves).flatMap(([name, source]) => {
    if (source.defensiveOnly || source.trapOnly) return [];
    const rows = [];
    if (source.chargeable && name.startsWith('ground')) {
      rows.push({ move: `${name}:tilt`, ...frameProfile(name, tiltDefinition(fighter, name, source), 'tilt') });
      rows.push({ move: `${name}:smash`, ...frameProfile(name, source, 'smash') });
    } else rows.push({ move: name, ...frameProfile(name, source, 'normal') });
    return rows;
  }));
}
