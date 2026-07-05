import { Direction } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Spear — reach and pokes.
 *
 * The stab specialist: fastest thrust in the game with 2.2m of reach.
 * Slashes exist but are half-hearted haft swats. Keep enemies at the tip
 * of the point; a spear user who lets someone inside is already dead.
 */
export const spear: WeaponConfig = {
  name: 'Spear',

  damage: {
    [Direction.Left]: { head: 30, torso: 22, limb: 15 },
    [Direction.Right]: { head: 30, torso: 22, limb: 15 },
    [Direction.Overhead]: { head: 35, torso: 25, limb: 16 },
    [Direction.Stab]: { head: 60, torso: 50, limb: 28 },
  },

  windup: {
    [Direction.Left]: 20,
    [Direction.Right]: 20,
    [Direction.Overhead]: 24,
    [Direction.Stab]: 12,
  },

  release: {
    [Direction.Left]: 12,
    [Direction.Right]: 12,
    [Direction.Overhead]: 14,
    [Direction.Stab]: 12,
  },

  recovery: {
    [Direction.Left]: 34,
    [Direction.Right]: 34,
    [Direction.Overhead]: 38,
    [Direction.Stab]: 26,
  },

  comboRecovery: {
    [Direction.Left]: 26,
    [Direction.Right]: 26,
    [Direction.Overhead]: 30,
    [Direction.Stab]: 18,
  },

  parryWindow: 12,
  parryRecovery: 12,
  blockBreakStunTicks: 32,

  staminaCost: {
    attack: 16,
    block: 11,
    parry: 6,
  },

  turncap: {
    windup: 0.07,
    release: 0.025,
    recovery: 0.05,
    hitStun: 0.005,
  },

  // Business end only — the tip half of a very long shaft.
  tracerPoints: [
    [0, 1.2, 0],
    [0, 1.6, 0],
    [0, 2.0, 0],
    [0, 2.3, 0],
  ],

  range: 2.4,

  blockStaminaDrain: 10,
  parryStunTicks: 55,
  hitStunTicks: 40,

  // A poke, however sharp, is not a shove.
  knockback: { force: 2.0, upward: 0.5 },
};

registerWeapon(spear);
