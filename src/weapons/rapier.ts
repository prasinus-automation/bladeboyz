import { Direction } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Rapier — the fencer's scalpel.
 *
 * The stab specialist: the fastest thrust in the game, the longest parry
 * window, and slashes that exist mostly to feint with. Individual pokes
 * are light and the blade barely knocks anyone back — you win by tempo,
 * spacing, and riposte, not by trading. Pairs with the fencing-lunge
 * viewmodel set in ViewmodelAnimationData.ts.
 */
export const rapier: WeaponConfig = {
  name: 'Rapier',

  damage: {
    [Direction.Left]: { head: 30, torso: 22, limb: 14 },
    [Direction.Right]: { head: 30, torso: 22, limb: 14 },
    [Direction.Overhead]: { head: 32, torso: 24, limb: 15 },
    [Direction.Stab]: { head: 45, torso: 36, limb: 20 },
  },

  windup: {
    [Direction.Left]: 13,
    [Direction.Right]: 13,
    [Direction.Overhead]: 16,
    // Fastest thrust in the arsenal (dagger stab is 10) — the rapier's
    // whole identity.
    [Direction.Stab]: 9,
  },

  release: {
    [Direction.Left]: 9,
    [Direction.Right]: 9,
    [Direction.Overhead]: 11,
    [Direction.Stab]: 7,
  },

  recovery: {
    [Direction.Left]: 13,
    [Direction.Right]: 13,
    [Direction.Overhead]: 15,
    [Direction.Stab]: 9,
  },

  comboRecovery: {
    [Direction.Left]: 5,
    [Direction.Right]: 5,
    [Direction.Overhead]: 7,
    [Direction.Stab]: 4,
  },

  // The longest parry window in the game — riposte is the fantasy.
  parryWindow: 15,
  parryRecovery: 8,
  blockBreakStunTicks: 24,

  staminaCost: {
    attack: 10,
    block: 8,
    parry: 3,
  },

  turncap: {
    windup: 0.17,
    release: 0.08,
    // Recovery is UNCAPPED (2026-07 fluidity pass) — matches every other
    // weapon; release keeps the drag/accel cap.
    recovery: Infinity,
    hitStun: 0.02,
  },

  // Matches createRapierModel's blade exactly (TracerVisualParity.test).
  tracerPoints: [
    [0, 0.2, 0],
    [0, 0.65, 0],
    [0, 1.1, 0],
    [0, 1.52, 0],
  ],

  range: 1.6,

  blockStaminaDrain: 7,
  // Landing a parry with a rapier stings extra — the riposte reward.
  parryStunTicks: 60,
  hitStunTicks: 22,

  // A poke, not a shove.
  knockback: { force: 0.8, upward: 0.1 },
};

registerWeapon(rapier);
