(function exposeAudioFeedback(root) {
  class AudioFeedback {
    constructor(AudioContextClass = root.AudioContext || root.webkitAudioContext) {
      this.AudioContextClass = AudioContextClass;
      this.context = null;
      this.muted = false;
    }

    setMuted(value) {
      this.muted = !!value;
      return this.muted;
    }

    ensure() {
      if (!this.AudioContextClass) return null;
      this.context ||= new this.AudioContextClass();
      if (this.context.state === 'suspended') this.context.resume();
      return this.context;
    }

    tone(frequency, duration, type = 'sine', gainAmount = 0.035, endFrequency = null) {
      if (this.muted) return false;
      const audio = this.ensure();
      if (!audio) return false;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(Math.max(20, frequency), audio.currentTime);
      if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), audio.currentTime + duration);
      gain.gain.setValueAtTime(gainAmount, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + duration);
      return true;
    }

    impact(strength, options = {}) {
      const amount = Math.max(0.35, Math.min(1.55, Number(strength) || 0.5));
      const duration = options.critical ? 0.14 : options.pummel ? 0.035 : 0.045 + amount * 0.025;
      const start = options.shield ? 330 : options.critical ? 92 : 205 - amount * 62;
      const end = options.shield ? 185 : options.critical ? 38 : Math.max(48, start * 0.42);
      return this.tone(
        start,
        duration,
        options.shield ? 'triangle' : options.sweet ? 'square' : 'sawtooth',
        Math.min(0.065, 0.024 + amount * 0.018),
        end
      );
    }
  }

  const api = Object.freeze({ AudioFeedback });
  root.NEON_AUDIO = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
