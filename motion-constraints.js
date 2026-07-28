(function exposeMotionConstraints(root) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

  function constrainPose(pose, options = {}) {
    const spinning = options.spinning === true;
    return {
      ...pose,
      bodyX: clamp(pose.bodyX, -27, 27),
      bodyY: clamp(pose.bodyY, -19, 19),
      rotation: spinning ? Number(pose.rotation) || 0 : clamp(pose.rotation, -.58, .58),
      scaleX: clamp(pose.scaleX, .72, 1.36),
      scaleY: clamp(pose.scaleY, .7, 1.38),
      frontHandX: clamp(pose.frontHandX, -68, 68),
      frontHandY: clamp(pose.frontHandY, -58, 48),
      backHandX: clamp(pose.backHandX, -68, 68),
      backHandY: clamp(pose.backHandY, -58, 48),
      frontFootX: clamp(pose.frontFootX, -57, 57),
      backFootX: clamp(pose.backFootX, -57, 57),
      frontFootLift: clamp(pose.frontFootLift, 0, 34),
      backFootLift: clamp(pose.backFootLift, 0, 34)
    };
  }

  const api = Object.freeze({ constrainPose });
  root.NEON_MOTION_CONSTRAINTS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
