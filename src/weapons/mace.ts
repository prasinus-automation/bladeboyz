import { AttackDirection } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Mace -- heavy blunt weapon.
 *
 * All timing values in ticks (1 tick = 1/60s ~= 16.7ms).
 *
 * Design philosophy:
 * - Slow and deliberate: long windup/recovery punishes whiffed swings
 * - Devastating damage: head shots deal 50+ damage
 * - High stamina pressure: drains blockers quickly with blockStaminaDrain
 * - Short range forces you into danger to land hits
 * - Overhead is the signature move: slowest but highest damage
 */
export const mace: WeaponConfig = {
  name: 'Mace',

  // -- Damage per direction per body zone ----------------

  damage: {
    [AttackDirection.Left]: { head: 48, torso: 35, limb: 22 },
    [AttackDirection.Right]: { head: 48, torso: 35, limb: 22 },
    [AttackDirection.Overhead]: { head: 55, torso: 40, limb: 25 },
    [AttackDirection.Underhand]: { head: 45, torso: 32, limb: 20 },
    [AttackDirection.Stab]: { head: 42, torso: 30, limb: 20 },
  },

  // -- Windup durations (ticks) --------------------------
  // Slow across the board. Overhead is punishing at 29 ticks (~483ms).

  windup: {
    [AttackDirection.Left]: 21,      // ~350ms
    [AttackDirection.Right]: 21,     // ~350ms
    [AttackDirection.Overhead]: 29,  // ~483ms -- signature slam
    [AttackDirection.Underhand]: 23, // ~383ms
    [AttackDirection.Stab]: 17,      // ~283ms -- pommel strike
  },

  // -- Release / active swing durations (ticks) ----------

  release: {
    [AttackDirection.Left]: 14,      // ~233ms
    [AttackDirection.Right]: 14,     // ~233ms
    [AttackDirection.Overhead]: 17,  // ~283ms
    [AttackDirection.Underhand]: 14, // ~233ms
    [AttackDirection.Stab]: 12,      // ~200ms
  },

  // -- Full recovery durations (ticks) -------------------
  // Very long recovery. Missing a swing is costly.

  recovery: {
    [AttackDirection.Left]: 34,      // ~567ms
    [AttackDirection.Right]: 34,     // ~567ms
    [AttackDirection.Overhead]: 46,  // ~767ms
    [AttackDirection.Underhand]: 40, // ~667ms
    [AttackDirection.Stab]: 32,      // ~533ms
  },

  // -- Combo recovery durations (ticks) ------------------

  comboRecovery: {
    [AttackDirection.Left]: 23,      // ~383ms
    [AttackDirection.Right]: 23,     // ~383ms
    [AttackDirection.Overhead]: 32,  // ~533ms
    [AttackDirection.Underhand]: 27, // ~450ms
    [AttackDirection.Stab]: 21,      // ~350ms
  },

  // -- Parry window (ticks) ------------------------------
  parryWindow: 10,

  // -- Stamina costs -------------------------------------

  staminaCost: {
    attack: 18,
    block: 12,
    parry: 6,
    feint: 22,
  },

  // -- Turncaps (radians per tick) -----------------------
  // Heavier weapon = more restricted turning.

  turncap: {
    windup: 0.06,
    release: 0.02,
    recovery: 0.04,
  },

  // -- Tracer points (local space) -----------------------
  // 3 points on the mace head only (not the shaft).

  tracerPoints: [
    [0, 0.45, 0],   // bottom of head
    [0, 0.55, 0],   // center of head
    [0, 0.65, 0],   // top of head
  ],

  // -- Range ---------------------------------------------
  range: 0.6,

  // -- Combat resolution values --------------------------

  blockStaminaDrain: 25,
  parryStunTicks: 68,
  hitStunTicks: 50,
};

registerWeapon(mace);
