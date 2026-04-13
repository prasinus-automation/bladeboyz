/**
 * Directional attack and block detection from mouse movement.
 *
 * Direction is determined by sampling a buffer of recent mouse deltas
 * (~100ms at 60Hz ≈ 6 frames) and mapping the dominant axis to a direction.
 */

// ── Enums ─────────────────────────────────────────────────

export const enum AttackDirection {
  Left = 0,
  Right = 1,
  Overhead = 2,
  Underhand = 3,
  Stab = 4,
}

export const enum BlockDirection {
  Left = 0,
  Right = 1,
  Top = 2,
  Bottom = 3,
}

// ── Types ─────────────────────────────────────────────────

/** A single mouse movement sample with a timestamp (ms) */
export interface MouseDelta {
  dx: number;
  dy: number;
  /** Timestamp from performance.now() when this delta was captured */
  time: number;
}

// ── Configuration ─────────────────────────────────────────

/** Thresholds for direction detection — tweak these to adjust sensitivity */
export interface DirectionConfig {
  /** How far back in time (ms) to sample the mouse buffer (default: 100) */
  bufferWindowMs: number;
  /**
   * Minimum total movement magnitude to register a directional swing.
   * Below this threshold, the input is treated as a Stab (attack) or
   * defaults to Top (block). Measured in accumulated pixels.
   */
  stabThreshold: number;
  /**
   * Ratio of dominant axis to secondary axis required to avoid ambiguity.
   * E.g. 1.2 means the dominant axis must be at least 1.2× the other.
   * If both axes are close, attack falls back to Stab.
   */
  axisRatio: number;
}

/** Sensible defaults — tuned so stab doesn't fire during normal aiming */
export const DEFAULT_DIRECTION_CONFIG: DirectionConfig = {
  bufferWindowMs: 100,
  stabThreshold: 12,
  axisRatio: 1.2,
};

// ── Detection functions ───────────────────────────────────

/**
 * Sum the mouse deltas that fall within the configured time window.
 * Returns accumulated (dx, dy) totals.
 */
function sumRecentDeltas(
  buffer: readonly MouseDelta[],
  now: number,
  windowMs: number,
): { totalDx: number; totalDy: number } {
  let totalDx = 0;
  let totalDy = 0;
  const cutoff = now - windowMs;

  // Buffer is assumed chronological — iterate backwards for efficiency
  for (let i = buffer.length - 1; i >= 0; i--) {
    const entry = buffer[i];
    if (entry.time < cutoff) break;
    totalDx += entry.dx;
    totalDy += entry.dy;
  }

  return { totalDx, totalDy };
}

/**
 * Detect the intended attack direction from a buffer of recent mouse deltas.
 *
 * - Dominant horizontal left  → Left
 * - Dominant horizontal right → Right
 * - Dominant vertical up      → Overhead
 * - Dominant vertical down    → Underhand
 * - Below threshold / ambiguous → Stab
 *
 * Stab can also be forced externally (scroll wheel / middle mouse) —
 * the caller should check for that before calling this function.
 *
 * @param buffer  Chronologically ordered mouse delta samples
 * @param now     Current time from performance.now()
 * @param config  Detection sensitivity settings (uses defaults if omitted)
 */
export function detectAttackDirection(
  buffer: readonly MouseDelta[],
  now: number,
  config: DirectionConfig = DEFAULT_DIRECTION_CONFIG,
): AttackDirection {
  if (buffer.length === 0) return AttackDirection.Stab;

  const { totalDx, totalDy } = sumRecentDeltas(buffer, now, config.bufferWindowMs);
  const absX = Math.abs(totalDx);
  const absY = Math.abs(totalDy);
  const magnitude = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

  // Very little mouse movement → stab
  if (magnitude < config.stabThreshold) {
    return AttackDirection.Stab;
  }

  // Check if one axis clearly dominates the other
  if (absX > absY * config.axisRatio) {
    // Horizontal dominant
    return totalDx < 0 ? AttackDirection.Left : AttackDirection.Right;
  } else if (absY > absX * config.axisRatio) {
    // Vertical dominant (negative Y = up in screen coords)
    return totalDy < 0 ? AttackDirection.Overhead : AttackDirection.Underhand;
  }

  // Ambiguous — no clear dominant axis → stab
  return AttackDirection.Stab;
}

/**
 * Detect the intended block direction from a buffer of recent mouse deltas.
 *
 * - Dominant horizontal left  → Left
 * - Dominant horizontal right → Right
 * - Dominant vertical up      → Top
 * - Dominant vertical down    → Bottom
 *
 * Falls back to Top if movement is below threshold (safe default).
 *
 * @param buffer  Chronologically ordered mouse delta samples
 * @param now     Current time from performance.now()
 * @param config  Detection sensitivity settings (uses defaults if omitted)
 */
export function detectBlockDirection(
  buffer: readonly MouseDelta[],
  now: number,
  config: DirectionConfig = DEFAULT_DIRECTION_CONFIG,
): BlockDirection {
  if (buffer.length === 0) return BlockDirection.Top;

  const { totalDx, totalDy } = sumRecentDeltas(buffer, now, config.bufferWindowMs);
  const absX = Math.abs(totalDx);
  const absY = Math.abs(totalDy);
  const magnitude = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

  // Very little movement → default top block
  if (magnitude < config.stabThreshold) {
    return BlockDirection.Top;
  }

  // Determine dominant axis
  if (absX > absY * config.axisRatio) {
    return totalDx < 0 ? BlockDirection.Left : BlockDirection.Right;
  } else if (absY > absX * config.axisRatio) {
    return totalDy < 0 ? BlockDirection.Top : BlockDirection.Bottom;
  }

  // Ambiguous → default top
  return BlockDirection.Top;
}

/**
 * Force a stab direction. Call this when the player uses an explicit
 * stab input (scroll wheel, middle mouse button) instead of relying
 * on mouse movement detection.
 */
export function forceStab(): AttackDirection {
  return AttackDirection.Stab;
}
