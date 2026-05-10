import { describe, it, expect, beforeEach } from 'vitest';
import { updateBob, resetBob, getBobState } from './ViewmodelBob';
import {
  WALK_SPEED,
  WALK_AMOUNT_TAU_SECONDS,
  STRIDE_FREQ_MIN,
  STRIDE_FREQ_MAX,
  BOB_VERTICAL_AMPLITUDE,
  BOB_HORIZONTAL_AMPLITUDE,
} from './ViewmodelTuning';

describe('ViewmodelBob', () => {
  beforeEach(() => {
    resetBob();
  });

  describe('initial state', () => {
    it('walkAmount starts at 0 and stridePhase starts at 0', () => {
      const state = getBobState();
      expect(state.walkAmount).toBe(0);
      expect(state.stridePhase).toBe(0);
    });

    it('returns zero offsets when player is stationary on first frame', () => {
      const out = updateBob(0.016, 0, 0);
      // walkAmount is still ~0 after one frame at speed=0, so both bobs are ~0
      expect(Math.abs(out.dx)).toBeLessThan(0.001);
      expect(Math.abs(out.dy)).toBeLessThan(0.001);
    });
  });

  describe('walkAmount smoothing', () => {
    it('walkAmount approaches 1 over time when player runs at WALK_SPEED', () => {
      // At WALK_SPEED, target is exactly 1.0
      // After 1 second (~6.7 time constants), walkAmount should be ~0.999
      for (let i = 0; i < 60; i++) {
        updateBob(1 / 60, WALK_SPEED, 0);
      }
      expect(getBobState().walkAmount).toBeGreaterThan(0.99);
    });

    it('walkAmount reaches ~63% (one time constant) after TAU seconds', () => {
      // Step exactly TAU seconds at full target velocity. Expected walkAmount ≈ 1 - exp(-1) = 0.632.
      // We integrate in many small dt steps to match the documented continuous-time behavior.
      const dt = 0.001;
      const steps = Math.round(WALK_AMOUNT_TAU_SECONDS / dt);
      for (let i = 0; i < steps; i++) {
        updateBob(dt, WALK_SPEED, 0);
      }
      // 1 - 1/e ≈ 0.632. Allow a wide tolerance for accumulation drift.
      expect(getBobState().walkAmount).toBeCloseTo(0.632, 2);
    });

    it('decays to ~37% (one time constant remaining) after stopping for TAU seconds', () => {
      // Warm up walkAmount close to 1.0. ~7 time constants → walkAmount ≈ 0.999.
      // (At 0.001s steps, 1500 iterations = 1.5s = 10 time constants.)
      for (let i = 0; i < 1500; i++) {
        updateBob(0.001, WALK_SPEED * 10, 0); // overshoot speed → still clamps to 1
      }
      expect(getBobState().walkAmount).toBeGreaterThan(0.999);

      // Stop, then advance TAU seconds in tiny steps — expected to decay to e^-1 ≈ 0.368.
      const dt = 0.001;
      const steps = Math.round(WALK_AMOUNT_TAU_SECONDS / dt);
      for (let i = 0; i < steps; i++) {
        updateBob(dt, 0, 0);
      }
      expect(getBobState().walkAmount).toBeCloseTo(0.368, 2);
    });

    it('clamps walkAmount to 1.0 even when speed exceeds WALK_SPEED', () => {
      // Speed = 4 × WALK_SPEED — target is min(1, 16/4) = min(1, 4) = 1.
      // 1500 iterations × 0.001s = 1.5s = 10τ → converges to ~0.99995.
      for (let i = 0; i < 1500; i++) {
        updateBob(0.001, WALK_SPEED * 4, 0);
      }
      expect(getBobState().walkAmount).toBeLessThanOrEqual(1.0001);
      expect(getBobState().walkAmount).toBeGreaterThan(0.999);
    });

    it('uses Euclidean horizontal magnitude (X + Z) for speed', () => {
      // 3-4-5 triangle: hypot(3, 4) = 5. Use values that reach WALK_SPEED.
      // velX=3, velZ=WALK_SPEED * 4/5, hypot ≈ WALK_SPEED.
      const vx = 3 * WALK_SPEED / 5;
      const vz = 4 * WALK_SPEED / 5;
      for (let i = 0; i < 1500; i++) {
        updateBob(0.001, vx, vz);
      }
      // Should reach ~1.0 just like running purely along X at WALK_SPEED.
      expect(getBobState().walkAmount).toBeGreaterThan(0.999);
    });

    it('frame-rate independent: same simulated duration → same walkAmount', () => {
      // Run 0.5s at 30Hz vs 144Hz — endpoints should match within tolerance.
      resetBob();
      const stepsA = 30 * 0.5;
      for (let i = 0; i < stepsA; i++) {
        updateBob(1 / 30, WALK_SPEED, 0);
      }
      const aWalk = getBobState().walkAmount;

      resetBob();
      const stepsB = Math.round(144 * 0.5);
      for (let i = 0; i < stepsB; i++) {
        updateBob(1 / 144, WALK_SPEED, 0);
      }
      const bWalk = getBobState().walkAmount;

      expect(aWalk).toBeCloseTo(bWalk, 2);
    });
  });

  describe('stride phase + bob output', () => {
    it('stride frequency lerps from MIN at walkAmount=0 to MAX at walkAmount=1', () => {
      // At walkAmount = 0, stridePhase advances at STRIDE_FREQ_MIN.
      // Hard to isolate cleanly, so just sanity-check both endpoints.
      resetBob();
      // Force walkAmount toward 1 first
      for (let i = 0; i < 600; i++) {
        updateBob(0.001, WALK_SPEED, 0);
      }
      const startPhase = getBobState().stridePhase;
      updateBob(1.0, WALK_SPEED, 0);
      const advance = getBobState().stridePhase - startPhase;
      // dt=1.0 at walkAmount≈1 → advance ≈ STRIDE_FREQ_MAX
      expect(advance).toBeGreaterThan(STRIDE_FREQ_MAX * 0.95);
      expect(advance).toBeLessThan(STRIDE_FREQ_MAX * 1.05);

      // At walkAmount=0, advance should be ~STRIDE_FREQ_MIN.
      resetBob();
      const minStart = getBobState().stridePhase;
      updateBob(1.0, 0, 0);
      const minAdvance = getBobState().stridePhase - minStart;
      // Tolerance: walkAmount may have edged off 0 in the smoothing pass —
      // at WALK_AMOUNT_TAU_SECONDS=0.150 and dt=1.0, walkAmount stays near 0
      // because the target is also 0. The advance is dominated by STRIDE_FREQ_MIN.
      expect(minAdvance).toBeGreaterThan(STRIDE_FREQ_MIN * 0.95);
      expect(minAdvance).toBeLessThan(STRIDE_FREQ_MIN * 1.05);
    });

    it('vertical bob (dy) oscillates within ±BOB_VERTICAL_AMPLITUDE at full walk', () => {
      // Run up to walkAmount ≈ 1 (1500 iterations × 0.001s = 10τ).
      for (let i = 0; i < 1500; i++) {
        updateBob(0.001, WALK_SPEED, 0);
      }
      expect(getBobState().walkAmount).toBeGreaterThan(0.999);

      // Sample for a full second — the vertical bob is at 2× stride freq
      // (2 * STRIDE_FREQ_MAX = 5.2 Hz at full sprint), so 1s contains ≥5 full
      // cycles and we'll see both extrema.
      let minDy = Infinity;
      let maxDy = -Infinity;
      for (let i = 0; i < 600; i++) {
        const out = updateBob(1 / 600, WALK_SPEED, 0);
        if (out.dy < minDy) minDy = out.dy;
        if (out.dy > maxDy) maxDy = out.dy;
      }
      // Should span very close to ±BOB_VERTICAL_AMPLITUDE
      expect(maxDy).toBeCloseTo(BOB_VERTICAL_AMPLITUDE, 3);
      expect(minDy).toBeCloseTo(-BOB_VERTICAL_AMPLITUDE, 3);
    });

    it('horizontal bob (dx) oscillates within ±BOB_HORIZONTAL_AMPLITUDE at full walk', () => {
      // Same warmup as the vertical test
      for (let i = 0; i < 1500; i++) {
        updateBob(0.001, WALK_SPEED, 0);
      }

      let minDx = Infinity;
      let maxDx = -Infinity;
      for (let i = 0; i < 1200; i++) {
        const out = updateBob(1 / 600, WALK_SPEED, 0);
        if (out.dx < minDx) minDx = out.dx;
        if (out.dx > maxDx) maxDx = out.dx;
      }
      expect(maxDx).toBeCloseTo(BOB_HORIZONTAL_AMPLITUDE, 3);
      expect(minDx).toBeCloseTo(-BOB_HORIZONTAL_AMPLITUDE, 3);
    });

    it('bob amplitude scales linearly with walkAmount', () => {
      // Run for a long time at WALK_SPEED/2 → walkAmount converges to 0.5.
      for (let i = 0; i < 5000; i++) {
        updateBob(0.001, WALK_SPEED / 2, 0);
      }
      const wa = getBobState().walkAmount;
      // Should converge to ~0.5
      expect(wa).toBeCloseTo(0.5, 2);

      // The peak vertical bob should now be ~0.5 × BOB_VERTICAL_AMPLITUDE
      let maxDy = -Infinity;
      for (let i = 0; i < 600; i++) {
        const out = updateBob(1 / 600, WALK_SPEED / 2, 0);
        if (out.dy > maxDy) maxDy = out.dy;
      }
      expect(maxDy).toBeCloseTo(BOB_VERTICAL_AMPLITUDE * 0.5, 3);
    });

    it('bob settles toward 0 after stopping (no abrupt clip)', () => {
      // Run up to walkAmount near 1 (1500 iterations = 10τ).
      for (let i = 0; i < 1500; i++) {
        updateBob(0.001, WALK_SPEED, 0);
      }
      // Stop and advance 3 × TAU seconds (≈ 95% decay) in tiny dt.
      const totalT = WALK_AMOUNT_TAU_SECONDS * 3;
      const dt = 0.001;
      const steps = Math.round(totalT / dt);
      for (let i = 0; i < steps; i++) {
        updateBob(dt, 0, 0);
      }
      // walkAmount should be ~5% of original
      expect(getBobState().walkAmount).toBeLessThan(0.06);
      // And bob amplitudes should be similarly tiny
      const out = updateBob(dt, 0, 0);
      expect(Math.abs(out.dx)).toBeLessThan(BOB_HORIZONTAL_AMPLITUDE * 0.1);
      expect(Math.abs(out.dy)).toBeLessThan(BOB_VERTICAL_AMPLITUDE * 0.1);
    });
  });

  describe('vertical-only velocity is ignored', () => {
    it('does not produce bob from a non-horizontal velocity (Y-only sources)', () => {
      // velX=velZ=0 — even if there were "vertical" velocity in the world
      // the bob doesn't see it. (We only call updateBob with the horizontal
      // components from main.ts.)
      for (let i = 0; i < 600; i++) {
        updateBob(0.001, 0, 0);
      }
      expect(getBobState().walkAmount).toBe(0);
      const out = updateBob(0.001, 0, 0);
      // Use abs comparison: walkAmount=0 multiplied by sin() may yield
      // signed-zero (-0) which `toBe(0)` rejects under Object.is semantics.
      expect(Math.abs(out.dx)).toBe(0);
      expect(Math.abs(out.dy)).toBe(0);
    });
  });

  describe('reset behavior', () => {
    it('resetBob() clears walkAmount, stridePhase, and last bob output', () => {
      for (let i = 0; i < 600; i++) {
        updateBob(0.001, WALK_SPEED, 0);
      }
      // Confirm state advanced
      expect(getBobState().walkAmount).toBeGreaterThan(0.5);
      expect(getBobState().stridePhase).toBeGreaterThan(0);

      resetBob();
      const post = getBobState();
      expect(post.walkAmount).toBe(0);
      expect(post.stridePhase).toBe(0);
    });

    it('after reset the next update starts from a fresh accumulator', () => {
      for (let i = 0; i < 600; i++) {
        updateBob(0.001, WALK_SPEED, 0);
      }
      resetBob();
      // First update post-reset — walkAmount has only dt=0.016 worth of
      // smoothing, so it stays small.
      updateBob(0.016, WALK_SPEED, 0);
      expect(getBobState().walkAmount).toBeLessThan(0.15);
    });
  });

  describe('dt edge cases', () => {
    it('dt=0 returns the current bob without advancing state', () => {
      // Build up some state
      for (let i = 0; i < 100; i++) {
        updateBob(0.01, WALK_SPEED, 0);
      }
      const before = getBobState();
      const out = updateBob(0, WALK_SPEED, 0);
      const after = getBobState();
      expect(after.walkAmount).toBe(before.walkAmount);
      expect(after.stridePhase).toBe(before.stridePhase);
      // Out is still finite
      expect(Number.isFinite(out.dx)).toBe(true);
      expect(Number.isFinite(out.dy)).toBe(true);
    });

    it('negative dt is treated like dt=0 (no advance)', () => {
      for (let i = 0; i < 100; i++) {
        updateBob(0.01, WALK_SPEED, 0);
      }
      const before = getBobState();
      updateBob(-0.5, WALK_SPEED, 0);
      const after = getBobState();
      expect(after.walkAmount).toBe(before.walkAmount);
      expect(after.stridePhase).toBe(before.stridePhase);
    });
  });

  describe('zero-allocation', () => {
    it('returns the same object instance across calls', () => {
      const a = updateBob(0.016, WALK_SPEED, 0);
      const b = updateBob(0.016, WALK_SPEED, 0);
      // Same object reference — no per-frame { dx, dy } allocations.
      expect(a).toBe(b);
    });
  });
});
