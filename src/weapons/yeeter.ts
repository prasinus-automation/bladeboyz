import { Direction } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * The Yeeter — an entire tree trunk.
 *
 * The joke weapon that is also a physics toy: pitiful damage, geological
 * windup, and the single largest knockback in the game. A connected swing
 * doesn't wound people so much as RELOCATE them. Buy it for the highlight
 * reel, keep it for the crowd control.
 */
export const yeeter: WeaponConfig = {
  name: 'Yeeter',

  damage: {
    [Direction.Left]: { head: 20, torso: 15, limb: 10 },
    [Direction.Right]: { head: 20, torso: 15, limb: 10 },
    [Direction.Overhead]: { head: 25, torso: 18, limb: 12 },
    [Direction.Stab]: { head: 12, torso: 10, limb: 6 },
  },

  windup: {
    [Direction.Left]: 38,
    [Direction.Right]: 38,
    [Direction.Overhead]: 45,
    [Direction.Stab]: 34,
  },

  release: {
    [Direction.Left]: 18,
    [Direction.Right]: 18,
    [Direction.Overhead]: 20,
    [Direction.Stab]: 12,
  },

  recovery: {
    [Direction.Left]: 33,
    [Direction.Right]: 33,
    [Direction.Overhead]: 39,
    [Direction.Stab]: 29,
  },

  comboRecovery: {
    [Direction.Left]: 15,
    [Direction.Right]: 15,
    [Direction.Overhead]: 18,
    [Direction.Stab]: 13,
  },

  parryWindow: 8,
  parryRecovery: 20,
  blockBreakStunTicks: 50,

  staminaCost: {
    attack: 32,
    block: 18,
    parry: 12,
  },

  turncap: {
    windup: 0.08,
    release: 0.022,
    // Recovery is UNCAPPED (2026-07 fluidity pass): once the blade is
    // done, aim is free — the old cap read as "mouse stuck in molasses"
    // for the whole post-swing window. Release keeps the drag/accel cap.
    recovery: Infinity,
    // 0.02 rad/tick ≈ 69°/s while staggered — dazed, not frozen.
    hitStun: 0.02,
  },

  // It's a log. The entire log is the hitbox.
  tracerPoints: [
    [0, 0.4, 0],
    [0, 0.8, 0],
    [0, 1.2, 0],
    [0, 1.6, 0],
    [0, 2.0, 0],
  ],

  range: 2.1,

  blockStaminaDrain: 30,
  parryStunTicks: 80,
  hitStunTicks: 38,

  // YEET. Force tuned so a clean hit clears several meters with hang time.
  knockback: { force: 16.0, upward: 10.0 },
};

registerWeapon(yeeter);
