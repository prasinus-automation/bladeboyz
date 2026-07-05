import { Direction } from '../combat/directions';
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
    [Direction.Left]: { head: 48, torso: 35, limb: 22 },
    [Direction.Right]: { head: 48, torso: 35, limb: 22 },
    [Direction.Overhead]: { head: 55, torso: 40, limb: 25 },
    [Direction.Stab]: { head: 42, torso: 30, limb: 20 },
  },

  // -- Windup durations (ticks) --------------------------
  // Slow across the board. Overhead is punishing at 29 ticks (~483ms).

  windup: {
    [Direction.Left]: 21,      // ~350ms
    [Direction.Right]: 21,     // ~350ms
    [Direction.Overhead]: 29,  // ~483ms -- signature slam
    [Direction.Stab]: 17,      // ~283ms -- pommel strike
  },

  // -- Release / active swing durations (ticks) ----------

  release: {
    [Direction.Left]: 14,      // ~233ms
    [Direction.Right]: 14,     // ~233ms
    [Direction.Overhead]: 17,  // ~283ms
    [Direction.Stab]: 12,      // ~200ms
  },

  // -- Full recovery durations (ticks) -------------------
  // Very long recovery. Missing a swing is costly.

  recovery: {
    [Direction.Left]: 34,      // ~567ms
    [Direction.Right]: 34,     // ~567ms
    [Direction.Overhead]: 46,  // ~767ms
    [Direction.Stab]: 32,      // ~533ms
  },

  // -- Combo recovery durations (ticks) ------------------

  comboRecovery: {
    [Direction.Left]: 23,      // ~383ms
    [Direction.Right]: 23,     // ~383ms
    [Direction.Overhead]: 32,  // ~533ms
    [Direction.Stab]: 21,      // ~350ms
  },

  // -- Parry window (ticks) ------------------------------
  parryWindow: 10,

  // -- Parry recovery / block-break stagger (FSM v2) -----
  parryRecovery: 14,
  blockBreakStunTicks: 36,

  // -- Stamina costs -------------------------------------

  staminaCost: {
    attack: 18,
    block: 12,
    parry: 6,
  },

  // -- Turncaps (radians per tick) -----------------------
  // Heavier weapon = more restricted turning.

  turncap: {
    windup: 0.06,
    release: 0.02,
    recovery: 0.04,
    hitStun: 0.005, // nearly locked — staggered
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

  // ── Knockback ─────────────────────────────────────────
  // Blunt crusher — knocks targets clean off their feet.

  knockback: { force: 6.0, upward: 4.0 },
};

registerWeapon(mace);
