const { blazeTargetPriorityBonus } = require('./cpu-policy');

function selectCpuTarget(world, player, brain) {
  const candidates = world.players.filter(other =>
    other.i !== player.i && !other.eliminated && !other.respawn
    && (!world.rules.teams || other.team !== player.team)
  );
  if (!candidates.length) return null;

  const locked = candidates.find(other => other.i === brain?.targetId);
  if (locked && world.tick < (brain.targetLockUntil || 0)) return locked;

  const focusedBy = new Map();
  if (!world.rules.teams && candidates.length >= 2) {
    for (const [index, otherBrain] of world.cpuBrains || []) {
      if (index === player.i || otherBrain.targetId == null || world.tick >= (otherBrain.targetLockUntil || 0)) continue;
      focusedBy.set(otherBrain.targetId, (focusedBy.get(otherBrain.targetId) || 0) + 1);
    }
  }

  const selected = candidates
    .map(other => {
      const distance = Math.hypot(other.x - player.x, (other.y - player.y) * .72);
      const threat = other.action ? 55 : 0;
      const vulnerable = other.stun > 0 || other.landingLag > 0 ? 18 : 0;
      const retaliation = player.comboTimer > 0 && player.comboAttacker === other.i ? 72 : 0;
      const crowdFocus = (focusedBy.get(other.i) || 0) * 135;
      const finisherPriority = player.characterId === 'blaze' ? blazeTargetPriorityBonus(other.damage) : 0;
      return { other, score: distance + threat - vulnerable - retaliation + crowdFocus - finisherPriority };
    })
    .sort((first, second) => first.score - second.score || first.other.i - second.other.i)[0]?.other;

  if (brain && selected) {
    brain.targetId = selected.i;
    brain.targetLockUntil = world.tick + 36;
  }
  return selected;
}

function findIncomingThreat(world, player, target) {
  const projectile = world.entities.find(entity => {
    if (entity.owner === player.i || !['projectile', 'bomb'].includes(entity.type)) return false;
    const owner = world.players.find(other => other.i === entity.owner);
    if (world.rules.teams && owner?.team === player.team) return false;
    const dx = player.x - entity.x;
    const approaching = entity.type === 'bomb' || Math.sign(dx) === Math.sign(entity.vx);
    return approaching && Math.abs(dx) < 260 && Math.abs(player.y - entity.y) < 75;
  });
  if (projectile) return { kind: 'projectile', direction: Math.sign(projectile.x - player.x) || 1 };
  const enemies = world.players.filter(other =>
    other.i !== player.i && !other.eliminated && !other.respawn && other.action
    && (!world.rules.teams || other.team !== player.team)
  );
  const imminent = enemies
    .map(other => {
      const move = other.action.move || {};
      const startup = other.action.startup ?? move.startup ?? 0;
      const activeEnd = startup + (move.active || 0);
      const threateningFrame = other.action.frame >= Math.max(0, startup - 4)
        && other.action.frame <= activeEnd;
      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const reach = (move.reachX || 70) + (player.width + other.width) / 2 + 20;
      const threatening = threateningFrame && Math.abs(dx) <= reach
        && Math.abs(dy) < (move.reachY || 75);
      return threatening ? { other, distance: Math.hypot(dx, dy * .72) } : null;
    })
    .filter(Boolean)
    .sort((first, second) => first.distance - second.distance || first.other.i - second.other.i)[0];
  if (!imminent) return null;
  return {
    kind: 'attack',
    direction: Math.sign(imminent.other.x - player.x) || imminent.other.face || 1,
    attacker: imminent.other.i
  };
}

module.exports = { selectCpuTarget, findIncomingThreat };
