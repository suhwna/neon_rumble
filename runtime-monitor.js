(function exposeRuntimeMonitor(root) {
  class RuntimeMonitor {
    constructor(startedAt = performance.now()) {
      this.reset(startedAt);
    }

    reset(startedAt = performance.now()) {
      this.startedAt = startedAt;
      this.frames = 0;
      this.frameTime = 0;
      this.snapshots = 0;
      this.slowFrames = 0;
    }

    snapshot() {
      this.snapshots += 1;
    }

    frame(now, frameMs, values = {}) {
      this.frames += 1;
      this.frameTime += frameMs;
      if (frameMs > 25) this.slowFrames += 1;
      if (now - this.startedAt < 1000) return null;
      const seconds = (now - this.startedAt) / 1000;
      const sample = {
        fps: +(this.frames / seconds).toFixed(1),
        frameMs: +(this.frameTime / Math.max(1, this.frames)).toFixed(2),
        snapshotHz: +(this.snapshots / seconds).toFixed(1),
        slowFrames: this.slowFrames,
        ...values
      };
      this.startedAt = now;
      this.frames = 0;
      this.frameTime = 0;
      this.snapshots = 0;
      this.slowFrames = 0;
      return sample;
    }
  }

  const api = Object.freeze({ RuntimeMonitor });
  root.NEON_RUNTIME_MONITOR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
