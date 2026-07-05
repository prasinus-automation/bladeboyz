import { Direction } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Zweihander — colossal two-handed sword.
 *
 * The reach king among blades: slow, deliberate swings with a 1.9m blade
 * that hits like a truck and shoves targets hard. Punishing recovery when
 * whiffed. All timing in ticks (1/60s).
 */
export const zweihander: WeaponConfig = {
  name: 'Zweihander',

  damage: {
    [Direction.Left]: { head: 65, torso: 45, limb: 32 },
    [Direction.Right]: { head: 65, torso: 45, limb: 32 },
    [Direction.Overhead]: { head: 75, torso: 55, limb: 35 },
    [Direction.Stab]: { head: 50, torso: 45, limb: 25 },
  },

  windup: {
    [Direction.Left]: 26,
    [Direction.Right]: 26,
    [Direction.Overhead]: 32,
    [Direction.Stab]: 22,
  },

  release: {
    [Direction.Left]: 16,
    [Direction.Right]: 16,
    [Direction.Overhead]: 18,
    [Direction.Stab]: 12,
  },

  recovery: {
    [Direction.Left]: 25,
    [Direction.Right]: 25,
    [Direction.Overhead]: 31,
    [Direction.Stab]: 23,
  },

  comboRecovery: {
    [Direction.Left]: 11,
    [Direction.Right]: 11,
    [Direction.Overhead]: 14,
    [Direction.Stab]: 10,
  },

  parryWindow: 10,
  parryRecovery: 16,
  blockBreakStunTicks: 40,

  staminaCost: {
    attack: 24,
    block: 14,
    parry: 8,
  },

  turncap: {
    windup: 0.1,
    release: 0.03,
    // Recovery is UNCAPPED (2026-07 fluidity pass): once the blade is
    // done, aim is free — the old cap read as "mouse stuck in molasses"
    // for the whole post-swing window. Release keeps the drag/accel cap.
    recovery: Infinity,
    // 0.02 rad/tick ≈ 69°/s while staggered — dazed, not frozen.
    hitStun: 0.02,
  },

  // 1.9m of blade — five tracer points for coverage at the long reach.
  tracerPoints: [
    [0, 0.3, 0],
    [0, 0.7, 0],
    [0, 1.1, 0],
    [0, 1.5, 0],
    [0, 1.9, 0],
  ],

  range: 2.0,

  blockStaminaDrain: 18,
  parryStunTicks: 70,
  hitStunTicks: 32,

  // Heavy shove with real lift — two-hander momentum.
  knockback: { force: 7.0, upward: 3.0 },
};

registerWeapon(zweihander);
