import { Direction } from '../combat/directions';
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
    [Direction.Left]: { head: 22, torso: 16, limb: 10 },
    [Direction.Right]: { head: 22, torso: 16, limb: 10 },
    [Direction.Overhead]: { head: 25, torso: 18, limb: 12 },
    [Direction.Stab]: { head: 22, torso: 18, limb: 11 },
  },

  // -- Windup durations (ticks) --------------------------
  // Very fast across the board. Stab is snappy at 10 ticks.

  windup: {
    [Direction.Left]: 12,      // ~200ms
    [Direction.Right]: 12,     // ~200ms
    [Direction.Overhead]: 16,  // ~267ms
    [Direction.Stab]: 10,      // ~167ms -- fastest attack
  },

  // -- Release / active swing durations (ticks) ----------
  // Short windows require precise timing.

  release: {
    [Direction.Left]: 8,       // ~133ms
    [Direction.Right]: 8,      // ~133ms
    [Direction.Overhead]: 10,  // ~167ms
    [Direction.Stab]: 7,       // ~117ms
  },

  // -- Full recovery durations (ticks) -------------------
  // Fast recovery enables rapid follow-ups.

  recovery: {
    [Direction.Left]: 20,      // ~333ms
    [Direction.Right]: 20,     // ~333ms
    [Direction.Overhead]: 26,  // ~433ms
    [Direction.Stab]: 18,      // ~300ms
  },

  // -- Combo recovery durations (ticks) ------------------
  // Very fast combo recovery rewards aggressive play.

  comboRecovery: {
    [Direction.Left]: 13,      // ~217ms
    [Direction.Right]: 13,     // ~217ms
    [Direction.Overhead]: 18,  // ~300ms
    [Direction.Stab]: 12,      // ~200ms
  },

  // -- Parry window (ticks) ------------------------------
  parryWindow: 8,

  // -- Parry recovery / block-break stagger (FSM v2) -----
  parryRecovery: 8,
  blockBreakStunTicks: 24,

  // -- Stamina costs -------------------------------------
  // Low costs allow sustained aggression.

  staminaCost: {
    attack: 8,
    block: 6,
    parry: 3,
  },

  // -- Turncaps (radians per tick) -----------------------
  // Light weapon = very free turning.

  turncap: {
    windup: 0.10,
    release: 0.05,
    recovery: 0.07,
    hitStun: 0.005, // nearly locked — staggered
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
  parryStunTicks: 40,
  hitStunTicks: 30,
};

registerWeapon(dagger);
