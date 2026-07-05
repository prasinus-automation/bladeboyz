import { Direction } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Longsword — the baseline weapon.
 *
 * All timing values in ticks (1 tick = 1/60s ≈ 16.7ms).
 * All turncap values in radians per tick.
 *
 * Design philosophy:
 * - Head shots are ~50 damage (2-hit kill on 100 HP)
 * - Torso shots are ~35 damage (3-hit kill)
 * - Limb shots are ~25 damage (4-hit kill)
 * - Stab has slightly different profile: moderate head, higher torso
 * - Overhead has longest windup but most damage
 * - Left/Right swings are the fastest, bread-and-butter attacks
 */
export const longsword: WeaponConfig = {
  name: 'Longsword',

  // ── Damage per direction per body zone ────────────────

  damage: {
    [Direction.Left]: { head: 50, torso: 35, limb: 25 },
    [Direction.Right]: { head: 50, torso: 35, limb: 25 },
    [Direction.Overhead]: { head: 55, torso: 40, limb: 25 },
    [Direction.Stab]: { head: 45, torso: 40, limb: 20 },
  },

  // ── Windup durations (ticks) ──────────────────────────
  // How long before the blade becomes active after initiating an attack.
  // Overhead is slowest (25), horizontal swings are moderate (18).

  windup: {
    [Direction.Left]: 18,      // ~300ms
    [Direction.Right]: 18,     // ~300ms
    [Direction.Overhead]: 25,  // ~417ms — slowest but highest damage
    [Direction.Stab]: 15,      // ~250ms — fastest windup
  },

  // ── Release / active swing durations (ticks) ─────────
  // The window during which the blade can deal damage.
  // Stab is shortest (tight timing), overhead is longest.

  release: {
    [Direction.Left]: 12,      // ~200ms
    [Direction.Right]: 12,     // ~200ms
    [Direction.Overhead]: 15,  // ~250ms
    [Direction.Stab]: 10,      // ~167ms — narrow hit window
  },

  // ── Full recovery durations (ticks) ───────────────────
  // How long you're vulnerable after a swing completes.
  // Overhead has longest recovery to balance its high damage.

  recovery: {
    [Direction.Left]: 30,      // ~500ms
    [Direction.Right]: 30,     // ~500ms
    [Direction.Overhead]: 40,  // ~667ms — punished if you miss
    [Direction.Stab]: 28,      // ~467ms — quickest recovery
  },

  // ── Combo recovery durations (ticks) ──────────────────
  // Faster recovery when chaining into a follow-up attack.
  // Encourages aggressive play with mix-up potential.

  comboRecovery: {
    [Direction.Left]: 20,      // ~333ms
    [Direction.Right]: 20,     // ~333ms
    [Direction.Overhead]: 28,  // ~467ms
    [Direction.Stab]: 18,      // ~300ms
  },

  // ── Parry window (ticks) ──────────────────────────────
  // Duration at the start of block where a parry is registered.
  // 12 ticks ≈ 200ms — tight but learnable.

  parryWindow: 12,

  // ── Parry recovery (ticks) ────────────────────────────
  // Time the Parry pose locks before returning to Blocking (FSM v2).

  parryRecovery: 12,

  // ── Block-break stagger (ticks) ───────────────────────
  // Stagger applied when the blocker's stamina hits ≤ 0 mid-block (FSM v2).

  blockBreakStunTicks: 30,

  // ── Stamina costs ─────────────────────────────────────

  staminaCost: {
    attack: 15,   // moderate cost per swing
    block: 10,    // holding block drains stamina on impact
    parry: 5,     // successful parry costs very little
  },

  // ── Turncaps (radians per tick) ───────────────────────
  // Restricts how fast the player can rotate during each phase.
  // Creates the signature "drag" and "accel" manipulation feel.
  //
  // Reference values at 60Hz:
  //   0.08 rad/tick ≈ 4.8 rad/s ≈ 275°/s (windup: fairly free)
  //   0.03 rad/tick ≈ 1.8 rad/s ≈ 103°/s (release: restrictive)
  //   0.05 rad/tick ≈ 3.0 rad/s ≈ 172°/s (recovery: moderate)
  //   0.005 rad/tick ≈ 0.3 rad/s ≈ 17°/s (hitStun: nearly locked — staggered)

  turncap: {
    windup: 0.08,
    release: 0.03,
    recovery: 0.05,
    hitStun: 0.005,
  },

  // ── Tracer points (local space) ───────────────────────
  // Points along the blade used for swept-volume hit detection.
  // Y-axis is "up the blade" from hilt to tip.
  // Minimum 4 points for adequate coverage.

  tracerPoints: [
    [0, 0.2, 0],   // just above the crossguard
    [0, 0.5, 0],   // lower blade
    [0, 0.9, 0],   // upper blade
    [0, 1.3, 0],   // near the tip
  ],

  // ── Range ─────────────────────────────────────────────
  // Max extent of the weapon from the character root.
  // Used for broad-phase culling before tracer checks.

  range: 1.4,

  // ── Combat resolution values ──────────────────────────

  /** Stamina drained from blocker on successful block */
  blockStaminaDrain: 10,

  /** Recovery ticks applied to attacker when parried */
  parryStunTicks: 60,

  /** HitStun ticks applied to target on unblocked hit */
  hitStunTicks: 45,

  // ── Knockback ─────────────────────────────────────────
  // Solid shove — visibly rocks the target back a step.

  knockback: { force: 3.0, upward: 1.5 },
};

// Auto-register on import so systems can look up by name
registerWeapon(longsword);
