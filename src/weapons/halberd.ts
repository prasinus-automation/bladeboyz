import { Direction } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Halberd — the polearm generalist.
 *
 * Axe blade on a long shaft: real reach (second only to the spear/scythe
 * family), a murderous overhead chop, and a serviceable thrust off the
 * top spike. Slower and clumsier up close — inside its arc it loses to
 * everything. Pairs with the high-grip polearm viewmodel set in
 * ViewmodelAnimationData.ts.
 */
export const halberd: WeaponConfig = {
  name: 'Halberd',

  damage: {
    [Direction.Left]: { head: 45, torso: 32, limb: 22 },
    [Direction.Right]: { head: 45, torso: 32, limb: 22 },
    [Direction.Overhead]: { head: 60, torso: 45, limb: 28 },
    [Direction.Stab]: { head: 38, torso: 34, limb: 20 },
  },

  windup: {
    [Direction.Left]: 22,
    [Direction.Right]: 22,
    [Direction.Overhead]: 26,
    // The top spike makes the thrust the halberd's quick option.
    [Direction.Stab]: 14,
  },

  release: {
    [Direction.Left]: 12,
    [Direction.Right]: 12,
    [Direction.Overhead]: 14,
    [Direction.Stab]: 9,
  },

  recovery: {
    [Direction.Left]: 20,
    [Direction.Right]: 20,
    [Direction.Overhead]: 26,
    [Direction.Stab]: 16,
  },

  comboRecovery: {
    [Direction.Left]: 10,
    [Direction.Right]: 10,
    [Direction.Overhead]: 13,
    [Direction.Stab]: 8,
  },

  parryWindow: 11,
  parryRecovery: 12,
  blockBreakStunTicks: 32,

  staminaCost: {
    attack: 18,
    block: 12,
    parry: 6,
  },

  turncap: {
    windup: 0.12,
    release: 0.05,
    recovery: Infinity,
    hitStun: 0.02,
  },

  // Matches createHalberdModel exactly (TracerVisualParity.test): upper
  // shaft, the axe blade's leading edge (x-offset), then up the top spike.
  tracerPoints: [
    [0, 1.45, 0],
    [0.16, 1.62, 0],
    [0.16, 1.78, 0],
    [0, 1.95, 0],
    [0, 2.15, 0],
  ],

  range: 2.2,

  blockStaminaDrain: 11,
  parryStunTicks: 50,
  hitStunTicks: 30,

  // Long lever, big shove — but not warhammer-launch territory.
  knockback: { force: 6, upward: 3 },
};

registerWeapon(halberd);
