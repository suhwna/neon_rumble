(function exposeNetworkQuality(root) {
  class NetworkQualityTracker {
    constructor(metrics) {
      this.metrics = metrics;
      this.pending = new Map();
      this.ackSamples = [];
      this.lastHardCorrectionAt = 0;
    }

    reset() {
      this.pending.clear();
      this.ackSamples.length = 0;
      this.lastHardCorrectionAt = 0;
      Object.assign(this.metrics, {
        inputAckMs: 0,
        correctionPx: 0,
        correctionPeakPx: 0,
        hardCorrections: 0,
        emergencyCorrections: 0
      });
    }

    sent(seq, sentAt) {
      this.pending.set(seq, sentAt);
      if (this.pending.size > 120) this.pending.delete(this.pending.keys().next().value);
    }

    acknowledged(ack, receivedAt) {
      let newestAcknowledgedAt = 0;
      for (const [seq, sentAt] of this.pending) {
        if (seq > ack) continue;
        newestAcknowledgedAt = Math.max(newestAcknowledgedAt, sentAt);
        this.pending.delete(seq);
      }
      if (newestAcknowledgedAt <= 0) return this.metrics.inputAckMs;
      this.ackSamples.push(receivedAt - newestAcknowledgedAt);
      if (this.ackSamples.length > 12) this.ackSamples.shift();
      const sorted = [...this.ackSamples].sort((a, b) => a - b);
      this.metrics.inputAckMs = +sorted[Math.floor(sorted.length / 2)].toFixed(1);
      return this.metrics.inputAckMs;
    }

    correction(error, now, ackMs = 0) {
      const distance = Math.max(0, Number(error) || 0);
      this.metrics.correctionPx = +(this.metrics.correctionPx * .88 + distance * .12).toFixed(2);
      this.metrics.correctionPeakPx = +Math.max(this.metrics.correctionPeakPx, distance).toFixed(2);
      if (distance > 90 && now - this.lastHardCorrectionAt > 250) {
        this.metrics.hardCorrections += 1;
        this.lastHardCorrectionAt = now;
      }
      if (distance > 220) {
        this.metrics.emergencyCorrections = (this.metrics.emergencyCorrections || 0) + 1;
        return 1;
      }
      // Keep sub-pixel server noise inside a dead zone. Larger divergence is
      // repaid progressively, with a slightly firmer convergence under high
      // ACK latency so the prediction cannot drift indefinitely.
      const latency = Math.max(0, Math.min(1, (Number(ackMs) || 0) / 180));
      if (distance <= 1.5) return 0;
      if (distance <= 10) return .07 + latency * .02;
      if (distance <= 36) return .14 + latency * .04;
      if (distance <= 90) return .24 + latency * .06;
      return .4 + latency * .08;
    }
  }

  const api = Object.freeze({ NetworkQualityTracker });
  root.NEON_NETWORK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
