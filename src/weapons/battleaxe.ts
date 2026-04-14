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
  // Very slow. Overhead is glacial at 30 ticks (~500ms).

  windup: {
    [AttackDirection.Left]: 26,      // ~433ms
    [AttackDirection.Right]: 26,     // ~433ms
    [AttackDirection.Overhead]: 30,  // ~500ms -- massive telegraph
    [AttackDirection.Underhand]: 28, // ~467ms
    [AttackDirection.Stab]: 26,      // ~433ms -- butt spike thrust
  },

  // -- Release / active swing durations (ticks) ----------
  // Long release window compensates for slow windup.

  release: {
    [AttackDirection.Left]: 12,      // ~200ms
    [AttackDirection.Right]: 12,     // ~200ms
    [AttackDirection.Overhead]: 14,  // ~233ms
    [AttackDirection.Underhand]: 13, // ~217ms
    [AttackDirection.Stab]: 12,      // ~200ms
  },

  // -- Full recovery durations (ticks) -------------------
  // Extremely long. A whiffed swing is practically a death sentence.

  recovery: {
    [AttackDirection.Left]: 28,      // ~467ms
    [AttackDirection.Right]: 28,     // ~467ms
    [AttackDirection.Overhead]: 32,  // ~533ms
    [AttackDirection.Underhand]: 30, // ~500ms
    [AttackDirection.Stab]: 28,      // ~467ms
  },

  // -- Combo recovery durations (ticks) ------------------
  // Still slow but shorter than full recovery to reward aggression.

  comboRecovery: {
    [AttackDirection.Left]: 20,      // ~333ms
    [AttackDirection.Right]: 20,     // ~333ms
    [AttackDirection.Overhead]: 24,  // ~400ms
    [AttackDirection.Underhand]: 22, // ~367ms
    [AttackDirection.Stab]: 20,      // ~333ms
  },

  // -- Parry window (ticks) ------------------------------
  parryWindow: 9,

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
  parryStunTicks: 50,
  hitStunTicks: 40,
};

registerWeapon(battleaxe);
