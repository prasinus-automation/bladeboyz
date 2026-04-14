import { AttackDirection } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Dagger -- fast, low-commitment weapon.
 *
 * All timing values in ticks (1 tick = 1/60s ~= 16.7ms).
 *
 * Design philosophy:
 * - Extremely fast: short windup and recovery enables rapid combos
 * - Low damage per hit but high DPS through volume of attacks
 * - Very short range forces risky close-quarters play
 * - Low stamina costs encourage aggressive feint-heavy play
 * - Stab is the bread-and-butter: fastest attack with decent torso damage
 */
export const dagger: WeaponConfig = {
  name: 'Dagger',

  // -- Damage per direction per body zone ----------------

  damage: {
    [AttackDirection.Left]: { head: 22, torso: 16, limb: 10 },
    [AttackDirection.Right]: { head: 22, torso: 16, limb: 10 },
    [AttackDirection.Overhead]: { head: 25, torso: 18, limb: 12 },
    [AttackDirection.Underhand]: { head: 20, torso: 15, limb: 10 },
    [AttackDirection.Stab]: { head: 22, torso: 18, limb: 11 },
  },

  // -- Windup durations (ticks) --------------------------
  // Very fast across the board. Stab is nearly instant at 6 ticks.

  windup: {
    [AttackDirection.Left]: 7,       // ~117ms
    [AttackDirection.Right]: 7,      // ~117ms
    [AttackDirection.Overhead]: 8,   // ~133ms
    [AttackDirection.Underhand]: 7,  // ~117ms
    [AttackDirection.Stab]: 6,       // ~100ms -- fastest attack
  },

  // -- Release / active swing durations (ticks) ----------
  // Very short windows require precise timing.

  release: {
    [AttackDirection.Left]: 5,       // ~83ms
    [AttackDirection.Right]: 5,      // ~83ms
    [AttackDirection.Overhead]: 6,   // ~100ms
    [AttackDirection.Underhand]: 5,  // ~83ms
    [AttackDirection.Stab]: 4,       // ~67ms
  },

  // -- Full recovery durations (ticks) -------------------
  // Fast recovery enables rapid follow-ups.

  recovery: {
    [AttackDirection.Left]: 12,      // ~200ms
    [AttackDirection.Right]: 12,     // ~200ms
    [AttackDirection.Overhead]: 14,  // ~233ms
    [AttackDirection.Underhand]: 12, // ~200ms
    [AttackDirection.Stab]: 10,      // ~167ms
  },

  // -- Combo recovery durations (ticks) ------------------
  // Very fast combo recovery rewards aggressive play.

  comboRecovery: {
    [AttackDirection.Left]: 7,       // ~117ms
    [AttackDirection.Right]: 7,      // ~117ms
    [AttackDirection.Overhead]: 9,   // ~150ms
    [AttackDirection.Underhand]: 8,  // ~133ms
    [AttackDirection.Stab]: 6,       // ~100ms
  },

  // -- Parry window (ticks) ------------------------------
  parryWindow: 6,

  // -- Stamina costs -------------------------------------
  // Low costs allow sustained aggression.

  staminaCost: {
    attack: 8,
    block: 6,
    parry: 3,
    feint: 10,
  },

  // -- Turncaps (radians per tick) -----------------------
  // Light weapon = very free turning.

  turncap: {
    windup: 0.10,
    release: 0.05,
    recovery: 0.07,
  },

  // -- Tracer points (local space) -----------------------
  // 2 points along the short blade.

  tracerPoints: [
    [0, 0.18, 0],   // blade base
    [0, 0.32, 0],   // blade tip
  ],

  // -- Range ---------------------------------------------
  range: 0.35,

  // -- Combat resolution values --------------------------

  blockStaminaDrain: 8,
  parryStunTicks: 25,
  hitStunTicks: 20,
};

registerWeapon(dagger);
