const { BUTTONS } = require('./content');
const { selectRecoveryTarget } = require('./cpu-navigation');
const { novaRecoveryChargeTarget } = require('./cpu-policy');

const intent = (horizontal = 0, vertical = 0, actions = 0) => ({ horizontal, vertical, actions });

function planCpuRecovery(world, player, profile, bounds) {
  const recovery = selectRecoveryTarget(world.platforms, player);
  const toward = Math.sign(recovery.x - player.x);
  if (player.ledge) {
    const roll = world.rng() < profile.defense * .35;
    return intent(roll ? -player.face : 0, roll ? 0 : -1, roll ? BUTTONS.SHIELD : 0);
  }
  if (player.stun > 0) {
    const landingSoon = player.vy > 0 && Math.abs(player.y - recovery.platform.y) < 100;
    return intent(toward, 0, landingSoon && profile.accuracy > .7 ? BUTTONS.SHIELD : 0);
  }

  const heightBelow = player.y - recovery.platform.y;
  const horizontalGap = Math.abs(recovery.x - player.x);
  const farSide = horizontalGap > 135;
  const falling = player.vy > 35;
  const emergency = player.y > bounds.bottom - 185
    || player.x < -bounds.marginX + 150
    || player.x > bounds.worldWidth + bounds.marginX - 150;

  const novaWarpCharge = player.characterId === 'nova'
    && player.action?.name === 'specialUp'
    && player.action?.move?.distanceCharge;
  if (novaWarpCharge) {
    const releaseAt = novaRecoveryChargeTarget({ horizontalGap, heightBelow, emergency });
    const progress = Math.max(0, Math.min(1, Number(player.action.chargeProgress) || 0));
    // Release once the preview star has covered the required route. Holding to
    // maximum on every recovery made NOVA overshoot ledges and waste drift.
    return intent(toward, -1, progress < releaseAt ? BUTTONS.SPECIAL : 0);
  }

  if (!player.freefall && player.jumps > 0 && (falling || heightBelow > -70 || emergency)) {
    return intent(toward, -1);
  }

  const recoveryNeeded = emergency
    || heightBelow > 105
    || player.jumps <= 0 && (falling || farSide && heightBelow > -55);
  if (player.recoveryAvailable && recoveryNeeded) {
    return intent(toward, -1, BUTTONS.SPECIAL);
  }

  const nearLedge = horizontalGap < 115 && Math.abs(heightBelow) < 125;
  if (!player.freefall && player.airDodgeAvailable && nearLedge && falling && profile.accuracy > .7) {
    return intent(toward, -1, BUTTONS.SHIELD);
  }
  return intent(toward, 0);
}

module.exports = { planCpuRecovery };
