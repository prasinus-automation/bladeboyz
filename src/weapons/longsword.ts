import { AttackDirection } from '../combat/directions';
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
    [AttackDirection.Left]: { head: 50, torso: 35, limb: 25 },
    [AttackDirection.Right]: { head: 50, torso: 35, limb: 25 },
    [AttackDirection.Overhead]: { head: 55, torso: 40, limb: 25 },
    [AttackDirection.Underhand]: { head: 45, torso: 35, limb: 25 },
    [AttackDirection.Stab]: { head: 45, torso: 40, limb: 20 },
  },

  // ── Windup durations (ticks) ──────────────────────────
  // How long before the blade becomes active after initiating an attack.
  // Overhead is slowest (10), horizontal swings are fastest (6-7).

  windup: {
    [AttackDirection.Left]: 7,       // ~117ms
    [AttackDirection.Right]: 7,      // ~117ms
    [AttackDirection.Overhead]: 10,   // ~167ms — slowest but highest damage
    [AttackDirection.Underhand]: 8,  // ~133ms
    [AttackDirection.Stab]: 6,       // ~100ms — fastest windup
  },

  // ── Release / active swing durations (ticks) ─────────
  // The window during which the blade can deal damage.
  // Stab is shortest (tight timing), overhead is longest.

  release: {
    [AttackDirection.Left]: 5,       // ~83ms
    [AttackDirection.Right]: 5,      // ~83ms
    [AttackDirection.Overhead]: 6,   // ~100ms
    [AttackDirection.Underhand]: 5,  // ~83ms
    [AttackDirection.Stab]: 4,       // ~67ms — narrow hit window
  },

  // ── Full recovery durations (ticks) ───────────────────
  // How long you're vulnerable after a swing completes.
  // Overhead has longest recovery to balance its high damage.

  recovery: {
    [AttackDirection.Left]: 14,      // ~233ms
    [AttackDirection.Right]: 14,     // ~233ms
    [AttackDirection.Overhead]: 18,  // ~300ms — punished if you miss
    [AttackDirection.Underhand]: 15, // ~250ms
    [AttackDirection.Stab]: 12,      // ~200ms — quickest recovery
  },

  // ── Combo recovery durations (ticks) ──────────────────
  // Faster recovery when chaining into a follow-up attack.
  // Encourages aggressive play with mix-up potential.

  comboRecovery: {
    [AttackDirection.Left]: 9,       // ~150ms
    [AttackDirection.Right]: 9,      // ~150ms
    [AttackDirection.Overhead]: 12,  // ~200ms
    [AttackDirection.Underhand]: 10, // ~167ms
    [AttackDirection.Stab]: 8,       // ~133ms
  },

  // ── Parry window (ticks) ──────────────────────────────
  // Duration at the start of block where a parry is registered.
  // 8 ticks ≈ 133ms — tight but learnable.

  parryWindow: 8,

  // ── Stamina costs ─────────────────────────────────────

  staminaCost: {
    attack: 15,   // moderate cost per swing
    block: 10,    // holding block drains stamina on impact
    parry: 5,     // successful parry costs very little
    feint: 20,    // feinting is expensive to prevent spam
  },

  // ── Turncaps (radians per tick) ───────────────────────
  // Restricts how fast the player can rotate during each phase.
  // Creates the signature "drag" and "accel" manipulation feel.
  //
  // Reference values at 60Hz:
  //   0.08 rad/tick ≈ 4.8 rad/s ≈ 275°/s (windup: fairly free)
  //   0.03 rad/tick ≈ 1.8 rad/s ≈ 103°/s (release: restrictive)
  //   0.05 rad/tick ≈ 3.0 rad/s ≈ 172°/s (recovery: moderate)

  turncap: {
    windup: 0.08,
    release: 0.03,
    recovery: 0.05,
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
};

// Auto-register on import so systems can look up by name
registerWeapon(longsword);
