import { Direction } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Warhammer — the home-run bat.
 *
 * Moderate damage, glacial windup, but the knockback is the whole point:
 * a clean overhead sends the victim airborne and tumbling. Built for
 * players who want to see enemies fly.
 */
export const warhammer: WeaponConfig = {
  name: 'Warhammer',

  damage: {
    [Direction.Left]: { head: 55, torso: 40, limb: 28 },
    [Direction.Right]: { head: 55, torso: 40, limb: 28 },
    [Direction.Overhead]: { head: 65, torso: 48, limb: 30 },
    [Direction.Stab]: { head: 30, torso: 25, limb: 15 },
  },

  windup: {
    [Direction.Left]: 30,
    [Direction.Right]: 30,
    [Direction.Overhead]: 36,
    [Direction.Stab]: 26,
  },

  release: {
    [Direction.Left]: 14,
    [Direction.Right]: 14,
    [Direction.Overhead]: 16,
    [Direction.Stab]: 10,
  },

  recovery: {
    [Direction.Left]: 27,
    [Direction.Right]: 27,
    [Direction.Overhead]: 33,
    [Direction.Stab]: 24,
  },

  comboRecovery: {
    [Direction.Left]: 12,
    [Direction.Right]: 12,
    [Direction.Overhead]: 15,
    [Direction.Stab]: 11,
  },

  parryWindow: 10,
  parryRecovery: 18,
  blockBreakStunTicks: 45,

  staminaCost: {
    attack: 26,
    block: 15,
    parry: 9,
  },

  turncap: {
    windup: 0.09,
    release: 0.028,
    // Recovery is UNCAPPED (2026-07 fluidity pass): once the blade is
    // done, aim is free — the old cap read as "mouse stuck in molasses"
    // for the whole post-swing window. Release keeps the drag/accel cap.
    recovery: Infinity,
    // 0.02 rad/tick ≈ 69°/s while staggered — dazed, not frozen.
    hitStun: 0.02,
  },

  // Short-ish haft, all the danger concentrated in the head.
  tracerPoints: [
    [0, 0.55, 0],
    [0, 0.7, 0],
    [0, 0.85, 0],
  ],

  range: 1.2,

  blockStaminaDrain: 22,
  parryStunTicks: 75,
  hitStunTicks: 34,

  // The whole point of this weapon. Launch angle worthy of a highlight reel.
  knockback: { force: 11.0, upward: 7.0 },
};

registerWeapon(warhammer);
