const test = require('node:test');
const assert = require('node:assert/strict');

test('hybrid art assets preload and draw while preserving explicit fallbacks', () => {
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
  global.Image = OriginalImage;

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

  assert.equal(art.MANIFEST.mode, 'hybrid-canvas');
  assert.equal(art.isEnabled(), true);
  assert.equal(art.drawStageBackground(ctx, { id: 'neon-deck' }, { x: 0, y: 0, width: 1280, height: 720 }), true);
  assert.equal(art.drawStageBackground(ctx, { id: 'sky-rail' }, { x: 0, y: 0, width: 1280, height: 720 }), true);
  assert.equal(art.drawStageBackground(ctx, { id: 'reactor-core' }, { x: 0, y: 0, width: 1280, height: 720 }), true);
  assert.equal(art.drawStageBackground(ctx, { id: 'missing-stage' }, { x: 0, y: 0, width: 1280, height: 720 }), false);
  assert.equal(art.drawPart(ctx, 'volt.head', { x: 10, y: 20, face: -1 }), true);
  assert.equal(art.drawPart(ctx, 'blaze.head', { x: 10, y: 20, face: 1 }), true);
  assert.equal(art.drawPart(ctx, 'bolt.head', { x: 10, y: 20, face: 1 }), true);
  assert.equal(art.drawPart(ctx, 'nova.head', { x: 10, y: 20, face: 1 }), true);
  assert.equal(art.drawPart(ctx, 'missing.part', {}), false);
  assert.ok(calls.some(call => call[0] === 'drawImage'));
  assert.ok(calls.some(call => call[0] === 'scale' && call[1] === -1));
});
