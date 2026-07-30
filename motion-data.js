(function exposeMotionData(root) {
  const KEYS = [
    'bodyX', 'bodyY', 'rotation',
    'frontHandX', 'frontHandY', 'backHandX', 'backHandY',
    'frontFootX', 'frontFootLift', 'backFootX', 'backFootLift',
    'scaleX', 'scaleY'
  ];

  const delta = values => Object.fromEntries(
    KEYS.map((key, index) => [key, Number(values[index]) || 0])
      .filter(([, value]) => value !== 0)
  );

  const profile = (activeValues, options = {}) => {
    const active = delta(activeValues);
    const windup = options.windup
      ? delta(options.windup)
      : {
          bodyX: -(active.bodyX || 0) * .42,
          bodyY: Math.abs(active.bodyY || 0) * .18,
          rotation: -(active.rotation || 0) * .55,
          frontHandX: -(active.frontHandX || 0) * .34,
          frontHandY: -(active.frontHandY || 0) * .28,
          backHandX: -(active.backHandX || 0) * .26,
          backHandY: -(active.backHandY || 0) * .22,
          frontFootX: -(active.frontFootX || 0) * .18,
          backFootX: -(active.backFootX || 0) * .18,
          scaleX: -(active.scaleX || 0) * .3,
          scaleY: -(active.scaleY || 0) * .3
        };
    const recovery = options.recovery
      ? delta(options.recovery)
      : {
          // Preserve a small amount of the striking direction as follow-through.
          // Reversing every joint here made limbs visibly snap behind the body.
          bodyX: (active.bodyX || 0) * .17,
          bodyY: (active.bodyY || 0) * .12,
          rotation: (active.rotation || 0) * .2,
          frontHandX: (active.frontHandX || 0) * .16,
          frontHandY: (active.frontHandY || 0) * .14,
          backHandX: (active.backHandX || 0) * .13,
          backHandY: (active.backHandY || 0) * .13,
          frontFootX: (active.frontFootX || 0) * .1,
          backFootX: (active.backFootX || 0) * .1,
          scaleX: (active.scaleX || 0) * .12,
          scaleY: (active.scaleY || 0) * .12
        };
    return Object.freeze({
      windup: Object.freeze(windup),
      active: Object.freeze(active),
      recovery: Object.freeze(recovery)
    });
  };

  // Values are authored as silhouette deltas, not hitbox targets. Actual limbs
  // remain clamped to human proportions by the renderer.
  const PROFILES = Object.freeze({
    volt: Object.freeze({
      groundNeutral: profile([8, 0, -.08, 17, -2, -8, 5, 7, 0, -8, 0, .04, -.03]),
      groundJab2: profile([10, -1, -.12, 21, -5, -10, 7, 10, 1, -10, 2, .06, -.04]),
      groundJab3: profile([15, 1, -.19, 28, -6, -14, 10, 16, 2, -17, 4, .12, -.09]),
      groundSide: profile([14, 1, -.16, 24, -5, -12, 8, 13, 0, -12, 0, .1, -.08]),
      groundUp: profile([3, -7, -.04, 8, -25, -7, -17, 4, 7, -5, 3, -.05, .13]),
      groundDown: profile([9, 7, -.11, 7, 8, -14, -3, 28, 0, -12, 0, .13, -.13]),
      dashAttack: profile([18, 5, -.2, 17, 2, -15, 9, 11, 2, -20, 5, .16, -.14]),
      airNeutral: profile([1, -2, .2, 13, 8, -13, -8, 19, 7, -20, 2, .04, .02]),
      airForward: profile([8, 0, -.13, 5, -4, -11, 7, 27, 2, -15, 8, .08, -.04]),
      airBack: profile([-4, -1, .16, 10, -8, -8, 5, 14, 9, -28, 3, .06, -.02]),
      airUp: profile([2, -7, -.04, 9, -22, -8, -17, 8, 12, -7, 4, -.04, .12]),
      airDown: profile([2, 8, .03, 10, -8, -10, -7, 5, 25, -5, 21, .04, .12]),
      specialNeutral: profile([-5, 0, .08, 24, -8, 11, 10, 3, 0, -7, 0, .05, -.03]),
      specialSide: profile([20, 4, -.22, 17, -1, -16, 8, 15, 2, -22, 5, .18, -.15]),
      specialUp: profile([4, -12, -.03, 8, -27, -7, -20, 7, 13, -7, 10, -.08, .18]),
      specialDown: profile([0, 9, 0, 21, 10, -21, 10, 20, 0, -20, 0, .18, -.18])
    }),
    blaze: Object.freeze({
      groundNeutral: profile([9, 5, -.07, 20, -1, 10, 7, 11, 0, -13, 0, .12, -.11]),
      groundJab2: profile([12, 6, -.11, 23, 2, 14, 9, 14, 1, -16, 1, .16, -.14]),
      groundJab3: profile([19, 8, -.22, 32, -4, 25, 10, 20, 2, -23, 2, .25, -.2]),
      groundSide: profile([17, 7, -.19, 29, -3, 23, 8, 17, 0, -19, 0, .22, -.18]),
      groundUp: profile([3, -8, -.03, 11, -27, -9, -22, 10, 4, -12, 2, .03, .15]),
      groundDown: profile([4, 11, .02, 13, 9, -14, 8, 23, 0, -24, 0, .24, -.22]),
      dashAttack: profile([19, 8, -.18, 14, 3, -18, 10, 13, 2, -25, 3, .24, -.2]),
      airNeutral: profile([0, 2, .16, 18, 5, -19, -4, 20, 5, -21, 5, .16, -.1]),
      airForward: profile([11, 4, -.15, 27, -5, 18, 9, 18, 5, -17, 9, .16, -.11]),
      airBack: profile([-5, 2, .13, 10, -4, -24, 2, 15, 8, -24, 4, .14, -.08]),
      airUp: profile([1, -9, 0, 9, -25, -10, -22, 13, 9, -12, 4, .03, .16]),
      airDown: profile([0, 11, 0, 16, -2, -16, -1, 8, 27, -8, 25, .18, .13]),
      specialNeutral: profile([-9, 5, .12, 28, -10, 19, 10, 12, 0, -16, 0, .16, -.13]),
      specialSide: profile([21, 9, -.2, 18, 3, -20, 10, 14, 1, -26, 2, .26, -.22]),
      specialUp: profile([4, -14, 0, 12, -26, -11, -22, 10, 15, -10, 11, -.08, .21]),
      specialDown: profile([-6, 6, .04, 22, -17, -21, -14, 18, 0, -20, 0, .18, -.16])
    }),
    bolt: Object.freeze({
      groundNeutral: profile([7, 1, .06, 16, -5, -9, 6, 8, 2, -8, 0, .05, -.03]),
      groundJab2: profile([9, 0, .13, 17, -8, -12, 8, 13, 4, -10, 3, .07, -.04]),
      groundJab3: profile([14, 4, .24, 20, -3, -17, -7, 18, 8, -19, 6, .16, -.13]),
      groundSide: profile([11, 2, -.12, 18, -7, -14, 10, 18, 2, -14, 6, .1, -.07]),
      groundUp: profile([3, -7, .08, 8, -17, -12, -13, 17, 12, -8, 3, -.02, .13]),
      groundDown: profile([2, 8, .18, 12, 8, -13, -7, 22, 5, -21, 3, .14, -.13]),
      dashAttack: profile([16, 7, .24, 10, 8, -12, -7, 11, 8, -20, 6, .16, -.14]),
      airNeutral: profile([0, 0, .1, 13, 8, -14, -8, 10, 5, -12, 7, .05, -.02]),
      airForward: profile([8, 1, -.1, 15, -6, -13, 9, 22, 6, -14, 10, .09, -.05]),
      airBack: profile([-4, -1, .2, 11, -8, -18, 5, 13, 10, -24, 5, .08, -.03]),
      airUp: profile([1, -7, .11, 8, -16, -10, -12, 16, 13, -9, 5, -.02, .12]),
      airDown: profile([1, 8, .13, 11, -5, -12, -4, 7, 24, -7, 22, .1, .1]),
      specialNeutral: profile([-6, 1, -.1, 24, -9, 13, 8, 9, 0, -10, 0, .08, -.05]),
      specialSide: profile([16, 7, .29, 10, 9, -11, -8, 12, 9, -21, 7, .18, -.15]),
      specialUp: profile([2, -15, .09, 10, -20, -10, -17, 13, 15, -10, 12, -.08, .2]),
      specialDown: profile([0, 10, 0, 25, 11, -25, 11, 23, 0, -23, 0, .2, -.2])
    }),
    nova: Object.freeze({
      groundNeutral: profile([6, -2, -.04, 18, -9, -11, 6, 6, 0, -9, 0, -.02, .06]),
      groundJab2: profile([8, -3, -.08, 21, -12, -13, 8, 9, 2, -11, 2, -.03, .08]),
      groundJab3: profile([14, -3, -.16, 29, -14, -18, 10, 15, 5, -18, 6, .01, .12]),
      groundSide: profile([12, -2, -.13, 25, -11, -15, 9, 14, 4, -16, 5, .02, .06]),
      groundUp: profile([2, -10, -.05, 8, -28, -9, -20, 7, 10, -8, 6, -.08, .18]),
      groundDown: profile([6, 6, -.08, 19, 8, -20, 6, 24, 0, -18, 0, .12, -.1]),
      dashAttack: profile([17, 1, -.16, 24, -8, -18, 8, 13, 5, -20, 8, .08, -.04]),
      airNeutral: profile([0, -4, .17, 19, -10, -19, 9, 15, 8, -16, 7, -.03, .1]),
      airForward: profile([9, -3, -.13, 27, -12, -15, 8, 18, 5, -15, 9, .01, .08]),
      airBack: profile([-5, -3, .15, 12, -11, -25, 6, 13, 10, -22, 4, 0, .08]),
      airUp: profile([1, -11, -.04, 10, -27, -8, -22, 8, 13, -8, 5, -.09, .19]),
      airDown: profile([1, 7, .02, 17, -5, -18, -4, 6, 24, -6, 23, .04, .14]),
      specialNeutral: profile([-7, -2, .09, 26, -13, 18, 7, 7, 0, -10, 0, -.02, .08]),
      specialSide: profile([14, -4, -.18, 28, -12, -19, 8, 15, 7, -18, 9, 0, .1]),
      specialUp: profile([2, -16, -.02, 11, -30, -10, -23, 9, 16, -9, 13, -.12, .24]),
      specialDown: profile([0, 5, 0, 27, 12, -27, 12, 22, 0, -22, 0, .14, -.12])
    })
  });

  const ACTION_JOINTS = Object.freeze({
    groundNeutral: { frontElbowX: -5, frontElbowY: -7, backElbowX: -2, backElbowY: 5, frontKneeX: 3, frontKneeY: -2 },
    groundJab2: { frontElbowX: -7, frontElbowY: -9, backElbowX: 2, backElbowY: 6, frontKneeX: 4, frontKneeY: -3, backKneeX: -2 },
    groundJab3: { frontElbowX: -10, frontElbowY: -8, backElbowX: -5, backElbowY: 9, frontKneeX: 7, frontKneeY: -5, backKneeX: -5 },
    groundSide: { frontElbowX: -8, frontElbowY: -10, backElbowX: -4, backElbowY: 7, frontKneeX: 6, frontKneeY: -4, backKneeX: -4 },
    groundUp: { frontElbowX: 9, frontElbowY: 4, backElbowX: -8, backElbowY: 5, frontKneeX: 4, backKneeX: -4 },
    groundDown: { frontElbowY: 5, backElbowY: -4, frontKneeX: -7, frontKneeY: -12, backKneeX: 5, backKneeY: -4 },
    dashAttack: { frontElbowX: -7, frontElbowY: -6, backElbowX: -5, backElbowY: 8, frontKneeX: 8, frontKneeY: -5, backKneeX: -7 },
    airNeutral: { frontElbowX: -4, frontElbowY: -6, backElbowX: 4, backElbowY: -5, frontKneeX: -5, frontKneeY: -9, backKneeX: 5, backKneeY: -8 },
    airForward: { frontElbowX: -7, frontElbowY: 2, backElbowX: 5, backElbowY: 3, frontKneeX: -8, frontKneeY: -10, backKneeX: 7, backKneeY: -4 },
    airBack: { frontElbowX: 4, frontElbowY: -5, backElbowX: -7, backElbowY: -8, frontKneeX: 5, backKneeX: 8, backKneeY: -11 },
    airUp: { frontElbowX: -5, frontElbowY: 2, backElbowX: -4, backElbowY: 4, frontKneeX: -3, frontKneeY: -7, backKneeX: 4, backKneeY: -6 },
    airDown: { frontElbowX: 3, frontElbowY: 5, backElbowX: -3, backElbowY: 5, frontKneeX: 0, frontKneeY: 1, backKneeX: -14, backKneeY: -8 },
    specialNeutral: { frontElbowX: -7, frontElbowY: -9, backElbowX: -5, backElbowY: 8, frontKneeX: 3, backKneeX: -3 },
    specialSide: { frontElbowX: -9, frontElbowY: -8, backElbowX: -6, backElbowY: 8, frontKneeX: 8, frontKneeY: -5, backKneeX: -6 },
    specialUp: { frontElbowX: 8, frontElbowY: 3, backElbowX: -8, backElbowY: 4, frontKneeX: -4, frontKneeY: -7, backKneeX: 4 },
    specialDown: { frontElbowX: -5, frontElbowY: 5, backElbowX: 5, backElbowY: 5, frontKneeX: -7, frontKneeY: -9, backKneeX: 7, backKneeY: -9 }
  });

  const FIGHTER_JOINTS = Object.freeze({
    volt: { frontElbowX: 2, frontElbowY: -2, frontKneeX: 2 },
    blaze: { frontElbowY: 4, backElbowY: 3, frontKneeY: 3, backKneeY: 3 },
    bolt: { frontElbowX: -2, backElbowX: 2, frontKneeY: -4, backKneeY: -4 },
    nova: { frontElbowX: 4, frontElbowY: -3, backElbowX: -4, backElbowY: -2 }
  });

  // Rendering-only transition timing. These values do not delay hitboxes or
  // gameplay frames; they only control how quickly the authored silhouette
  // settles into a new state.
  const MOTION_STYLES = Object.freeze({
    volt: Object.freeze({ entryMs: 42, phaseMs: 24, activeMs: 16 }),
    blaze: Object.freeze({ entryMs: 76, phaseMs: 34, activeMs: 22 }),
    bolt: Object.freeze({ entryMs: 56, phaseMs: 27, activeMs: 18 }),
    nova: Object.freeze({ entryMs: 66, phaseMs: 31, activeMs: 20 })
  });

  function jointProfile(fighterId, action, phase = 'active', progress = .5) {
    const actionJoints = ACTION_JOINTS[action];
    if (!actionJoints) return null;
    const fighterJoints = FIGHTER_JOINTS[fighterId] || {};
    const t = Math.max(0, Math.min(1, Number(progress) || 0));
    const eased = t * t * (3 - 2 * t);
    const actionWeight = phase === 'startup' || phase === 'charge'
      ? -.42 * eased
      : phase === 'recovery'
        ? .72 * Math.pow(1 - t, .72)
        : .78 + Math.sin(t * Math.PI) * .22;
    const fighterWeight = phase === 'startup' || phase === 'charge'
      ? .42 + eased * .18
      : phase === 'recovery'
        ? .7 * (1 - eased)
        : 1;
    const result = {};
    for (const key of new Set([...Object.keys(actionJoints), ...Object.keys(fighterJoints)])) {
      result[key] = (actionJoints[key] || 0) * actionWeight
        + (fighterJoints[key] || 0) * fighterWeight;
    }
    return result;
  }

  function transitionDuration(fighterId, kind, phaseFrames = 1) {
    const style = MOTION_STYLES[fighterId] || MOTION_STYLES.volt;
    const requested = kind === 'active'
      ? style.activeMs
      : kind === 'entry'
        ? style.entryMs
        : style.phaseMs;
    const budget = Math.max(1, Number(phaseFrames) || 1) * (1000 / 60);
    const budgetRatio = kind === 'active' ? .78 : kind === 'entry' ? .68 : .55;
    return Math.max(12, Math.min(requested, budget * budgetRatio));
  }

  const api = Object.freeze({
    profiles: PROFILES,
    profileFor(fighterId, action) {
      return PROFILES[fighterId]?.[action] || null;
    },
    jointFor: jointProfile,
    styleFor(fighterId) {
      return MOTION_STYLES[fighterId] || MOTION_STYLES.volt;
    },
    transitionFor: transitionDuration
  });

  root.NEON_MOTION = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
