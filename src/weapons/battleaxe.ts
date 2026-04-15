import { AttackDirection } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Battleaxe -- massive two-handed weapon.
 *
 * All timing values in ticks (1 tick = 1/60s ~= 16.7ms).
 *
 * Design philosophy:
 * - The slowest, most committal weapon in the game
 * - Highest damage: overhead headshots can nearly one-shot (75 damage)
 * - Very long range keeps enemies at bay
 * - Enormous stamina costs and recovery make every swing a calculated risk
 * - High block drain forces opponents to dodge rather than block
 * - Overhead is devastating but leaves you wide open on a miss
 */
export const battleaxe: WeaponConfig = {
  name: 'Battleaxe',

  // -- Damage per direction per body zone ----------------

  damage: {
    [AttackDirection.Left]: { head: 65, torso: 45, limb: 30 },
    [AttackDirection.Right]: { head: 65, torso: 45, limb: 30 },
    [AttackDirection.Overhead]: { head: 75, torso: 55, limb: 35 },
    [AttackDirection.Underhand]: { head: 60, torso: 42, limb: 30 },
    [AttackDirection.Stab]: { head: 55, torso: 40, limb: 28 },
  },

  // -- Windup durations (ticks) --------------------------
  // Very slow. Overhead is glacial at 31 ticks (~517ms).

  windup: {
    [AttackDirection.Left]: 23,      // ~383ms
    [AttackDirection.Right]: 23,     // ~383ms
    [AttackDirection.Overhead]: 31,  // ~517ms -- massive telegraph
    [AttackDirection.Underhand]: 25, // ~417ms
    [AttackDirection.Stab]: 19,      // ~317ms -- butt spike thrust
  },

  // -- Release / active swing durations (ticks) ----------
  // Long release window compensates for slow windup.

  release: {
    [AttackDirection.Left]: 15,      // ~250ms
    [AttackDirection.Right]: 15,     // ~250ms
    [AttackDirection.Overhead]: 19,  // ~317ms
    [AttackDirection.Underhand]: 15, // ~250ms
    [AttackDirection.Stab]: 13,      // ~217ms
  },

  // -- Full recovery durations (ticks) -------------------
  // Extremely long. A whiffed swing is practically a death sentence.

  recovery: {
    [AttackDirection.Left]: 38,      // ~633ms
    [AttackDirection.Right]: 38,     // ~633ms
    [AttackDirection.Overhead]: 50,  // ~833ms
    [AttackDirection.Underhand]: 44, // ~733ms
    [AttackDirection.Stab]: 35,      // ~583ms
  },

  // -- Combo recovery durations (ticks) ------------------
  // Still slow but shorter than full recovery to reward aggression.

  comboRecovery: {
    [AttackDirection.Left]: 25,      // ~417ms
    [AttackDirection.Right]: 25,     // ~417ms
    [AttackDirection.Overhead]: 35,  // ~583ms
    [AttackDirection.Underhand]: 29, // ~483ms
    [AttackDirection.Stab]: 23,      // ~383ms
  },

  // -- Parry window (ticks) ------------------------------
  parryWindow: 14,

  // -- Stamina costs -------------------------------------
  // Very expensive. Can only sustain a few swings.

  staminaCost: {
    attack: 24,
    block: 14,
    parry: 8,
    feint: 28,
  },

  // -- Turncaps (radians per tick) -----------------------
  // Heaviest weapon = most restricted turning.

  turncap: {
    windup: 0.05,
    release: 0.015,
    recovery: 0.03,
  },

  // -- Tracer points (local space) -----------------------
  // 4 points on the axe head (not the shaft).

  tracerPoints: [
    [0, 0.85, 0],    // bottom of axe head
    [0, 0.95, 0],    // lower axe head
    [0, 1.05, 0],    // upper axe head
    [0, 1.15, 0],    // top of axe head
  ],

  // -- Range ---------------------------------------------
  range: 1.2,

  // -- Combat resolution values --------------------------

  blockStaminaDrain: 30,
  parryStunTicks: 75,
  hitStunTicks: 55,
};

registerWeapon(battleaxe);
