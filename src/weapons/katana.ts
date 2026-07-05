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
    [Direction.Left]: 14,
    [Direction.Right]: 14,
    [Direction.Overhead]: 19,
    [Direction.Stab]: 14,
  },

  comboRecovery: {
    [Direction.Left]: 5,
    [Direction.Right]: 5,
    [Direction.Overhead]: 8,
    [Direction.Stab]: 5,
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
    windup: 0.16,
    release: 0.07,
    // Recovery is UNCAPPED (2026-07 fluidity pass): once the blade is
    // done, aim is free — the old cap read as "mouse stuck in molasses"
    // for the whole post-swing window. Release keeps the drag/accel cap.
    recovery: Infinity,
    // 0.02 rad/tick ≈ 69°/s while staggered — dazed, not frozen.
    hitStun: 0.02,
  },

  tracerPoints: [
    // Synced to createKatanaModel's CURVED blade (#goal-2026-07
    // hit-accuracy pass) — the x offsets follow the curve the mesh
    // actually renders. Guarded by TracerVisualParity.test.ts.
    [0.02, 0.29, 0],
    [0.032, 0.573, 0],
    [0.044, 0.857, 0],
    [0.056, 1.14, 0],
  ],

  range: 1.3,

  blockStaminaDrain: 8,
  parryStunTicks: 55,
  hitStunTicks: 24,

  knockback: { force: 1.5, upward: 0.3 },
};

registerWeapon(katana);
