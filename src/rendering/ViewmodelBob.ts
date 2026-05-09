/**
 * ViewmodelBob — locomotion bob math for the first-person viewmodel.
 *
 * Stateful module: holds `walkAmount` (smoothed scalar in [0, 1] tracking
 * player horizontal speed) and `stridePhase` (monotonic cycle counter)
 * across frames. Consumed by `ViewmodelRenderer.syncWithCamera`, which adds
 * `{dx, dy}` offsets to `ARM_OFFSET` in camera-local space BEFORE the
 * camera quaternion is applied — so the bob plays out in the player's
 * frame of reference rather than world space.
 *
 * Math (doc §6.2):
 *
 *   speed         = √(velX² + velZ²)
 *   targetWalk    = clamp(speed / WALK_SPEED, 0, 1)
 *   walkAmount   += (targetWalk - walkAmount) · (1 - exp(-dt / TAU))   ← smoothing
 *   strideFreq    = lerp(STRIDE_MIN, STRIDE_MAX, walkAmount)
 *   stridePhase  += dt · strideFreq
 *   dy            = sin(stridePhase · 2π · 2) · BOB_VERTICAL_AMPL · walkAmount
 *   dx            = sin(stridePhase · 2π)     · BOB_HORIZONTAL_AMPL · walkAmount
 *
 * The vertical bob is at 2× stride frequency (each footfall = one peak —
 * the dominant visual cue). The horizontal sway is at 1× — a full cycle
 * per stride pair, leaning the arm side-to-side as the player's body rocks.
 *
 * Zero per-frame allocations: returns a reused `{dx, dy}` object literal
 * with primitive fields. Callers that need to persist the values across
 * frames must copy them (the accumulator is overwritten on each call).
 *
 * Implements: issue #129 (parent #90).
 */

import {
  WALK_SPEED,
  WALK_AMOUNT_TAU_SECONDS,
  STRIDE_FREQ_MIN,
  STRIDE_FREQ_MAX,
  BOB_VERTICAL_AMPLITUDE,
  BOB_HORIZONTAL_AMPLITUDE,
} from './ViewmodelTuning';

/**
 * Bob output shape. Camera-local offsets in meters, added to `ARM_OFFSET`
 * before the camera quaternion is applied.
 */
export interface BobOffset {
  /** Horizontal (left-right) offset, camera-local x. */
  dx: number;
  /** Vertical offset, camera-local y. */
  dy: number;
}

// ─── Module-level state ──────────────────────────────────────

let walkAmount = 0;
let stridePhase = 0;

// Reused output object — zero per-frame allocations.
const _out: BobOffset = { dx: 0, dy: 0 };

// ─── Public API ──────────────────────────────────────────────

/**
 * Advance the bob state by one frame and return the resulting `{dx, dy}`.
 *
 * @param dt   Frame delta in seconds. Frame-rate-independent because the
 *             smoothing factor uses `1 - exp(-dt / TAU)`.
 * @param velX World-space player velocity on X (m/s). Y is intentionally
 *             ignored — bob is a locomotion signal, not a falling signal.
 * @param velZ World-space player velocity on Z (m/s).
 * @returns    Reused `{dx, dy}` object. **Do not retain across frames** —
 *             the next call mutates the same object.
 */
export function updateBob(dt: number, velX: number, velZ: number): BobOffset {
  // Defensive: a zero-or-negative dt (e.g. paused / first frame) just
  // returns the current state without advancing — avoids dividing by
  // zero in the smoothing factor and lets callers safely poll.
  if (dt <= 0) {
    _out.dx = Math.sin(stridePhase * 2 * Math.PI) * BOB_HORIZONTAL_AMPLITUDE * walkAmount;
    _out.dy = Math.sin(stridePhase * 2 * Math.PI * 2) * BOB_VERTICAL_AMPLITUDE * walkAmount;
    return _out;
  }

  // Target walk amount in [0, 1] from horizontal speed.
  const speed = Math.hypot(velX, velZ);
  const targetWalkAmount = Math.min(1, speed / WALK_SPEED);

  // Exponential smoothing toward the target — frame-rate independent.
  // alpha = 1 - exp(-dt/TAU): at dt=TAU, alpha ≈ 0.63 (one time constant).
  const alpha = 1 - Math.exp(-dt / WALK_AMOUNT_TAU_SECONDS);
  walkAmount += (targetWalkAmount - walkAmount) * alpha;

  // Stride frequency ramps with walk amount. lerp = a + (b - a) * t.
  const strideFreq =
    STRIDE_FREQ_MIN + (STRIDE_FREQ_MAX - STRIDE_FREQ_MIN) * walkAmount;
  stridePhase += dt * strideFreq;

  // Bob outputs — vertical at 2× stride freq, horizontal at 1×.
  _out.dy =
    Math.sin(stridePhase * 2 * Math.PI * 2) * BOB_VERTICAL_AMPLITUDE * walkAmount;
  _out.dx =
    Math.sin(stridePhase * 2 * Math.PI) * BOB_HORIZONTAL_AMPLITUDE * walkAmount;

  return _out;
}

/**
 * Reset bob state — clears `walkAmount` and `stridePhase` to zero.
 *
 * Use cases: respawn (so the bob doesn't carry over a stale stride from
 * the previous life), pointer-lock acquired (the player wasn't moving
 * during the lock-acquire frame, so resetting avoids a phantom step on
 * resume), test isolation (`beforeEach`).
 */
export function resetBob(): void {
  walkAmount = 0;
  stridePhase = 0;
  _out.dx = 0;
  _out.dy = 0;
}

/**
 * Snapshot of internal state for debug overlays / tests. Read-only.
 *
 * The walkAmount field is what the `--debug-viewmodel` overlay surfaces
 * as `walkAmt`; stridePhase shows up as `bobPhase`. See doc §10.2.
 */
export function getBobState(): { walkAmount: number; stridePhase: number } {
  return { walkAmount, stridePhase };
}
