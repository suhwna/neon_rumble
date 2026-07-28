const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function selectRecoveryTarget(platforms, player) {
  const widePlatforms = platforms.filter(platform => platform.w >= 120);
  const solidPlatforms = widePlatforms.filter(platform => !platform.passThrough);
  const candidates = solidPlatforms.length ? solidPlatforms : widePlatforms;
  const scored = candidates.map(platform => {
    const leftLedge = platform.x - 8;
    const rightLedge = platform.x + platform.w + 8;
    const belowPlatform = player.y > platform.y - 35;
    const safeX = belowPlatform
      ? Math.abs(player.x - leftLedge) <= Math.abs(player.x - rightLedge) ? leftLedge : rightLedge
      : clamp(player.x, platform.x + 42, platform.x + platform.w - 42);
    const verticalPenalty = Math.max(0, player.y - platform.y) * .72;
    const stablePlatformBonus = Math.min(platform.w, 860) * .06;
    return { platform, x: safeX, score: Math.abs(safeX - player.x) + verticalPenalty - stablePlatformBonus };
  }).sort((a, b) => a.score - b.score);
  return scored[0] || { platform: { x: 400, y: 500, w: 480 }, x: 640 };
}

function isOffstage(platforms, player) {
  if (player.grounded || player.ledge) return false;
  return !platforms.some(platform =>
    player.x >= platform.x - 22 && player.x <= platform.x + platform.w + 22
    && player.y <= platform.y + 25
  );
}

module.exports = { selectRecoveryTarget, isOffstage };
