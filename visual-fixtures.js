(function exposeVisualFixtures(root) {
  function build(fixture = 'motion-grid', dependencies = {}) {
    const {
      fighters = [], stages = [], defaultRules = {}, shieldMax = 50
    } = dependencies;
    if (fighters.length < 4 || !stages.length) throw new Error('visual fixture content is incomplete');

    const motionAudit = /^motion:([A-Za-z0-9]+):(startup|active|recovery)$/.exec(fixture);
    const makePlayer = (fighter, index, x, action, options = {}) => {
      const move = fighter.moves[action] || {};
      const y = (options.floorY ?? 500) - fighter.height / 2;
      const direction = options.face || 1;
      const strikePoints = action === 'groundHit' || move.projectileOnly || move.trapOnly
        ? []
        : action.includes('Up')
          ? [{ x: x + direction * 7, y: y - Math.min(54, (move.reachY || 90) * .52) }]
          : action.includes('Down')
            ? [{ x: x + direction * Math.min(48, (move.reachX || 80) * .48), y: y + fighter.height * .3 }]
            : [{ x: x + direction * Math.min(52, (move.reachX || 80) * .52), y: y - 5 }];
      return {
        i: index, clientId: `fixture:${fighter.id}`, nickname: fighter.name,
        characterId: fighter.id, palette: index, team: null,
        x, y, vx: options.vx || 0, vy: options.vy || 0,
        face: direction, width: fighter.width, height: fighter.height,
        grounded: options.grounded ?? true,
        platformId: options.grounded === false ? null : 'main',
        jumps: 2, damage: 35 + index * 17,
        stocks: 3, score: 0, shield: shieldMax, shielding: false, invincible: 0,
        eliminated: false, respawn: 0, respawnPlatformFrames: 0,
        actionName: action, actionPhase: options.phase ?? (action === 'groundHit' ? null : 'active'),
        actionVariant: options.variant || null, actionMotion: move.motion || null,
        actionFrame: options.actionFrame || move.startup || 0,
        actionTiming: {
          startup: move.startup || 1,
          active: move.active || 1,
          recovery: move.recovery || 1
        },
        phaseProgress: options.progress ?? .28, actionHitbox: null, strikePoints,
        chargeFrames: options.chargeFrames || 0, chargeScale: 1,
        stun: action === 'groundHit' ? 12 : 0, hitstop: options.hitstop || 0,
        movementState: 'idle', dashFrames: 0, dashAge: 0, dashDirection: 0,
        dodgeFrames: 0, dodgeTotalFrames: 0, dodgeElapsed: 0,
        ledge: null, grabbedBy: null, grabbing: null, landingLag: 0,
        tumbling: false, freefall: false, knockdownFrames: 0,
        ultimateMeter: 45 + index * 12,
        impactVisualUntil: action === 'groundHit' ? Number.POSITIVE_INFINITY : 0,
        impactVisualStrength: options.impactStrength || 1,
        impactVisualAngle: options.impactAngle || 0
      };
    };

    let players;
    if (motionAudit) {
      const [, action, phase] = motionAudit;
      const positions = [275, 515, 755, 995];
      players = fighters.map((fighter, index) => makePlayer(fighter, index, positions[index], action, {
        face: index < 2 ? 1 : -1,
        grounded: !action.startsWith('air'),
        floorY: action.startsWith('air') ? 420 : 500,
        phase,
        progress: phase === 'startup' ? .72 : phase === 'active' ? .28 : .35,
        variant: action.startsWith('ground') && action !== 'groundNeutral' ? 'tilt' : null
      }));
    } else if (fixture === 'four-player-impact') {
      players = [
        makePlayer(fighters[0], 0, 535, 'groundSide', { face: 1, progress: .25 }),
        makePlayer(fighters[1], 1, 615, 'groundHit', { face: -1, impactAngle: 0, impactStrength: 1.3 }),
        makePlayer(fighters[2], 2, 685, 'groundDown', { face: -1, progress: .35 }),
        makePlayer(fighters[3], 3, 755, 'groundHit', { face: 1, impactAngle: Math.PI, impactStrength: .85 })
      ];
    } else {
      players = [
        makePlayer(fighters[0], 0, 275, 'groundSide', { progress: .28 }),
        makePlayer(fighters[1], 1, 515, 'groundUp', { progress: .25 }),
        makePlayer(fighters[2], 2, 755, 'groundDown', { face: -1, progress: .32 }),
        makePlayer(fighters[3], 3, 995, 'specialNeutral', { face: -1, progress: .3 })
      ];
    }

    const stage = stages[0];
    return {
      fixture,
      rules: { ...defaultRules, mode: 'stock', stocks: 3, timeSeconds: 420 },
      stage,
      platforms: stage.platforms.map(platform => ({ ...platform })),
      camera: { x: 640, y: 390, zoom: fixture === 'four-player-impact' ? 1.12 : .94 },
      players
    };
  }

  const api = Object.freeze({ build });
  root.NEON_VISUAL_FIXTURES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
