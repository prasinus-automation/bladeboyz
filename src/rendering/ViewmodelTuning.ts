/**
 * ViewmodelTuning — visual-tuning constants for the first-person viewmodel.
 *
 * This module is the single home for every viewmodel feel-knob:
 *   - `ARM_OFFSET` (anchor position in camera-local space, doc §2)
 *   - Aim-sway lag (low-pass filter time constant, doc §7)
 *   - Locomotion bob (walk-speed threshold, stride frequency band, amplitudes,
 *     walk_amount smoothing, doc §6)
 *   - Idle breathing / hand drift / forearm sway (mutually-prime sinusoids,
 *     doc §5)
 *
 * Rationale (doc §2.2): "every constant in the module is a visual-tuning knob;
 * a single file is the right home for them, and it lets QA tweak feel without
 * spelunking through render code". This file is intentionally a flat constants
 * surface — no helpers, no logic. Anything that needs runtime state (e.g. the
 * `walkAmount` / `stridePhase` accumulators for the bob) lives in
 * `ViewmodelBob.ts`; anything that needs scene-graph mutation lives in
 * `ViewmodelRenderer.ts` / `ViewmodelAnimationSystem.ts`.
 *
 * Implements: issue #129. Background: `docs/viewmodel-architecture.md`.
 */

import * as THREE from 'three';

// ─── Anchor (doc §2) ───────────────────────────────────────

/**
 * Arm offset from the camera in camera-local space.
 *
 * The shoulder bone (`vm_upper_arm_R`) sits at the viewmodel group origin.
 * From there the bone chain runs forearm → hand → weapon_attach via
 * `(0, -BONE_LENGTH, 0)` offsets, and the per-state pose rotations
 * (see `ViewmodelAnimationData.ts`) are tuned with negative X rotations
 * that fold the chain along the +Z direction (camera-local backward).
 * Empirically the chain extends roughly `+0.63m` in camera-local Z from
 * the shoulder when idle.
 *
 * For the WHOLE chain (not just the upper arm) to land in front of the
 * camera — and within the vertical FOV given the chain's `-0.41m` Y drop
 * — the shoulder needs to sit at least `~-1.4m` forward. We use `-1.5m`
 * to give the weapon comfortable headroom inside the frustum.
 *
 * (Pre-fix value: `-0.4m`. With that, the elbow was inside the frustum
 * but the wrist + weapon ended up BEHIND the camera and never rendered.
 * The arm "appeared visible" only because the upper-arm box still
 * straddled the camera plane.)
 *
 * Do NOT raise `y` above 0 — that's the bug fixed in #81 (upper-arm box
 * clipped into the top of the viewport).
 *
 * Moved here from `ViewmodelRenderer.ts` per doc §2.2.
 */
export const ARM_OFFSET = new THREE.Vector3(0.25, -0.1, -1.5);

// ─── Aim-sway lag (doc §7) ─────────────────────────────────

/**
 * Time constant (seconds) for the rotational low-pass filter on the
 * viewmodel's quaternion. Sub-50ms is imperceptible (wasted compute);
 * above ~120ms players feel the weapon "fight" their aim. 80ms matches
 * Counter-Strike / Apex / Mordhau — adds weight without interfering with
 * aim. Frame-rate independent because the per-frame slerp blend factor
 * is `1 - exp(-dt / tau)`.
 */
export const AIM_SWAY_TAU_SECONDS = 0.080;

// ─── Locomotion bob (doc §6) ───────────────────────────────

/**
 * Player horizontal speed (m/s) at which `walkAmount` reaches its full
 * value of 1.0. Below this, the bob amplitude scales linearly down with
 * speed (so a slow walk reads as "small bob", a sprint reads as "full bob").
 *
 * 4 m/s is a typical sprint speed in arena shooters; tune in concert with
 * the player movement constants in `MovementSystem.ts`.
 */
export const WALK_SPEED = 4;

/**
 * Time constant (seconds) for the exponential smoothing applied to
 * `walkAmount`. Without smoothing, releasing the movement key at full speed
 * snaps `walkAmount` from 1 → 0 instantly and the bob clips to zero —
 * mid-stride the visible foot freezes in mid-air. 150ms matches the
 * perceived "settle" time for a stride and lets the bob decay smoothly.
 */
export const WALK_AMOUNT_TAU_SECONDS = 0.150;

/**
 * Stride frequency band (Hz). Lerp from min (walking) to max (sprinting)
 * as `walkAmount` ramps from 0 to 1. Maps to ~96–156 steps/min — typical
 * human gait range; sprinting feels right at the upper end without
 * becoming cartoonish.
 */
export const STRIDE_FREQ_MIN = 1.6;
export const STRIDE_FREQ_MAX = 2.6;

/**
 * Vertical bob amplitude (camera-local meters). Each footfall (twice per
 * stride pair) gives a peak — `dy = sin(stride_phase * 2π * 2) * amplitude`.
 * Read by `ViewmodelBob.update`.
 */
export const BOB_VERTICAL_AMPLITUDE = 0.012;

/**
 * Horizontal bob amplitude (camera-local meters). One full sway cycle per
 * stride pair, leaning the arm side-to-side as the player's body rocks —
 * `dx = sin(stride_phase * 2π) * amplitude`.
 */
export const BOB_HORIZONTAL_AMPLITUDE = 0.008;

// ─── Idle sway / breathing (doc §5) ────────────────────────

/**
 * Per-bone idle sway formulas. Each entry is `amplitude × sin(t · 2π · freq + phase)`.
 *
 * Frequencies (0.27, 0.31, 0.35, 0.40 Hz) are mutually prime in the sub-Hz
 * range — their LCM is far larger than any session length, so the
 * composite motion never visibly repeats. Amplitudes are conservative
 * (<0.015 rad ≈ <1°) — viewer reads "alive" rather than "drifting".
 *
 * Applied AFTER the slerp blend in `ViewmodelAnimationSystem` and ONLY
 * when `combatState === Idle`. See doc §5.2 for why post-slerp.
 */
export interface IdleSwayChannel {
  /** Bone in `viewmodel.bones` to apply the sway to. */
  bone: 'upper_arm_R' | 'forearm_R' | 'hand_R';
  /** Local Euler axis to rotate around. */
  axis: 'x' | 'y' | 'z';
  /** Frequency in Hz (turns per second). Wrapped in `t · 2π · freq`. */
  freq: number;
  /** Phase offset in radians. */
  phase: number;
  /** Peak amplitude in radians. */
  amplitude: number;
}

export const IDLE_SWAY_CHANNELS: readonly IdleSwayChannel[] = [
  // Breathing on upper_arm_R: slow chest rise, paired Y/X at quarter-cycle phase.
  { bone: 'upper_arm_R', axis: 'y', freq: 0.35, phase: 0,           amplitude: 0.012 },
  { bone: 'upper_arm_R', axis: 'x', freq: 0.35, phase: Math.PI / 2, amplitude: 0.006 },
  // Hand drift on hand_R: independent of breath, different freq/phase per axis.
  { bone: 'hand_R',      axis: 'x', freq: 0.27, phase: 1.0,         amplitude: 0.008 },
  { bone: 'hand_R',      axis: 'z', freq: 0.31, phase: 2.1,         amplitude: 0.005 },
  // Forearm sway on forearm_R: smallest contribution.
  { bone: 'forearm_R',   axis: 'z', freq: 0.40, phase: 0,           amplitude: 0.004 },
];
