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
        hardCorrections: 0
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

    correction(error, now) {
      const distance = Math.max(0, Number(error) || 0);
      this.metrics.correctionPx = +(this.metrics.correctionPx * .88 + distance * .12).toFixed(2);
      this.metrics.correctionPeakPx = +Math.max(this.metrics.correctionPeakPx, distance).toFixed(2);
      if (distance > 90 && now - this.lastHardCorrectionAt > 250) {
        this.metrics.hardCorrections += 1;
        this.lastHardCorrectionAt = now;
      }
      return distance > 90 ? 1 : null;
    }
  }

  const api = Object.freeze({ NetworkQualityTracker });
  root.NEON_NETWORK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
