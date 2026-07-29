const test = require('node:test');
const assert = require('node:assert/strict');

test('hybrid art assets render only stage backgrounds and collision-aligned terrain', () => {
  const OriginalImage = global.Image;
  class FakeImage {
    constructor() {
      this.listeners = {};
      this.naturalWidth = 1672;
      this.naturalHeight = 940;
    }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    set src(value) {
      this._src = value;
      this.listeners.load?.();
    }
    get src() { return this._src; }
  }
  global.Image = FakeImage;
  const modulePath = require.resolve('../art-assets');
  delete require.cache[modulePath];
  const art = require('../art-assets');

  const calls = [];
  const gradient = { addColorStop(offset, color) { calls.push(['stop', offset, color]); } };
  const ctx = {
    globalAlpha: 1,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    drawImage(...args) { calls.push(['drawImage', ...args]); },
    createRadialGradient() { return gradient; },
    fillRect(...args) { calls.push(['fillRect', ...args]); },
    translate(...args) { calls.push(['translate', ...args]); },
    rotate(...args) { calls.push(['rotate', ...args]); },
    scale(...args) { calls.push(['scale', ...args]); },
    set fillStyle(value) { calls.push(['fillStyle', value]); },
    set filter(value) { calls.push(['filter', value]); }
  };

  assert.equal(art.MANIFEST.mode, 'hybrid-stage-only');
  assert.equal(art.isEnabled(), true);
  assert.equal(art.combatEnabled(), false);
  assert.equal(art.drawStageBackground(ctx, { id: 'neon-deck' }, { x: 0, y: 0, width: 1280, height: 720 }), true);
  assert.equal(art.drawStageBackground(ctx, { id: 'sky-rail' }, { x: 0, y: 0, width: 1280, height: 720 }), true);
  assert.equal(art.drawStageBackground(ctx, { id: 'reactor-core' }, { x: 0, y: 0, width: 1280, height: 720 }), true);
  assert.equal(art.drawStageBackground(ctx, { id: 'missing-stage' }, { x: 0, y: 0, width: 1280, height: 720 }), false);
  assert.equal(art.drawTerrain(ctx, 'neon-deck', 'main-floor', { x: 0, y: 500, width: 900, height: 80 }), true);
  assert.equal(art.drawPart(ctx, 'volt.head', { x: 10, y: 20, face: -1 }), false);
  assert.equal(art.drawSegment(ctx, 'volt.upper-arm', { x: 0, y: 0 }, { x: 20, y: 30 }, { width: 10 }), false);
  assert.equal(art.drawProjectile(ctx, 'nova', { x: 10, y: 20, width: 40, height: 40 }), false);
  assert.equal(art.drawSequencedEffect(ctx, 'primary', 'volt', 'startup', .5, { width: 60, height: 60 }), false);
  assert.equal(art.drawSystemEffect(ctx, 'shield-break', 'active', .5, { width: 80, height: 80 }), false);
  assert.equal(art.drawSpecialMoveEffect(ctx, 'volt', 'side', 'active', .5, { width: 100, height: 60 }), false);
  assert.equal(art.drawUltimateEffect(ctx, 'blaze', 'active', .5, { width: 120, height: 120 }), false);
  assert.equal(art.drawPart(ctx, 'missing.part', {}), false);
  assert.ok(calls.some(call => call[0] === 'drawImage'));
  global.Image = OriginalImage;
});
