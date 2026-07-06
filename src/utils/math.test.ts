import { describe, it, expect } from 'vitest';
import { clamp, lerp, lerpAngle, yawTowards } from './math';

/** forward = (-sin yaw, -cos yaw) under the project convention. */
function forwardOf(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

describe('math utilities', () => {
  describe('clamp', () => {
    it('clamps below minimum', () => expect(clamp(-5, 0, 10)).toBe(0));
    it('clamps above maximum', () => expect(clamp(15, 0, 10)).toBe(10));
    it('passes through in range', () => expect(clamp(5, 0, 10)).toBe(5));
  });

  describe('lerp', () => {
    it('returns a at t=0', () => expect(lerp(0, 10, 0)).toBe(0));
    it('returns b at t=1', () => expect(lerp(0, 10, 1)).toBe(10));
    it('returns midpoint at t=0.5', () => expect(lerp(0, 10, 0.5)).toBe(5));
  });

  describe('lerpAngle', () => {
    it('interpolates shortest path', () => {
      // From -170° to 170° should go through 180°, not through 0°
      const a = (-170 * Math.PI) / 180;
      const b = (170 * Math.PI) / 180;
      const result = lerpAngle(a, b, 0.5);
      expect(Math.abs(result)).toBeCloseTo(Math.PI, 1);
    });

    it('returns a at t=0', () => {
      expect(lerpAngle(1.0, 2.0, 0)).toBeCloseTo(1.0);
    });

    it('returns b at t=1', () => {
      expect(lerpAngle(1.0, 2.0, 1)).toBeCloseTo(2.0);
    });
  });

  describe('yawTowards', () => {
    // Assert the resulting FORWARD vector, not the formula, so these tests
    // can't restate a π-off bug (the whole point of #211/#212).

    it('at (0,10) facing origin → forward ≈ (0, 0, -1) (yaw 0)', () => {
      const yaw = yawTowards(0, 10);
      expect(yaw).toBeCloseTo(0, 6);
      const f = forwardOf(yaw);
      expect(f.x).toBeCloseTo(0, 6);
      expect(f.z).toBeCloseTo(-1, 6); // looks down -Z, toward origin
    });

    it('at (10,0) facing origin → forward points -X (yaw +π/2)', () => {
      const yaw = yawTowards(10, 0);
      expect(yaw).toBeCloseTo(Math.PI / 2, 6);
      const f = forwardOf(yaw);
      expect(f.x).toBeCloseTo(-1, 6);
      expect(f.z).toBeCloseTo(0, 6);
    });

    it('at (10,10) facing origin → forward points (-√½, -√½) (yaw π/4)', () => {
      const yaw = yawTowards(10, 10);
      expect(yaw).toBeCloseTo(Math.PI / 4, 6);
      const f = forwardOf(yaw);
      const inv = 1 / Math.SQRT2;
      expect(f.x).toBeCloseTo(-inv, 6);
      expect(f.z).toBeCloseTo(-inv, 6);
    });

    it('at (-7,9) facing origin → forward aligns with (origin - pos)', () => {
      const yaw = yawTowards(-7, 9);
      const f = forwardOf(yaw);
      const len = Math.hypot(7, -9);
      const dot = (f.x * 7 + f.z * -9) / len; // origin - (-7,9) = (7,-9)
      expect(dot).toBeCloseTo(1, 6);
    });

    it('faces an arbitrary target, not just the origin', () => {
      // From (5,5) toward (5,-5): forward should be straight -Z.
      const yaw = yawTowards(5, 5, 5, -5);
      const f = forwardOf(yaw);
      expect(f.x).toBeCloseTo(0, 6);
      expect(f.z).toBeCloseTo(-1, 6);
    });

    it('is well-defined (0) at the degenerate at-target call', () => {
      expect(yawTowards(0, 0)).toBe(0);
      expect(yawTowards(4, 2, 4, 2)).toBe(0);
    });
  });
});
