import { describe, it, expect } from 'vitest';
import {
  computeBlockHoldOffsets,
  BLOCK_HOLD_PEAK_RAD,
  BLOCK_HOLD_PERIOD_TICKS,
  BLOCK_HOLD_FADEIN_SEC,
} from './blockMotion';
import { Direction } from '../combat/directions';

const ALL_DIRECTIONS = [
  Direction.Overhead,
  Direction.Left,
  Direction.Right,
  Direction.Stab,
];

/** Flatten a Pose into a list of numeric offset components. */
function components(pose: Record<string, { x?: number; y?: number; z?: number }>): number[] {
  const out: number[] = [];
  for (const bone of Object.keys(pose)) {
    const rot = pose[bone];
    if (rot.x !== undefined) out.push(rot.x);
    if (rot.y !== undefined) out.push(rot.y);
    if (rot.z !== undefined) out.push(rot.z);
  }
  return out;
}

describe('computeBlockHoldOffsets (#218 living guard)', () => {
  describe('determinism (networking-seam contract)', () => {
    it('returns identical offsets for identical inputs', () => {
      for (const dir of ALL_DIRECTIONS) {
        for (const t of [1, 17, 40, 73, 150]) {
          expect(computeBlockHoldOffsets(dir, t)).toEqual(
            computeBlockHoldOffsets(dir, t),
          );
        }
      }
    });

    it('uses no wall-clock / random source (pure function of args)', () => {
      // Two calls separated by real time must still agree.
      const a = computeBlockHoldOffsets(Direction.Left, 42);
      const b = computeBlockHoldOffsets(Direction.Left, 42);
      expect(a).toEqual(b);
    });
  });

  describe('amplitude bound (≤ ~2.5° peak)', () => {
    it('never exceeds BLOCK_HOLD_PEAK_RAD on any component', () => {
      for (const dir of ALL_DIRECTIONS) {
        for (let t = 1; t <= 300; t++) {
          for (const c of components(computeBlockHoldOffsets(dir, t))) {
            expect(Math.abs(c)).toBeLessThanOrEqual(BLOCK_HOLD_PEAK_RAD + 1e-9);
          }
        }
      }
    });

    it('actually reaches near the peak somewhere in a period (not degenerate)', () => {
      let maxSeen = 0;
      for (let t = 1; t <= BLOCK_HOLD_PERIOD_TICKS; t++) {
        for (const c of components(computeBlockHoldOffsets(Direction.Left, t + 60))) {
          maxSeen = Math.max(maxSeen, Math.abs(c));
        }
      }
      // The dominant (upper_arm_R) channel should swing close to full peak.
      expect(maxSeen).toBeGreaterThan(BLOCK_HOLD_PEAK_RAD * 0.9);
    });
  });

  describe('per-direction distinctness', () => {
    it('produces pairwise-different offsets at a representative tick', () => {
      const t = 55; // sin<0, so Overhead X<0 while Stab X>0 — genuinely distinct
      const poses = ALL_DIRECTIONS.map((d) =>
        JSON.stringify(computeBlockHoldOffsets(d, t)),
      );
      const unique = new Set(poses);
      expect(unique.size).toBe(ALL_DIRECTIONS.length);
    });

    it('Left and Right are mirror images (opposite Z sign)', () => {
      for (const t of [20, 33, 60, 90]) {
        const left = computeBlockHoldOffsets(Direction.Left, t);
        const right = computeBlockHoldOffsets(Direction.Right, t);
        expect(right.upper_arm_R!.z).toBeCloseTo(-left.upper_arm_R!.z!, 10);
        expect(right.forearm_R!.z).toBeCloseTo(-left.forearm_R!.z!, 10);
      }
    });

    it('lateral directions rock about Z, Overhead bobs about X', () => {
      const t = 20;
      const left = computeBlockHoldOffsets(Direction.Left, t);
      const overhead = computeBlockHoldOffsets(Direction.Overhead, t);
      // Left's dominant motion is Z, with no X channel.
      expect(left.upper_arm_R!.z).toBeDefined();
      expect(left.upper_arm_R!.x).toBeUndefined();
      // Overhead's dominant motion is X, with no Z channel.
      expect(overhead.upper_arm_R!.x).toBeDefined();
      expect(overhead.upper_arm_R!.z).toBeUndefined();
    });

    it('Stab is a one-sided forward pulse (X stays ≥ 0)', () => {
      for (let t = 1; t <= 300; t++) {
        const stab = computeBlockHoldOffsets(Direction.Stab, t);
        expect(stab.forearm_R!.x).toBeGreaterThanOrEqual(0);
        expect(stab.upper_arm_R!.x).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('fade-in ramp', () => {
    it('returns no motion at or before block start', () => {
      expect(computeBlockHoldOffsets(Direction.Left, 0)).toEqual({});
      expect(computeBlockHoldOffsets(Direction.Left, -5)).toEqual({});
    });

    it('scales amplitude by min(1, blockSeconds / 0.25) during the ramp', () => {
      const t = 7; // 7/60 s ≈ 0.1167 s → fade = 0.1167 / 0.25 ≈ 0.4667
      const fade = Math.min(1, t / 60 / BLOCK_HOLD_FADEIN_SEC);
      const phase = ((2 * Math.PI) / BLOCK_HOLD_PERIOD_TICKS) * t;
      const expected = Math.sin(phase) * fade * BLOCK_HOLD_PEAK_RAD;
      expect(computeBlockHoldOffsets(Direction.Left, t).upper_arm_R!.z).toBeCloseTo(
        expected,
        10,
      );
    });

    it('saturates fade to 1 after ~0.25 s (offsets become period-75 periodic)', () => {
      // Fade window is 15 ticks (0.25 s * 60). For t ≥ 15, fade is pinned at
      // 1, so a full period later the offsets must be identical.
      for (const t of [20, 40, 88]) {
        const now = computeBlockHoldOffsets(Direction.Overhead, t);
        const later = computeBlockHoldOffsets(
          Direction.Overhead,
          t + BLOCK_HOLD_PERIOD_TICKS,
        );
        expect(later.upper_arm_R!.x).toBeCloseTo(now.upper_arm_R!.x!, 10);
        expect(later.chest!.x).toBeCloseTo(now.chest!.x!, 10);
      }
    });

    it('early-ramp amplitude is strictly smaller than saturated amplitude at the same phase', () => {
      // Same sinusoid phase (t and t + period) but t is inside the fade
      // window, so its amplitude must be strictly attenuated.
      const t = 6; // inside 15-tick fade window
      const early = computeBlockHoldOffsets(Direction.Right, t);
      const saturated = computeBlockHoldOffsets(
        Direction.Right,
        t + BLOCK_HOLD_PERIOD_TICKS,
      );
      expect(Math.abs(early.upper_arm_R!.z!)).toBeLessThan(
        Math.abs(saturated.upper_arm_R!.z!),
      );
    });
  });

  describe('unknown direction', () => {
    it('returns empty offsets for an unrecognised direction value', () => {
      expect(computeBlockHoldOffsets(99 as Direction, 40)).toEqual({});
    });
  });
});
