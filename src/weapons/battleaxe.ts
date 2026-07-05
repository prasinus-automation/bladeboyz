import { Direction } from '../combat/directions';
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
    [Direction.Left]: { head: 65, torso: 45, limb: 30 },
    [Direction.Right]: { head: 65, torso: 45, limb: 30 },
    [Direction.Overhead]: { head: 75, torso: 55, limb: 35 },
    [Direction.Stab]: { head: 55, torso: 40, limb: 28 },
  },

  // -- Windup durations (ticks) --------------------------
  // Very slow. Overhead is glacial at 31 ticks (~517ms).

  windup: {
    [Direction.Left]: 23,      // ~383ms
    [Direction.Right]: 23,     // ~383ms
    [Direction.Overhead]: 31,  // ~517ms -- massive telegraph
    [Direction.Stab]: 19,      // ~317ms -- butt spike thrust
  },

  // -- Release / active swing durations (ticks) ----------
  // Long release window compensates for slow windup.

  release: {
    [Direction.Left]: 15,      // ~250ms
    [Direction.Right]: 15,     // ~250ms
    [Direction.Overhead]: 19,  // ~317ms
    [Direction.Stab]: 13,      // ~217ms
  },

  // -- Full recovery durations (ticks) -------------------
  // Extremely long. A whiffed swing is practically a death sentence.

  recovery: {
    [Direction.Left]: 22,
    [Direction.Right]: 22,
    [Direction.Overhead]: 30,
    [Direction.Stab]: 21,
  },

  // -- Combo recovery durations (ticks) ------------------
  // Still slow but shorter than full recovery to reward aggression.

  comboRecovery: {
    [Direction.Left]: 10,
    [Direction.Right]: 10,
    [Direction.Overhead]: 13,
    [Direction.Stab]: 9,
  },

  // -- Parry window (ticks) ------------------------------
  parryWindow: 14,

  // -- Parry recovery / block-break stagger (FSM v2) -----
  parryRecovery: 16,
  blockBreakStunTicks: 42,

  // -- Stamina costs -------------------------------------
  // Very expensive. Can only sustain a few swings.

  staminaCost: {
    attack: 24,
    block: 14,
    parry: 8,
  },

  // -- Turncaps (radians per tick) -----------------------
  // Heaviest weapon = most restricted turning.

  turncap: {
    windup: 0.1,
    release: 0.03,
    // Recovery is UNCAPPED (2026-07 fluidity pass): once the blade is
    // done, aim is free — the old cap read as "mouse stuck in molasses"
    // for the whole post-swing window. Release keeps the drag/accel cap.
    recovery: Infinity,
    // 0.02 rad/tick ≈ 69°/s while staggered — dazed, not frozen.
    hitStun: 0.02,
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
  hitStunTicks: 32,

  // ── Knockback ─────────────────────────────────────────
  // Full-commitment cleave — sends victims airborne.

  knockback: { force: 8.0, upward: 5.0 },
};

registerWeapon(battleaxe);
