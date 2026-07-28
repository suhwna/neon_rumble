(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.NEON_CONTENT = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BUTTONS = {
    LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8,
    ATTACK: 16, SPECIAL: 32, SHIELD: 64, GRAB: 128
  };

  const move = (startup, active, recovery, damage, kx, ky, reachX, reachY, extra = {}) => ({
    startup, active, recovery, damage, kx, ky, reachX, reachY,
    hitstop: Math.max(3, Math.min(9, Math.round(damage / 2))),
    landingLag: Math.max(4, Math.round(recovery * 0.55)),
    ...extra
  });

  const baseMoves = power => ({
    groundNeutral: move(3, 2, 5, 3.5 * power, 105, 65, 58, 42, { jab: 1 }),
    groundJab2: move(3, 2, 6, 4 * power, 125, 75, 62, 44, { jab: 2 }),
    groundJab3: move(5, 3, 12, 7.5 * power, 285, 135, 72, 48, { jab: 3 }),
    groundSide: move(8, 4, 15, 12 * power, 345, 145, 92, 52, { chargeable: true, sweetspot: .72 }),
    groundUp: move(7, 5, 16, 10 * power, 165, 385, 68, 102, { vertical: true, chargeable: true, sweetspot: .7 }),
    groundDown: move(6, 4, 13, 9 * power, 295, 72, 86, 44, { chargeable: true, sweetspot: .74, low: true }),
    dashAttack: move(5, 6, 13, 10 * power, 315, 135, 86, 50, { dash: 'attack', dashSpeed: 455, startupDrag: 0.96, recoveryDrag: 0.86 }),
    airNeutral: move(5, 7, 12, 9 * power, 245, 175, 68, 62, { radial: true }),
    airForward: move(7, 4, 16, 12 * power, 330, 205, 84, 58, { sweetspot: .7 }),
    airBack: move(6, 4, 14, 13 * power, 370, 190, 82, 56, { backward: true, sweetspot: .68 }),
    airUp: move(6, 5, 13, 9 * power, 130, 350, 64, 94, { vertical: true, sweetspot: .7 }),
    airDown: move(10, 5, 20, 13 * power, 90, -390, 58, 88, { downward: true, meteor: true }),
    specialNeutral: move(12, 2, 20, 10 * power, 260, 110, 80, 55, { projectile: true }),
    specialSide: move(9, 8, 22, 15 * power, 390, 165, 110, 60, { dash: true }),
    specialUp: move(5, 9, 24, 11 * power, 160, 310, 68, 90, { recoveryMove: true }),
    specialDown: move(14, 3, 24, 14 * power, 330, 245, 130, 70, { radial: true, trap: true })
  });

  const fighter = (id, name, color, icon, archetype, stats, moveOverrides) => {
    const moves = baseMoves(stats.power);
    for (const [key, override] of Object.entries(moveOverrides || {})) {
      const merged = { ...moves[key], ...override };
      if (override.hitstop == null) merged.hitstop = Math.max(3, Math.min(9, Math.round(merged.damage / 2)));
      if (override.landingLag == null) merged.landingLag = Math.max(4, Math.round(merged.recovery * 0.55));
      moves[key] = merged;
    }
    for (const [key, definition] of Object.entries(moves)) {
      // Keyboard jab strings need a dependable contact window. The later hits
      // reach slightly farther so their own light pushback does not drop them.
      if (definition.jab === 1 || definition.jab === 2) definition.active += 1;
      if (definition.jab === 2) definition.reachX += 4;
      else if (definition.jab === 3) definition.reachX += 6;
      if (definition.cancelWindow == null) {
        if (definition.recoveryMove || key === 'specialUp') definition.cancelWindow = 0;
        else if (definition.jab && definition.jab < 3) definition.cancelWindow = Math.min(5, Math.max(2, Math.round(definition.recovery * .55)));
        else if (key.startsWith('special')) definition.cancelWindow = Math.min(4, Math.max(2, Math.round(definition.recovery * .16)));
        else if (key.startsWith('air')) definition.cancelWindow = Math.min(5, Math.max(3, Math.round(definition.recovery * .24)));
        else definition.cancelWindow = Math.min(5, Math.max(3, Math.round(definition.recovery * .24)));
      }
      if (definition.jab && definition.jab < 3) {
        definition.fixedKx ??= Math.round(Math.min(82, Math.max(46, definition.kx * .56)));
        definition.fixedKy ??= 0;
        definition.knockbackGrowth ??= .12;
        definition.hitstun ??= definition.jab === 1 ? 10 : 11;
        definition.groundedFlinch ??= true;
      } else if (definition.jab === 3) definition.knockbackGrowth ??= .68;
      else if (key === 'groundSide' || key === 'groundUp' || key === 'groundDown') definition.knockbackGrowth ??= 1.18;
      else if (key === 'dashAttack') definition.knockbackGrowth ??= .88;
      else if (key.startsWith('air')) definition.knockbackGrowth ??= .96;
      else if (key.startsWith('special')) definition.knockbackGrowth ??= 1.08;
      else definition.knockbackGrowth ??= 1;
    }
    return {
      id, name, color, icon, archetype, ...stats, moves,
      palettes: [color, '#70f0ff', '#ff4d79', '#ffd34a']
    };
  };

  const FIGHTERS = [
    fighter('volt', 'VOLT', '#26d9ff', '⚡', '초고속 러시다운',
      { speed: 1.15, air: 1.12, jump: 1.08, weight: 0.92, power: 0.92, width: 48, height: 68, skid: 9, walkSpeed: 220, runSpeed: 300, dashSpeed: 535, pivotDashSpeed: 520, dashAcceleration: 155, dashBrakeFrames: 3, dashBrakeControl: 190 }, {
        groundNeutral: { startup: 2, active: 2, recovery: 5, damage: 2.8, kx: 82, ky: 42, reachX: 54, hitstop: 4, motion: 'sparkJab' },
        groundJab2: { startup: 2, active: 2, recovery: 5, damage: 3.1, kx: 96, ky: 50, reachX: 58, hitstop: 4, motion: 'sparkJab' },
        groundJab3: { startup: 4, active: 3, recovery: 9, damage: 6.4, kx: 245, ky: 115, reachX: 72, motion: 'arcKick' },
        groundSide: { startup: 6, active: 3, recovery: 12, damage: 10, kx: 325, ky: 120, reachX: 94, chargeable: true, sweetspot: .76, motion: 'lightningLunge' },
        groundUp: { startup: 5, active: 4, recovery: 13, damage: 8, kx: 145, ky: 340, reachX: 78, reachY: 104, chargeable: true, motion: 'flashUpper' },
        groundDown: { startup: 4, active: 4, recovery: 10, damage: 7, kx: 260, ky: 60, reachX: 96, chargeable: true, motion: 'lowSweep' },
        dashAttack: { startup: 4, active: 6, recovery: 10, damage: 8.5, kx: 290, ky: 120, dashSpeed: 530, motion: 'lightningLunge' },
        airNeutral: { startup: 4, active: 8, recovery: 9, landingLag: 6, damage: 7.2, kx: 225, ky: 155, motion: 'voltSpin' },
        airForward: { startup: 6, active: 3, recovery: 12, landingLag: 8, damage: 10, kx: 315, ky: 185, motion: 'arcKick' },
        airBack: { startup: 5, active: 3, recovery: 11, landingLag: 7, damage: 10.5, kx: 345, ky: 170, motion: 'backSpark' },
        airUp: { startup: 4, active: 5, recovery: 10, landingLag: 6, damage: 7.5, kx: 115, ky: 325, motion: 'flashUpper' },
        airDown: { startup: 8, active: 5, recovery: 15, landingLag: 10, damage: 11, kx: 75, ky: -355, reachX: 66, reachY: 94, motion: 'boltDive' },
        specialNeutral: { projectile: 'arc', projectileOnly: true, motion: 'cast', startup: 7, active: 2, recovery: 14, damage: 6.5, projectileSpeed: 625, projectileRadius: 22, chainRadius: 80, projectileCooldown: 48, maxActiveProjectiles: 2 },
        specialSide: { dash: 'pulse', motion: 'rush', startup: 6, active: 8, recovery: 17, dashSpeed: 560, recoveryDrag: 0.62, damage: 12, kx: 380 },
        specialUp: { recoveryMove: true, recoveryKind: 'thunder', causesFreefall: true, motion: 'rise', startup: 4, active: 8, recovery: 18, riseSpeed: 680, riseHorizontal: 235 },
        specialDown: { trap: null, trapOnly: false, radial: true, low: true, motion: 'discharge', startup: 8, active: 4, recovery: 20, damage: 6.5, kx: 105, ky: 80, reachX: 96, reachY: 48, knockbackGrowth: .25, groundedFlinch: true, hitstun: 20 }
      }),
    fighter('blaze', 'BLAZE', '#ff3b69', '◆', '중량급 파워',
      { speed: 0.89, air: 0.9, jump: 0.92, weight: 1.1, crowdWeight: 1.1, power: 1.2, width: 60, height: 78, skid: 14, walkSpeed: 202, runSpeed: 282, dashSpeed: 470, pivotDashSpeed: 450, dashAcceleration: 118, dashBrakeFrames: 5, dashBrakeControl: 145 }, {
        groundNeutral: { startup: 4, active: 3, recovery: 6, damage: 5.2, kx: 125, ky: 65, reachX: 64, motion: 'heavyJab' },
        groundJab2: { startup: 4, active: 3, recovery: 7, damage: 5.8, kx: 145, ky: 75, reachX: 68, motion: 'heavyJab' },
        groundJab3: { startup: 7, active: 4, recovery: 14, damage: 11.5, kx: 360, ky: 155, reachX: 86, motion: 'hammer' },
        groundSide: { startup: 12, active: 4, recovery: 23, damage: 15.5, kx: 420, ky: 180, reachX: 106, reachY: 58, chargeable: true, sweetspot: .7, motion: 'hammer' },
        groundUp: { startup: 11, active: 5, recovery: 22, damage: 16, kx: 190, ky: 470, reachX: 84, reachY: 116, chargeable: true, motion: 'launcher' },
        groundDown: { startup: 9, active: 5, recovery: 18, damage: 14, kx: 365, ky: 85, reachX: 100, chargeable: true, motion: 'stomp' },
        dashAttack: { startup: 7, active: 7, recovery: 19, damage: 13.5, kx: 390, ky: 165, dashSpeed: 390, armorType: 'heavy', armorThreshold: 6, crowdArmorThreshold: 12, crowdArmorStartupFrames: 5, motion: 'bodyCheck' },
        airNeutral: { startup: 6, active: 10, recovery: 16, landingLag: 10, damage: 11.5, kx: 305, ky: 190, reachX: 84, reachY: 76, armorType: 'heavy', armorThreshold: 5, crowdArmorThreshold: 10, crowdArmorStartupFrames: 4, motion: 'ironSpin' },
        airForward: { startup: 11, active: 5, recovery: 23, landingLag: 15, damage: 16, kx: 430, ky: 235, reachX: 96, motion: 'hammer' },
        airBack: { startup: 9, active: 5, recovery: 20, landingLag: 14, damage: 16, kx: 445, ky: 215, reachX: 92, motion: 'backFist' },
        airUp: { startup: 10, active: 6, recovery: 20, landingLag: 13, damage: 14, kx: 165, ky: 440, reachY: 108, motion: 'launcher' },
        airDown: { startup: 13, active: 6, recovery: 25, landingLag: 16, damage: 18, kx: 110, ky: -490, reachX: 76, reachY: 102, motion: 'anvilDrop' },
        specialNeutral: { projectile: 'core', projectileOnly: true, motion: 'cannon', chargeable: true, startup: 14, active: 2, recovery: 25, damage: 11.5, kx: 350, projectileSpeed: 330, projectileRadius: 36, splashRadius: 64, projectileCooldown: 78, maxActiveProjectiles: 1 },
        specialSide: { dash: 'armor', motion: 'shoulder', armor: true, armorType: 'heavy', armorThreshold: 9, startup: 11, active: 7, recovery: 26, dashSpeed: 450, recoveryDrag: 0.68, damage: 17, kx: 450 },
        specialUp: { recoveryMove: true, recoveryKind: 'rocket', causesFreefall: true, motion: 'rocket', startup: 7, active: 8, recovery: 24, riseSpeed: 625, riseHorizontal: 190, damage: 15, ky: 410 },
        specialDown: {
          armor: true, counter: true, defensiveOnly: true, motion: 'counter',
          startup: 5, active: 8, recovery: 27,
          counterMultiplier: 1.1, counterMinDamage: 7, counterReach: 135,
          counterBaseKx: 340, counterDamageKx: 8, counterBaseKy: 165, counterDamageKy: 2.4,
          counterHitstop: 9
        }
      }),
    fighter('bolt', 'BOLT', '#ffd23f', '●', '트릭과 지형 제어',
      { speed: 1.06, air: 1.04, jump: 1.02, weight: 1.07, power: 1.02, width: 56, height: 68, skid: 12, canCrawl: true, walkSpeed: 212, runSpeed: 292, dashSpeed: 495, pivotDashSpeed: 480, dashAcceleration: 135, dashBrakeFrames: 4, dashBrakeControl: 165 }, {
        groundNeutral: { startup: 3, active: 3, recovery: 5, damage: 3.8, kx: 105, ky: 58, reachX: 61, motion: 'orbJab' },
        groundJab2: { startup: 3, active: 3, recovery: 6, damage: 4.2, kx: 125, ky: 70, reachX: 66, motion: 'orbJab' },
        groundJab3: { startup: 6, active: 5, recovery: 12, damage: 8, kx: 290, ky: 140, reachX: 78, radial: true, motion: 'wheelSpin' },
        groundSide: { startup: 7, active: 5, recovery: 14, damage: 12, kx: 360, ky: 145, reachX: 96, chargeable: true, motion: 'orbSwing' },
        groundUp: { startup: 6, active: 6, recovery: 14, damage: 10, kx: 145, ky: 390, reachX: 80, reachY: 106, chargeable: true, motion: 'springKick' },
        groundDown: { startup: 5, active: 7, recovery: 12, damage: 9.5, kx: 305, ky: 72, reachX: 94, radial: true, chargeable: true, motion: 'wheelSweep' },
        dashAttack: { startup: 6, active: 10, recovery: 12, damage: 11, kx: 320, ky: 135, radial: true, dashSpeed: 475, motion: 'wheelSpin' },
        airNeutral: { startup: 5, active: 10, recovery: 11, landingLag: 8, damage: 9.5, kx: 260, ky: 175, reachX: 74, motion: 'wheelSpin' },
        airForward: { startup: 8, active: 5, recovery: 15, landingLag: 10, damage: 11.5, kx: 355, ky: 205, reachX: 88, knockbackGrowth: 1.04, motion: 'orbSwing' },
        airBack: { startup: 7, active: 5, recovery: 14, landingLag: 9, damage: 12.5, kx: 390, ky: 185, reachX: 86, knockbackGrowth: 1.08, motion: 'backRoll' },
        airUp: { startup: 6, active: 7, recovery: 13, landingLag: 8, damage: 9.5, kx: 125, ky: 365, motion: 'springKick' },
        airDown: { startup: 10, active: 7, recovery: 18, landingLag: 12, damage: 13.5, kx: 90, ky: -395, reachX: 72, reachY: 96, motion: 'wheelDrop' },
        specialNeutral: { projectile: 'boomerang', projectileOnly: true, motion: 'throw', startup: 7, active: 2, recovery: 13, projectileSpeed: 500, projectileRadius: 32, projectileCooldown: 42, maxActiveProjectiles: 1, returnDamageScale: .62, crowdDamageScale: .84 },
        specialSide: { dash: 'roll', motion: 'roll', radial: true, startup: 7, active: 9, recovery: 17, dashSpeed: 480, recoveryDrag: 0.72, reachX: 70, reachY: 56, damage: 12, kx: 390, knockbackGrowth: 1.03 },
        specialUp: { recoveryMove: true, recoveryKind: 'spring', causesFreefall: false, motion: 'spring', startup: 4, active: 6, recovery: 20, riseSpeed: 720, riseHorizontal: 200, damage: 8, ky: 270 },
        specialDown: { trap: null, radial: true, low: true, motion: 'quake', reachX: 102, reachY: 52, startup: 8, active: 4, recovery: 20, damage: 11.5, kx: 250, ky: 270, knockbackGrowth: 1.02 }
      }),
    fighter('nova', 'NOVA', '#8b5cff', '✦', '공중 기동과 워프',
      { speed: 1.03, air: 1.1, jump: 1.1, weight: 0.92, power: 0.96, width: 50, height: 72, skid: 10, walkSpeed: 216, runSpeed: 296, dashSpeed: 510, pivotDashSpeed: 495, dashAcceleration: 145, dashBrakeFrames: 3, dashBrakeControl: 180 }, {
        groundNeutral: { startup: 3, active: 2, recovery: 5, damage: 3.4, kx: 95, ky: 55, reachX: 62, motion: 'starJab' },
        groundJab2: { startup: 3, active: 2, recovery: 6, damage: 3.8, kx: 112, ky: 65, reachX: 68, motion: 'starJab' },
        groundJab3: { startup: 5, active: 4, recovery: 12, damage: 7.4, kx: 275, ky: 135, reachX: 82, motion: 'crescent' },
        groundSide: { startup: 8, active: 4, recovery: 15, damage: 11, kx: 330, ky: 155, reachX: 104, chargeable: true, sweetspot: .76, motion: 'crescent' },
        groundUp: { startup: 7, active: 5, recovery: 17, damage: 10, kx: 135, ky: 405, reachX: 78, reachY: 116, chargeable: true, motion: 'starRise' },
        groundDown: { startup: 5, active: 5, recovery: 13, damage: 8.5, kx: 275, ky: 75, reachX: 104, chargeable: true, motion: 'gravitySweep' },
        dashAttack: { startup: 5, active: 5, recovery: 16, damage: 9.5, kx: 305, ky: 145, dashSpeed: 455, motion: 'blinkSlash' },
        airNeutral: { startup: 5, active: 8, recovery: 14, landingLag: 9, damage: 8, kx: 230, ky: 170, reachX: 76, motion: 'starOrbit' },
        airForward: { startup: 6, active: 5, recovery: 14, landingLag: 8, damage: 11, kx: 325, ky: 215, reachX: 92, motion: 'crescent' },
        airBack: { startup: 6, active: 4, recovery: 15, landingLag: 9, damage: 11.5, kx: 360, ky: 190, reachX: 90, knockbackGrowth: 1.05, motion: 'warpKick' },
        airUp: { startup: 5, active: 6, recovery: 12, landingLag: 7, damage: 9.5, kx: 120, ky: 380, reachY: 104, motion: 'starRise' },
        airDown: { startup: 8, active: 6, recovery: 17, landingLag: 9, damage: 12, kx: 80, ky: -375, reachX: 70, reachY: 94, motion: 'cometDrop' },
        specialNeutral: { projectile: 'star', projectileOnly: true, motion: 'cast', startup: 7, active: 2, recovery: 13, damage: 8, projectileSpeed: 430, projectileRadius: 27, projectileCooldown: 48, maxActiveProjectiles: 1 },
        specialSide: {
          dash: false, motion: 'blink', chargeable: true, distanceCharge: true,
          maxChargeFrames: 28, chargeDamageScale: 1.1,
          teleport: 110, teleportMin: 72, teleportMax: 230,
          teleportExitSpeed: 270, teleportExitSpeedMin: 190, teleportExitSpeedMax: 335,
          startup: 7, active: 4, recovery: 18, damage: 11.5, kx: 340, ky: 155, knockbackGrowth: 1.05
        },
        specialUp: {
          recoveryMove: false, recoveryKind: 'warp', causesFreefall: true, motion: 'warp',
          chargeable: true, distanceCharge: true, maxChargeFrames: 28, chargeDamageScale: 1.08,
          teleportY: 140, teleportYMin: 120, teleportYMax: 184, warpNeutralBonus: 15,
          teleportHorizontal: 190, teleportHorizontalMin: 150, teleportHorizontalMax: 255,
          recoveryExitSpeed: 310, recoveryExitSpeedMin: 270, recoveryExitSpeedMax: 350,
          riseSpeed: 465, riseSpeedMin: 430, riseSpeedMax: 530,
          recoveryDrift: true, recoveryDriftControl: 1.35, warpInvincible: 3,
          startup: 4, active: 5, recovery: 19, landingLag: 12,
          damage: 9, kx: 145, ky: 345, reachX: 72, reachY: 96, vertical: true
        },
        specialDown: { trap: 'gravity', trapOnly: true, motion: 'gravity', radial: true, startup: 13, active: 6, recovery: 21, damage: 5, kx: 55, ky: 35, reachX: 105, armFrames: 8, trapLife: 120, persistent: true, pullStrength: .68 }
      })
  ];

  const STAGES = [
    {
      id: 'neon-deck', name: 'NEON DECK', color: '#26d9ff',
      platforms: [
        { id: 'main', x: 210, y: 500, w: 860, h: 22, ground: true, groundDepth: 320 },
        { id: 'left', x: 330, y: 375, w: 190, h: 12, passThrough: true },
        { id: 'right', x: 760, y: 375, w: 190, h: 12, passThrough: true }
      ], hazards: []
    },
    {
      id: 'sky-rail', name: 'SKY RAIL', color: '#ffca3a',
      platforms: [
        { id: 'main', x: 255, y: 510, w: 770, h: 22 },
        { id: 'rail-a', x: 280, y: 360, w: 170, h: 12, passThrough: true, moveX: 250, speed: 0.018 },
        { id: 'rail-b', x: 830, y: 315, w: 170, h: 12, passThrough: true, moveX: -250, speed: 0.018 }
      ], hazards: [{ type: 'wind', interval: 600, duration: 150, force: 6 }]
    },
    {
      id: 'reactor-core', name: 'REACTOR CORE', color: '#ff3b69',
      platforms: [
        { id: 'left-main', x: 185, y: 500, w: 420, h: 22 },
        { id: 'right-main', x: 675, y: 500, w: 420, h: 22 },
        { id: 'center', x: 535, y: 365, w: 210, h: 12, passThrough: true }
      ], hazards: [{ type: 'pulse', interval: 480, duration: 90, x: 640, y: 500, radius: 115, damage: 8 }]
    }
  ];

  const ITEMS = [
    { id: 'pulse-hammer', name: 'PULSE HAMMER', color: '#ffca3a', kind: 'melee', damage: 22, uses: 2 },
    { id: 'rail-blaster', name: 'RAIL BLASTER', color: '#26d9ff', kind: 'blaster', damage: 8.5, uses: 5 },
    { id: 'gravity-mine', name: 'GRAVITY MINE', color: '#8b5cff', kind: 'mine', damage: 16, uses: 1 },
    { id: 'shield-battery', name: 'SHIELD BATTERY', color: '#7ce8ff', kind: 'heal-shield', amount: 27.5, uses: 1 },
    { id: 'jump-coil', name: 'JUMP COIL', color: '#5dff8f', kind: 'jump', multiplier: 1.3, duration: 420, uses: 1 },
    { id: 'warp-bomb', name: 'WARP BOMB', color: '#ff4d9d', kind: 'bomb', damage: 18, uses: 1 }
  ];

  const DEFAULT_RULES = {
    mode: 'stock', stocks: 3, timeSeconds: 420, teams: false,
    friendlyFire: false, items: false, hazards: false,
    stageId: 'neon-deck'
  };

  return { BUTTONS, FIGHTERS, STAGES, ITEMS, DEFAULT_RULES };
});
