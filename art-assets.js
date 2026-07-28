(function initArtAssets(root) {
  const MANIFEST = Object.freeze({
    version: 1,
    mode: 'hybrid-canvas',
    stages: Object.freeze({
      'neon-deck': Object.freeze({
        background: '/assets/prototype/neon-deck/background.png',
        opacity: 0.9
      }),
      'sky-rail': Object.freeze({
        background: '/assets/prototype/sky-rail/background.png',
        opacity: 0.9
      }),
      'reactor-core': Object.freeze({
        background: '/assets/prototype/reactor-core/background.png',
        opacity: 0.9
      })
    }),
    parts: Object.freeze({
      'volt.head': Object.freeze({
        src: '/assets/prototype/fighters/volt/head.png',
        anchorX: 0.5,
        anchorY: 0.52,
        width: 49,
        height: 49
      }),
      'blaze.head': Object.freeze({
        src: '/assets/prototype/fighters/blaze/head.png',
        anchorX: 0.5,
        anchorY: 0.52,
        width: 52,
        height: 52
      }),
      'bolt.head': Object.freeze({
        src: '/assets/prototype/fighters/bolt/head.png',
        anchorX: 0.5,
        anchorY: 0.52,
        width: 47,
        height: 47
      }),
      'nova.head': Object.freeze({
        src: '/assets/prototype/fighters/nova/head.png',
        anchorX: 0.5,
        anchorY: 0.52,
        width: 50,
        height: 50
      })
    })
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

  function queue(id, src) {
    if (typeof Image === 'undefined' || images.has(id)) return;
    const image = new Image();
    image.decoding = 'async';
    imageState.set(id, 'loading');
    image.addEventListener('load', () => imageState.set(id, 'ready'), { once: true });
    image.addEventListener('error', () => imageState.set(id, 'error'), { once: true });
    image.src = src;
    images.set(id, image);
  }

  function preload() {
    for (const [stageId, definition] of Object.entries(MANIFEST.stages)) {
      queue(`stage:${stageId}`, definition.background);
    }
    for (const [partId, definition] of Object.entries(MANIFEST.parts)) {
      queue(`part:${partId}`, definition.src);
    }
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
    if (!definition || !ready(id)) return false;
    const image = images.get(id);
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const cacheKey = `${id}:${width}x${height}`;
    let cached = stageCache.get(cacheKey);
    if (!cached && root.document?.createElement) {
      cached = root.document.createElement('canvas');
      cached.width = width;
      cached.height = height;
      const cacheContext = cached.getContext('2d');
      if (cacheContext) {
        paintStageBackground(cacheContext, image, definition, {
          x: 0,
          y: 0,
          width,
          height
        });
        stageCache.set(cacheKey, cached);
      } else {
        cached = null;
      }
    }
    if (cached) {
      ctx.drawImage(cached, bounds.x, bounds.y, bounds.width, bounds.height);
    } else {
      paintStageBackground(ctx, image, definition, bounds);
    }
    return true;
  }

  function drawPart(ctx, partId, options = {}) {
    if (!isEnabled()) return false;
    const definition = MANIFEST.parts[partId];
    const id = `part:${partId}`;
    if (!definition || !ready(id)) return false;
    const image = images.get(id);
    const width = options.width || definition.width;
    const height = options.height || definition.height;
    const anchorX = options.anchorX ?? definition.anchorX;
    const anchorY = options.anchorY ?? definition.anchorY;
    const cacheKey = `${id}:${width}x${height}`;
    let drawable = partCache.get(cacheKey);
    if (!drawable && root.document?.createElement) {
      drawable = root.document.createElement('canvas');
      drawable.width = Math.max(1, Math.ceil(width));
      drawable.height = Math.max(1, Math.ceil(height));
      const partContext = drawable.getContext('2d');
      if (partContext) {
        partContext.imageSmoothingEnabled = true;
        partContext.imageSmoothingQuality = 'high';
        partContext.drawImage(image, 0, 0, drawable.width, drawable.height);
        partCache.set(cacheKey, drawable);
      } else {
        drawable = null;
      }
    }
    ctx.save();
    ctx.translate(options.x || 0, options.y || 0);
    ctx.rotate(options.rotation || 0);
    ctx.scale(options.face < 0 ? -1 : 1, 1);
    ctx.globalAlpha *= options.opacity ?? 1;
    if (options.filter) ctx.filter = options.filter;
    ctx.drawImage(drawable || image, -width * anchorX, -height * anchorY, width, height);
    ctx.restore();
    return true;
  }

  function status() {
    return Object.freeze(Object.fromEntries(imageState));
  }

  const api = Object.freeze({
    MANIFEST,
    preload,
    ready,
    isEnabled,
    drawStageBackground,
    drawPart,
    status
  });
  root.NEON_ART = api;
  preload();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
