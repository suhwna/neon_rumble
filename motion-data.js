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
          bodyX: -(active.bodyX || 0) * .55,
          bodyY: Math.abs(active.bodyY || 0) * .25,
          rotation: -(active.rotation || 0) * .72,
          frontHandX: -(active.frontHandX || 0) * .46,
          frontHandY: -(active.frontHandY || 0) * .38,
          backHandX: -(active.backHandX || 0) * .34,
          backHandY: -(active.backHandY || 0) * .3,
          frontFootX: -(active.frontFootX || 0) * .24,
          backFootX: -(active.backFootX || 0) * .24,
          scaleX: -(active.scaleX || 0) * .45,
          scaleY: -(active.scaleY || 0) * .45
        };
    const recovery = options.recovery
      ? delta(options.recovery)
      : {
          bodyX: -(active.bodyX || 0) * .22,
          bodyY: Math.abs(active.bodyY || 0) * .18,
          rotation: -(active.rotation || 0) * .3,
          frontHandX: -(active.frontHandX || 0) * .2,
          frontHandY: -(active.frontHandY || 0) * .18,
          backHandX: -(active.backHandX || 0) * .16,
          backHandY: -(active.backHandY || 0) * .16,
          frontFootX: -(active.frontFootX || 0) * .14,
          backFootX: -(active.backFootX || 0) * .14,
          scaleX: -(active.scaleX || 0) * .2,
          scaleY: -(active.scaleY || 0) * .2
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
      groundSide: profile([11, 2, -.12, 18, -7, -14, 10, 18, 2, -14, 6, .1, -.07]),
      groundUp: profile([3, -7, .08, 8, -17, -12, -13, 17, 12, -8, 3, -.02, .13]),
      groundDown: profile([2, 8, .18, 12, 8, -13, -7, 22, 5, -21, 3, .14, -.13]),
      dashAttack: profile([16, 7, .24, 10, 8, -12, -7, 11, 8, -20, 6, .16, -.14]),
      airNeutral: profile([0, 0, .26, 13, 8, -14, -8, 20, 8, -20, 8, .07, -.03]),
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

  const api = Object.freeze({
    profiles: PROFILES,
    profileFor(fighterId, action) {
      return PROFILES[fighterId]?.[action] || null;
    }
  });

  root.NEON_MOTION = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
