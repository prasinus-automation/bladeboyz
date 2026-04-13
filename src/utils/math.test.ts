import { describe, it, expect } from 'vitest';
import { clamp, lerp, lerpAngle } from './math';

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
});
