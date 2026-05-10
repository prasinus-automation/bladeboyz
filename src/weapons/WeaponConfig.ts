/**
 * Data-driven weapon configuration.
 *
 * All timing values are in **ticks** (1 tick = 1/60th second at 60Hz fixed update).
 * All turncap values are in **radians per tick**.
 * Damage, stamina, and range values are unitless game values.
 *
 * Weapon behavior comes entirely from these config objects — no hardcoded
 * weapon logic in systems. To add a new weapon, create a config and register it.
 */

import { Direction } from '../combat/directions';

// ── Vector3 tuple for tracer points (avoids Three.js import) ──

/** Local-space position along the weapon mesh [x, y, z] */
export type TracerPoint = [x: number, y: number, z: number];

// ── Main interface ────────────────────────────────────────

export interface WeaponConfig {
  /** Display name */
  name: string;

  /**
   * Damage values per attack direction per body zone.
   * head/torso/limb let us reward skillful strikes (headshots).
   */
  damage: Record<Direction, { head: number; torso: number; limb: number }>;

  /** Windup duration before the blade becomes active (ticks) */
  windup: Record<Direction, number>;

  /** Release / active swing duration (ticks) */
  release: Record<Direction, number>;

  /** Full recovery after a swing completes (ticks) */
  recovery: Record<Direction, number>;

  /** Shorter recovery when chaining a combo (ticks) */
  comboRecovery: Record<Direction, number>;

  /** Parry window duration at the start of a block (ticks) */
  parryWindow: number;

  /**
   * Ticks the Parry pose locks before returning to Blocking (FSM v2).
   * Per-weapon: heavier weapons take longer to recover from a parry.
   */
  parryRecovery: number;

  /**
   * Ticks of stagger when Block breaks because the blocker's stamina hits ≤ 0.
   * Per-weapon: heavier weapons leave the blocker more vulnerable on a break.
   * Replaces the v1 module-level `BLOCK_BREAK_STUN_TICKS` constant
   * (still in use by `StaminaSystem`; migration is FSM v2 — B's job).
   */
  blockBreakStunTicks: number;

  /**
   * Stamina costs for different combat actions.
   * `feint` is optional: FSM v2 has no Feint state, but the field is kept
   * optional so a future re-add doesn't require another schema migration.
   */
  staminaCost: {
    attack: number;
    block: number;
    parry: number;
    /** Optional in MVP — FSM v2 removes the Feint state. */
    feint?: number;
  };

  /**
   * Turn-rate caps during different combat phases (radians per tick).
   * Lower values restrict mouse look more, creating the drag/accel feel.
   *
   * Reference: 0.03 rad/tick at 60Hz ≈ 1.8 rad/s ≈ 103°/s
   *
   * `hitStun` is new in FSM v2 — caps turning while staggered. Recommend
   * 0.005 rad/tick (very low — you're reeling, not aiming).
   */
  turncap: {
    windup: number;
    release: number;
    recovery: number;
    /** NEW (FSM v2): cap during HitStun. */
    hitStun: number;
  };

  /**
   * Local-space tracer points along the blade.
   * During Release, swept-volume checks run between consecutive tick
   * positions of these points against enemy hitbox sensors.
   */
  tracerPoints: TracerPoint[];

  /** Maximum tracer extent from the weapon root (units) */
  range: number;

  /** Stamina drained from blocker on successful block */
  blockStaminaDrain: number;

  /** Extra recovery ticks applied to attacker when parried */
  parryStunTicks: number;

  /** HitStun ticks applied to the target on unblocked hit */
  hitStunTicks: number;
}

// ── Registry ──────────────────────────────────────────────

/** All registered weapon configs, keyed by name */
export const weaponConfigs: Record<string, WeaponConfig> = {};

/** Register a weapon config so systems can look it up by name */
export function registerWeapon(config: WeaponConfig): void {
  weaponConfigs[config.name] = config;
}
