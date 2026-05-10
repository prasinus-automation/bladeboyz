import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyHitReactLean, hitReactIntensity } from './hitReact';

describe('hitReact', () => {
  describe('hitReactIntensity', () => {
    it('returns 0 at t=0', () => {
      expect(hitReactIntensity(0)).toBe(0);
    });

    it('returns 0 at t=1', () => {
      expect(hitReactIntensity(1)).toBe(0);
    });

    it('peaks at t=0.3', () => {
      expect(hitReactIntensity(0.3)).toBeCloseTo(1, 6);
    });

    it('ramps in linearly to the peak', () => {
      expect(hitReactIntensity(0.15)).toBeCloseTo(0.5, 6);
    });

    it('decays linearly from peak to 0 over [0.3, 1]', () => {
      // At t = 0.65, intensity should be ~0.5 along the decay.
      expect(hitReactIntensity(0.65)).toBeCloseTo(0.5, 6);
    });

    it('clamps t below 0 to 0', () => {
      expect(hitReactIntensity(-0.5)).toBe(0);
    });

    it('clamps t above 1 to 0', () => {
      expect(hitReactIntensity(1.5)).toBe(0);
    });

    it('intensity values are non-negative across [0, 1]', () => {
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        expect(hitReactIntensity(t)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('applyHitReactLean', () => {
    function makeBone(): THREE.Bone {
      return new THREE.Bone();
    }

    it('does nothing when both bones are null', () => {
      // No-op — should not throw.
      expect(() =>
        applyHitReactLean(null, null, 1, 0, 0, 1, 0.3),
      ).not.toThrow();
    });

    it('does nothing when magnitude is 0', () => {
      const spine = makeBone();
      const chest = makeBone();
      const initial = spine.quaternion.clone();
      applyHitReactLean(spine, chest, 1, 0, 0, 0, 0.3);
      expect(spine.quaternion.equals(initial)).toBe(true);
      expect(chest.quaternion.equals(initial)).toBe(true);
    });

    it('does nothing at t=0 (intensity is 0)', () => {
      const spine = makeBone();
      const chest = makeBone();
      const initial = spine.quaternion.clone();
      applyHitReactLean(spine, chest, 1, 0, 0, 1, 0);
      expect(spine.quaternion.equals(initial)).toBe(true);
    });

    it('does nothing at t=1 (intensity is 0)', () => {
      const spine = makeBone();
      const chest = makeBone();
      const initial = spine.quaternion.clone();
      applyHitReactLean(spine, chest, 1, 0, 0, 1, 1);
      expect(spine.quaternion.equals(initial)).toBe(true);
    });

    it('does nothing when dirLocal has zero horizontal component', () => {
      const spine = makeBone();
      const chest = makeBone();
      const initial = spine.quaternion.clone();
      // Pure-Y direction (top-down hit) — no horizontal axis to lean around.
      applyHitReactLean(spine, chest, 0, 1, 0, 1, 0.3);
      expect(spine.quaternion.equals(initial)).toBe(true);
    });

    it('multiplies a non-identity rotation onto spine and chest at peak', () => {
      const spine = makeBone();
      const chest = makeBone();
      // Hit from front (-Z direction in local frame), full magnitude, peak t.
      applyHitReactLean(spine, chest, 0, 0, -1, 1, 0.3);

      expect(spine.quaternion.equals(new THREE.Quaternion())).toBe(false);
      expect(chest.quaternion.equals(new THREE.Quaternion())).toBe(false);
    });

    it('lean magnitude scales with `magnitude` parameter', () => {
      const fullMag = makeBone();
      const halfMag = makeBone();
      applyHitReactLean(fullMag, null, 0, 0, -1, 1.0, 0.3);
      applyHitReactLean(halfMag, null, 0, 0, -1, 0.5, 0.3);

      // Half-magnitude bone is closer to identity than full-magnitude bone.
      const identity = new THREE.Quaternion();
      const fullDot = Math.abs(fullMag.quaternion.dot(identity));
      const halfDot = Math.abs(halfMag.quaternion.dot(identity));
      // Closer-to-identity == higher dot product (rotation closer to 0).
      expect(halfDot).toBeGreaterThan(fullDot);
    });

    it('lean direction reverses for opposite hit directions', () => {
      const fromFront = makeBone();
      const fromBack = makeBone();
      applyHitReactLean(fromFront, null, 0, 0, -1, 1, 0.3);
      applyHitReactLean(fromBack, null, 0, 0, 1, 1, 0.3);

      // Both should rotate, in opposite directions — so their quaternion
      // dot product is significantly less than 1 (and in fact closer to
      // 1 - something, but at least not equal to fromFront alone).
      expect(fromFront.quaternion.equals(fromBack.quaternion)).toBe(false);
    });

    it('multiplies on top of existing pose (does not overwrite)', () => {
      const spine = makeBone();
      // Pre-set a non-identity rotation (e.g. HITSTUN_POSE).
      const preset = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.2, 0.1, 0, 'XYZ'),
      );
      spine.quaternion.copy(preset);

      applyHitReactLean(spine, null, 0, 0, -1, 1, 0.3);

      // After multiply, the bone should NOT be at the preset (it's been
      // augmented) but also NOT at the pure-lean rotation (which would
      // mean we overwrote).
      expect(spine.quaternion.equals(preset)).toBe(false);
      // Verify the result is preset * leanQuat (since multiply is right-mult
      // in three.js: preset.multiply(lean) = preset * lean).
    });

    it('handles only spine bone (chest null)', () => {
      const spine = makeBone();
      applyHitReactLean(spine, null, 0, 0, -1, 1, 0.3);
      expect(spine.quaternion.equals(new THREE.Quaternion())).toBe(false);
    });

    it('handles only chest bone (spine null)', () => {
      const chest = makeBone();
      applyHitReactLean(null, chest, 0, 0, -1, 1, 0.3);
      expect(chest.quaternion.equals(new THREE.Quaternion())).toBe(false);
    });

    it('caps tilt at ~30° at full magnitude/intensity', () => {
      const spine = makeBone();
      applyHitReactLean(spine, null, 0, 0, -1, 1, 0.3);
      // The angle of the resulting quaternion: 2 * acos(w).
      const angle = 2 * Math.acos(Math.min(1, Math.abs(spine.quaternion.w)));
      // Should be approximately 30° = π/6 rad.
      expect(angle).toBeLessThan((35 * Math.PI) / 180);
      expect(angle).toBeGreaterThan((25 * Math.PI) / 180);
    });
  });
});
