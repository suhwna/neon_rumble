(function exposeInputPolicy(root) {
  const HORIZONTAL_KEYS = Object.freeze({
    ArrowLeft: -1,
    KeyA: -1,
    ArrowRight: 1,
    KeyD: 1
  });

  class KeyboardIntentTracker {
    constructor(options = {}) {
      this.walkAxis = options.walkAxis ?? 0.62;
      this.precisionAxis = options.precisionAxis ?? 0.44;
      this.runDelayMs = options.runDelayMs ?? 145;
      this.doubleTapMs = options.doubleTapMs ?? 175;
      this.dashPulseMs = options.dashPulseMs ?? 150;
      this.heldSince = new Map();
      this.lastRelease = new Map();
      this.dashUntil = new Map();
    }

    keyDown(code, now = performance.now()) {
      const direction = HORIZONTAL_KEYS[code];
      if (!direction || this.heldSince.has(code)) return;
      this.heldSince.set(code, now);
      const releasedAt = this.lastRelease.get(direction) ?? -Infinity;
      if (now - releasedAt <= this.doubleTapMs) this.dashUntil.set(direction, now + this.dashPulseMs);
    }

    keyUp(code, now = performance.now()) {
      const direction = HORIZONTAL_KEYS[code];
      this.heldSince.delete(code);
      if (direction) this.lastRelease.set(direction, now);
    }

    horizontal(keys, now = performance.now()) {
      const left = keys.has('KeyA') || keys.has('ArrowLeft');
      const right = keys.has('KeyD') || keys.has('ArrowRight');
      if (left === right) return 0;
      const direction = right ? 1 : -1;
      const precision = keys.has('ControlLeft') || keys.has('ControlRight');
      if (precision) return direction * this.precisionAxis;
      const codes = direction > 0 ? ['KeyD', 'ArrowRight'] : ['KeyA', 'ArrowLeft'];
      const heldAt = Math.min(...codes.filter(code => keys.has(code)).map(code => this.heldSince.get(code) ?? now));
      const dashing = (this.dashUntil.get(direction) ?? 0) > now;
      return direction * (dashing || now - heldAt >= this.runDelayMs ? 1 : this.walkAxis);
    }

    reset() {
      this.heldSince.clear();
      this.lastRelease.clear();
      this.dashUntil.clear();
    }
  }

  class InputTransportPolicy {
    constructor(metrics = null) {
      this.last = null;
      this.metrics = metrics;
    }

    channel(input, force = false) {
      const axisBand = value => {
        const magnitude = Math.abs(Number(value) || 0);
        if (magnitude < 0.2) return 0;
        if (magnitude < 0.52) return Math.sign(value);
        if (magnitude < 0.82) return Math.sign(value) * 2;
        return Math.sign(value) * 3;
      };
      const reliable = force
        || !this.last
        || input.buttons !== this.last.buttons
        // Keyboard walk/run and analogue stick strength changes affect the
        // authoritative movement state. Treat crossing those bands as an
        // input edge so a dropped volatile packet cannot delay a run or dash.
        || axisBand(input.horizontal) !== axisBand(this.last.horizontal)
        || axisBand(input.vertical) !== axisBand(this.last.vertical);
      this.last = { ...input };
      if (this.metrics) {
        const key = reliable ? 'reliableInputs' : 'volatileInputs';
        this.metrics[key] = (this.metrics[key] || 0) + 1;
      }
      return reliable ? 'reliable' : 'volatile';
    }

    reset() {
      this.last = null;
    }
  }

  const api = Object.freeze({ KeyboardIntentTracker, InputTransportPolicy });
  root.NEON_INPUT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
