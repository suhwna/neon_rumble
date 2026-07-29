(function initArtAssets(root) {
  const STAGE_IDS = Object.freeze(['neon-deck', 'sky-rail', 'reactor-core']);
  const TERRAIN_KINDS = Object.freeze(['main-floor', 'pass-through', 'moving', 'cliff']);
  const MANIFEST = Object.freeze({
    version: 2,
    mode: 'hybrid-stage-only',
    stages: Object.freeze(Object.fromEntries(STAGE_IDS.map(stageId => [
      stageId,
      Object.freeze({
        background: `/assets/prototype/${stageId}/background.png`,
        opacity: 0.9
      })
    ]))),
    parts: Object.freeze(Object.fromEntries(STAGE_IDS.flatMap(stageId =>
      TERRAIN_KINDS.map(kind => [
        `terrain.${stageId}.${kind}`,
        Object.freeze({
          src: `/assets/prototype/${stageId}/terrain/${kind}.png`,
          anchorX: 0,
          anchorY: 0,
          width: 128,
          height: kind === 'pass-through' ? 22 : kind === 'moving' ? 40 : 74
        })
      ])
    )))
  });

  const images = new Map();
  const imageState = new Map();
  const stageCache = new Map();
  const partCache = new Map();
  const enabledAtLoad = (() => {
    const query = root.location?.search || '';
    if (new URLSearchParams(query).get('art') === 'legacy') return false;
    try {
      return root.localStorage?.getItem('neonArtMode') !== 'legacy';
    } catch {
      return true;
    }
  })();

  function isEnabled() {
    return enabledAtLoad;
  }

  function combatEnabled() {
    return false;
  }

  function queue(id, src) {
    if (typeof Image === 'undefined' || images.has(id)) return;
    const image = new Image();
    image.decoding = 'async';
    imageState.set(id, 'loading');
    image.addEventListener('load', () => imageState.set(id, 'ready'), { once: true });
    image.addEventListener('error', () => imageState.set(id, 'error'), { once: true });
    images.set(id, image);
    image.src = src;
  }

  function ready(id) {
    return imageState.get(id) === 'ready' && images.get(id)?.naturalWidth > 0;
  }

  function paintStageBackground(ctx, image, definition, bounds) {
    const targetRatio = bounds.width / bounds.height;
    const sourceRatio = image.naturalWidth / image.naturalHeight;
    let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
    if (sourceRatio > targetRatio) {
      sw = image.naturalHeight * targetRatio;
      sx = (image.naturalWidth - sw) / 2;
    } else if (sourceRatio < targetRatio) {
      sh = image.naturalWidth / targetRatio;
      sy = (image.naturalHeight - sh) / 2;
    }
    ctx.save();
    ctx.globalAlpha = definition.opacity;
    ctx.drawImage(image, sx, sy, sw, sh, bounds.x, bounds.y, bounds.width, bounds.height);
    const readability = ctx.createRadialGradient(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height * 0.5,
      bounds.width * 0.08,
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height * 0.5,
      bounds.width * 0.5
    );
    readability.addColorStop(0, 'rgba(4,7,17,.18)');
    readability.addColorStop(0.52, 'rgba(4,7,17,.08)');
    readability.addColorStop(1, 'rgba(4,7,17,.3)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = readability;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.restore();
  }

  function drawStageBackground(ctx, stage, bounds) {
    if (!isEnabled()) return false;
    const definition = MANIFEST.stages[stage?.id];
    const id = `stage:${stage?.id}`;
    if (!definition) return false;
    if (!images.has(id)) queue(id, definition.background);
    if (!ready(id)) return false;
    const image = images.get(id);
    const outputWidth = Math.max(1, Math.round(bounds.width));
    const outputHeight = Math.max(1, Math.round(bounds.height));
    // A full-resolution static backdrop is expensive when four browser tabs
    // render simultaneously. Cache it at a bounded resolution and let Canvas
    // composite the single scaled layer; fighters and terrain stay native-res.
    const cacheScale = Math.min(1, 960 / outputWidth);
    const width = Math.max(1, Math.round(outputWidth * cacheScale));
    const height = Math.max(1, Math.round(outputHeight * cacheScale));
    const cacheKey = `${id}:${width}x${height}`;
    let cached = stageCache.get(cacheKey);
    if (!cached && root.document?.createElement) {
      cached = root.document.createElement('canvas');
      cached.width = width;
      cached.height = height;
      const cacheContext = cached.getContext('2d');
      if (cacheContext) {
        paintStageBackground(cacheContext, image, definition, { x: 0, y: 0, width, height });
        stageCache.set(cacheKey, cached);
      } else cached = null;
    }
    if (cached) ctx.drawImage(cached, bounds.x, bounds.y, bounds.width, bounds.height);
    else paintStageBackground(ctx, image, definition, bounds);
    return true;
  }

  function drawPart(ctx, partId, options = {}) {
    if (!isEnabled() || !partId.startsWith('terrain.')) return false;
    const definition = MANIFEST.parts[partId];
    const id = `part:${partId}`;
    if (!definition) return false;
    if (!images.has(id)) queue(id, definition.src);
    if (!ready(id)) return false;
    const image = images.get(id);
    const width = Math.max(1, Math.round((options.width || definition.width) / 2) * 2);
    const height = Math.max(1, Math.round((options.height || definition.height) / 2) * 2);
    const cacheKey = `${id}:${width}x${height}`;
    let drawable = partCache.get(cacheKey);
    if (!drawable && root.document?.createElement) {
      drawable = root.document.createElement('canvas');
      drawable.width = width;
      drawable.height = height;
      const partContext = drawable.getContext('2d');
      if (partContext) {
        partContext.imageSmoothingEnabled = true;
        partContext.imageSmoothingQuality = 'high';
        partContext.drawImage(image, 0, 0, width, height);
        partCache.set(cacheKey, drawable);
      } else drawable = null;
    }
    ctx.save();
    ctx.translate(options.x || 0, options.y || 0);
    ctx.globalAlpha *= options.opacity ?? 1;
    ctx.drawImage(
      drawable || image,
      -width * (options.anchorX ?? definition.anchorX),
      -height * (options.anchorY ?? definition.anchorY),
      width,
      height
    );
    ctx.restore();
    return true;
  }

  function drawTerrain(ctx, stageId, kind, bounds, options = {}) {
    return drawPart(ctx, `terrain.${stageId}.${kind}`, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      anchorX: 0,
      anchorY: 0,
      opacity: options.opacity ?? 1
    });
  }

  const unavailable = () => false;
  const status = () => Object.freeze(Object.fromEntries(imageState));
  const api = Object.freeze({
    MANIFEST,
    preload() {},
    ready,
    isEnabled,
    combatEnabled,
    drawStageBackground,
    drawPart,
    drawTerrain,
    drawSegment: unavailable,
    drawProjectile: unavailable,
    drawEffect: unavailable,
    drawSequencedEffect: unavailable,
    drawSystemEffect: unavailable,
    drawSpecialMoveEffect: unavailable,
    drawUltimateEffect: unavailable,
    status
  });
  root.NEON_ART = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
