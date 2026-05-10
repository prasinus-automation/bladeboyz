/**
 * Directional attack and block detection from mouse movement.
 *
 * FSM v2 (#88, #139): collapses v1's split `AttackDirection` (5 values:
 * Left/Right/Overhead/Stab/Underhand) and `BlockDirection` (4 values:
 * Left/Right/Top/Bottom) into a single unified `Direction` enum (4 values).
 *
 * A `Block(dir)` defends an attack with the **same** `dir` — holding
 * `Direction.Left` blocks an incoming `Direction.Left` slash. This is
 * a behavioural change from v1, which used opposed pairs (Left attack
 * countered by Right block); see `DamageSystem.doesBlockCounter`.
 */

import type { InputManager } from '../input/InputManager';

// ── Enum ─────────────────────────────────────────────────

/**
 * Unified direction for both attacks and blocks (FSM v2, #139).
 *
 * Wire format note: when the network protocol (#92, see
 * `docs/networking/02-replication-and-protocol.md`) encodes direction,
 * it uses these numeric values directly. Re-adding `Underhand` post-MVP
 * MUST give it a new numeric slot (e.g. `Underhand = 4`) — never reuse
 * 3 (now `Stab`) and never reorder the existing four.
 */
export const enum Direction {
  Overhead = 0,
  /** Slash from attacker's right → left across the screen. */
  Left = 1,
  /** Slash from attacker's left → right across the screen. */
  Right = 2,
  Stab = 3,
}

// ── Configuration ─────────────────────────────────────────

/** Thresholds for direction detection — tweak these to adjust sensitivity */
export interface DirectionConfig {
  /**
   * How far back in time (ms) to sample the mouse buffer (default: 100).
   * Read by `detectDirection` when calling `inputManager.getAverageDelta`.
   */
  bufferWindowMs: number;
  /**
   * Minimum movement magnitude to register a directional swing.
   * Below this threshold, the input is treated as a Stab. Measured against
   * the *averaged* (per-sample) mouse delta returned by
   * `InputManager.getAverageDelta` — units are pixels-per-sample, NOT
   * total accumulated pixels (the v1 sum-based threshold).
   */
  stabThreshold: number;
  /**
   * Ratio of dominant axis to secondary axis required to avoid ambiguity.
   * E.g. 1.2 means the dominant axis must be at least 1.2× the other.
   * If both axes are close, falls back to Stab.
   */
  axisRatio: number;
}

/** Sensible defaults — tuned so stab doesn't fire during normal aiming */
export const DEFAULT_DIRECTION_CONFIG: DirectionConfig = {
  bufferWindowMs: 100,
  stabThreshold: 12,
  axisRatio: 1.2,
};

// ── Detection ────────────────────────────────────────────

/**
 * Pure helper — classify a `(dx, dy)` pair into a `Direction`. Used by
 * `detectDirection` and exposed as its own export so the algorithm can
 * be unit-tested without instantiating an `InputManager`.
 *
 * Algorithm (per FSM v2 §4):
 * 1. magnitude < stabThreshold       → `Stab`
 * 2. |dx| > axisRatio·|dy|, dx<0     → `Left`
 *    |dx| > axisRatio·|dy|, dx>0     → `Right`
 * 3. |dy| > axisRatio·|dx|, dy<0     → `Overhead`
 *    |dy| > axisRatio·|dx|, dy>0     → `Stab`   (folds the v1 Underhand)
 * 4. ambiguous                       → `Stab`
 */
export function detectDirectionFromDeltas(
  dx: number,
  dy: number,
  config: DirectionConfig = DEFAULT_DIRECTION_CONFIG,
): Direction {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const magnitude = Math.sqrt(dx * dx + dy * dy);

  // Very little mouse movement → stab.
  if (magnitude < config.stabThreshold) {
    return Direction.Stab;
  }

  // Horizontal dominant.
  if (absX > absY * config.axisRatio) {
    return dx < 0 ? Direction.Left : Direction.Right;
  }

  // Vertical dominant: up = Overhead, down would have been Underhand →
  // collapse into Stab in 4-direction mode.
  if (absY > absX * config.axisRatio) {
    return dy < 0 ? Direction.Overhead : Direction.Stab;
  }

  // Ambiguous — neither axis clearly dominates → stab.
  return Direction.Stab;
}

/**
 * Detect the intended swing direction from the InputManager's rolling mouse
 * buffer. Used for both Attack and Block inputs — the spec collapsed the
 * two detection paths in v2 because the algorithm was identical anyway.
 *
 * @param inputManager  Provides `getAverageDelta(windowMs)` over recent samples.
 * @param config        Sensitivity settings (uses defaults if omitted).
 */
export function detectDirection(
  inputManager: InputManager,
  config: DirectionConfig = DEFAULT_DIRECTION_CONFIG,
): Direction {
  const { dx, dy } = inputManager.getAverageDelta(config.bufferWindowMs);
  return detectDirectionFromDeltas(dx, dy, config);
}

/**
 * Force a stab direction. Call this when the player uses an explicit
 * stab input (scroll wheel, middle mouse button) instead of relying
 * on mouse movement detection.
 */
export function forceStab(): Direction {
  return Direction.Stab;
}
