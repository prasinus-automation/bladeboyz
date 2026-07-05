import { Direction } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Katana — speed and flow.
 *
 * Fast slashes with the shortest combo recovery in the game: built for
 * chaining Left→Right→Left mixups. Individual hits are lighter than a
 * longsword's, but the tempo advantage wins extended exchanges. Barely
 * any knockback — this is a scalpel, not a shovel.
 */
export const katana: WeaponConfig = {
  name: 'Katana',

  damage: {
    [Direction.Left]: { head: 42, torso: 30, limb: 22 },
    [Direction.Right]: { head: 42, torso: 30, limb: 22 },
    [Direction.Overhead]: { head: 48, torso: 34, limb: 24 },
    [Direction.Stab]: { head: 40, torso: 34, limb: 18 },
  },

  windup: {
    [Direction.Left]: 14,
    [Direction.Right]: 14,
    [Direction.Overhead]: 19,
    [Direction.Stab]: 13,
  },

  release: {
    [Direction.Left]: 10,
    [Direction.Right]: 10,
    [Direction.Overhead]: 13,
    [Direction.Stab]: 9,
  },

  recovery: {
    [Direction.Left]: 24,
    [Direction.Right]: 24,
    [Direction.Overhead]: 32,
    [Direction.Stab]: 24,
  },

  comboRecovery: {
    [Direction.Left]: 12,
    [Direction.Right]: 12,
    [Direction.Overhead]: 18,
    [Direction.Stab]: 12,
  },

  parryWindow: 14,
  parryRecovery: 10,
  blockBreakStunTicks: 26,

  staminaCost: {
    attack: 13,
    block: 9,
    parry: 4,
  },

  turncap: {
    windup: 0.09,
    release: 0.04,
    recovery: 0.06,
    hitStun: 0.005,
  },

  tracerPoints: [
    [0, 0.25, 0],
    [0, 0.55, 0],
    [0, 0.85, 0],
    [0, 1.15, 0],
  ],

  range: 1.3,

  blockStaminaDrain: 8,
  parryStunTicks: 55,
  hitStunTicks: 40,

  knockback: { force: 1.5, upward: 0.3 },
};

registerWeapon(katana);
