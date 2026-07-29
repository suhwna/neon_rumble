(function exposeRenderEffects(root) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (from, to, amount) => from + (to - from) * amount;

  function particles(ctx, entries) {
    ctx.save();
    for (const particle of entries) {
      const fade = clamp(particle.life / particle.duration, 0, 1);
      const impact = particle.kind === 'impact';
      const size = Math.max(impact ? 1.25 : 1.6, particle.size * (impact ? .24 + fade * .76 : .48 + fade * .52));
      ctx.globalAlpha = Math.min(1, impact ? fade * 1.38 : fade * fade * 1.12);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(Math.round(particle.x), Math.round(particle.y), size * .52, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function blastMarks(ctx, entries) {
    for (const mark of entries) {
      const fade = clamp(mark.life / mark.duration, 0, 1);
      const expand = .72 + (1 - fade) * .28;
      ctx.save();
      ctx.translate(mark.x, mark.y);
      ctx.globalAlpha = fade * .28;
      ctx.fillStyle = mark.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.shadowColor = mark.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      for (let index = 0; index < 16; index++) {
        const angle = -Math.PI / 2 + index * Math.PI / 8;
        const radius = mark.radius * expand * (index % 2 ? .84 : 1);
        index ? ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius) : ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = fade * .8;
      ctx.stroke();
      ctx.restore();
    }
  }

  function shieldBreaks(ctx, entries, quality = 1) {
    for (const effect of entries) {
      const progress = 1 - clamp(effect.life / effect.duration, 0, 1);
      const collapse = clamp(progress / .18, 0, 1);
      const burstProgress = clamp((progress - .1) / .9, 0, 1);
      const fade = 1 - burstProgress;
      const shellRadius = lerp(effect.radius, effect.radius * .36, collapse);
      ctx.save();
      ctx.translate(effect.x, effect.y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = quality < .78 ? 0 : 6;
      if (progress < .3) {
        const shellFade = 1 - clamp((progress - .14) / .16, 0, 1);
        ctx.globalAlpha = .78 * shellFade;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4 + collapse * 2;
        for (let segment = 0; segment < 6; segment++) {
          const start = -Math.PI / 2 + segment * Math.PI / 3 + .08;
          ctx.beginPath();
          ctx.arc(0, 0, shellRadius, start, start + Math.PI * .22);
          ctx.stroke();
        }
        ctx.globalAlpha = .38 * shellFade;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(0, 0, shellRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (progress >= .08) {
        const expansion = effect.radius * (.42 + burstProgress * 1.08);
        const shardCount = quality < .78 ? 6 : 8;
        for (let shard = 0; shard < shardCount; shard++) {
          const angle = -Math.PI / 2 + shard * Math.PI * 2 / shardCount + (shard % 2 ? .08 : -.06);
          const distance = expansion * (.72 + (shard % 3) * .1);
          const x = Math.cos(angle) * distance;
          const y = Math.sin(angle) * distance;
          const length = (11 + (shard % 3) * 4) * (1 - burstProgress * .35);
          const width = 3.2 + (shard % 2) * 1.5;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle + burstProgress * (shard % 2 ? .55 : -.55));
          ctx.globalAlpha = fade * (shard % 4 === 0 ? .92 : .62);
          ctx.fillStyle = shard % 4 === 0 ? '#ffffff' : effect.color;
          ctx.beginPath();
          ctx.moveTo(length * .62, 0);
          ctx.lineTo(0, width);
          ctx.lineTo(-length * .62, 0);
          ctx.lineTo(0, -width);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        const flash = 1 - clamp(burstProgress / .34, 0, 1);
        if (flash > 0) {
          ctx.globalAlpha = flash * .9;
          ctx.fillStyle = '#ffffff';
          const size = 12 + burstProgress * 23;
          ctx.beginPath();
          ctx.moveTo(size, 0);
          ctx.lineTo(0, size * .55);
          ctx.lineTo(-size, 0);
          ctx.lineTo(0, -size * .55);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  function impactRings(ctx, entries, quality = 1) {
    for (const ring of entries) {
      const fade = clamp(ring.life / ring.duration, 0, 1);
      const radius = ring.radius * (.62 + (1 - fade) * .9);
      ctx.save();
      ctx.translate(ring.x, ring.y);
      ctx.globalAlpha = fade * .8;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 2.5 + fade * 4;
      ctx.shadowBlur = quality < .78 ? 0 : 4;
      ctx.shadowColor = ring.color;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
      if (quality >= .68) {
        ctx.globalAlpha *= .35;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, radius * .58, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function launchTrails(ctx, entries) {
    for (const trail of entries) {
      if (!trail.launch) continue;
      ctx.save();
      ctx.translate(trail.x, trail.y);
      const speed = Math.hypot(trail.vx, trail.vy);
      const length = clamp(speed * (trail.finisher ? .19 : .14), 58, trail.finisher ? 178 : 132);
      ctx.rotate(Math.atan2(trail.vy, trail.vx));
      const gradient = ctx.createLinearGradient(-length, 0, 4, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(trail.finisher ? .55 : .72, trail.color);
      gradient.addColorStop(1, 'rgba(255,255,255,.9)');
      ctx.globalAlpha = trail.life * (trail.finisher ? 2.8 : 2.25);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = clamp(speed / (trail.finisher ? 125 : 155), trail.finisher ? 5 : 3, trail.finisher ? 9 : 6);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-length, 0);
      ctx.lineTo(4, 0);
      ctx.stroke();
      if (trail.finisher) {
        ctx.globalAlpha *= .75;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-length * .72, 0);
        ctx.lineTo(5, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  const api = Object.freeze({ particles, blastMarks, shieldBreaks, impactRings, launchTrails });
  root.NEON_RENDER_EFFECTS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
