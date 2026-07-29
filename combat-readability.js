(function exposeCombatReadability(root) {
  function statePriority(player, localIndex = -1) {
    const action = String(player.actionName || '');
    const phase = player.actionPhase;
    const attacking = /^(ground|air|special|ultimate|dashAttack|throw|getupAttack)/.test(action);
    const hit = action === 'hit' || action === 'groundHit' || action === 'grabbedHit' || player.hitstop > 0;
    const local = player.i === localIndex;
    return (attacking && phase === 'active' ? 40 : attacking ? 24 : 0)
      + (hit ? 32 : 0)
      + (local ? 10 : 0)
      + (Number(player.y) || 0) / 10_000;
  }

  function layerOrder(players, localIndex = -1) {
    return [...players].sort((first, second) => {
      const priority = statePriority(first, localIndex) - statePriority(second, localIndex);
      return priority || (first.i || 0) - (second.i || 0);
    });
  }

  function cue(player) {
    const action = String(player.actionName || '');
    if (action === 'hit' || action === 'groundHit' || action === 'grabbedHit' || player.hitstop > 0) return 'hit';
    if (/^(ground|air|special|ultimate|dashAttack|throw|getupAttack)/.test(action)) {
      if (player.actionPhase === 'startup' || player.actionPhase === 'charge') return 'windup';
      if (player.actionPhase === 'active') return 'active';
      if (player.actionPhase === 'recovery') return 'recovery';
    }
    if (/Dodge|roll|tech/.test(action)) return 'dodge';
    if (player.shielding || action === 'shield') return 'shield';
    return 'neutral';
  }

  function crowding(player, players, radiusX = 76, radiusY = 68) {
    if (!player || player.eliminated || player.respawn > 0) return 0;
    let nearby = 0;
    for (const other of players || []) {
      if (!other || other === player || other.i === player.i || other.eliminated || other.respawn > 0) continue;
      const dx = Math.abs((Number(other.x) || 0) - (Number(player.x) || 0));
      const dy = Math.abs((Number(other.y) || 0) - (Number(player.y) || 0));
      if (dx <= radiusX && dy <= radiusY) nearby++;
    }
    return Math.min(3, nearby);
  }

  const api = Object.freeze({ statePriority, layerOrder, cue, crowding });
  root.NEON_READABILITY = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
