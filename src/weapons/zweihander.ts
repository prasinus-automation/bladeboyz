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
    [Direction.Left]: 42,
    [Direction.Right]: 42,
    [Direction.Overhead]: 52,
    [Direction.Stab]: 38,
  },

  comboRecovery: {
    [Direction.Left]: 30,
    [Direction.Right]: 30,
    [Direction.Overhead]: 38,
    [Direction.Stab]: 26,
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
    windup: 0.06,
    release: 0.02,
    recovery: 0.04,
    hitStun: 0.005,
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
  hitStunTicks: 55,

  // Heavy shove with real lift — two-hander momentum.
  knockback: { force: 7.0, upward: 3.0 },
};

registerWeapon(zweihander);
