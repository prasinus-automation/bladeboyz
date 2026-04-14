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
  // Slow across the board. Overhead is punishing at 24 ticks (~400ms).

  windup: {
    [AttackDirection.Left]: 20,      // ~333ms
    [AttackDirection.Right]: 20,     // ~333ms
    [AttackDirection.Overhead]: 24,  // ~400ms -- signature slam
    [AttackDirection.Underhand]: 22, // ~367ms
    [AttackDirection.Stab]: 20,      // ~333ms -- pommel strike
  },

  // -- Release / active swing durations (ticks) ----------

  release: {
    [AttackDirection.Left]: 8,       // ~133ms
    [AttackDirection.Right]: 8,      // ~133ms
    [AttackDirection.Overhead]: 10,  // ~167ms
    [AttackDirection.Underhand]: 9,  // ~150ms
    [AttackDirection.Stab]: 8,       // ~133ms
  },

  // -- Full recovery durations (ticks) -------------------
  // Very long recovery. Missing a swing is costly.

  recovery: {
    [AttackDirection.Left]: 22,      // ~367ms
    [AttackDirection.Right]: 22,     // ~367ms
    [AttackDirection.Overhead]: 26,  // ~433ms
    [AttackDirection.Underhand]: 24, // ~400ms
    [AttackDirection.Stab]: 22,      // ~367ms
  },

  // -- Combo recovery durations (ticks) ------------------

  comboRecovery: {
    [AttackDirection.Left]: 16,      // ~267ms
    [AttackDirection.Right]: 16,     // ~267ms
    [AttackDirection.Overhead]: 20,  // ~333ms
    [AttackDirection.Underhand]: 18, // ~300ms
    [AttackDirection.Stab]: 16,      // ~267ms
  },

  // -- Parry window (ticks) ------------------------------
  parryWindow: 7,

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
  parryStunTicks: 45,
  hitStunTicks: 35,
};

registerWeapon(mace);
