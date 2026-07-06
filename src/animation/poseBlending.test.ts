import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  applyPoseLayer,
  applyAdditivePoseLayer,
  smoothstepEase,
  easeOutBack,
  combatPhaseBlend,
  crossfadeDurationFor,
  anchoredPhaseT,
  CROSSFADE_DURATION_SEC,
} from './poseBlending';
import type { Pose } from './AnimationData';
import { CombatState } from '../combat/states';

describe('poseBlending', () => {
  describe('CROSSFADE_DURATION_SEC', () => {
    it('matches the legacy 80ms crossfade window', () => {
      expect(CROSSFADE_DURATION_SEC).toBe(0.08);
    });
  });

  describe('smoothstepEase', () => {
    it('returns 0 at t=0', () => {
      expect(smoothstepEase(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(smoothstepEase(1)).toBe(1);
    });

    it('returns 0.5 at t=0.5', () => {
      expect(smoothstepEase(0.5)).toBeCloseTo(0.5, 6);
    });

    it('clamps inputs below 0', () => {
      expect(smoothstepEase(-0.5)).toBe(0);
      expect(smoothstepEase(-1)).toBe(0);
    });

    it('clamps inputs above 1', () => {
      expect(smoothstepEase(1.5)).toBe(1);
      expect(smoothstepEase(2)).toBe(1);
    });

    it('matches the cubic Hermite formula 3t² - 2t³', () => {
      for (const t of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
        const expected = 3 * t * t - 2 * t * t * t;
        expect(smoothstepEase(t)).toBeCloseTo(expected, 6);
      }
    });

    it('is monotonically increasing', () => {
      let prev = -1;
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const v = smoothstepEase(t);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    });
  });

  describe('applyPoseLayer', () => {
    function makeBone(): THREE.Bone {
      return new THREE.Bone();
    }

    it('slerps bone from prev quaternion toward target pose', () => {
      const bone = makeBone();
      bone.name = 'shoulder_R';
      const bones = { shoulder_R: bone };

      // Prev pose snapshot: identity.
      const prev: Record<string, THREE.Quaternion> = {
        shoulder_R: new THREE.Quaternion(),
      };

      // Target pose: 90° X rotation.
      const target: Pose = { shoulder_R: { x: Math.PI / 2 } };

      // At easedT = 0.5, bone should be halfway.
      applyPoseLayer(bones, prev, target, 0.5, new Set(['shoulder_R']));

      const expected = new THREE.Quaternion();
      expected.slerp(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(Math.PI / 2, 0, 0, 'XYZ'),
        ),
        0.5,
      );

      expect(bone.quaternion.x).toBeCloseTo(expected.x, 5);
      expect(bone.quaternion.y).toBeCloseTo(expected.y, 5);
      expect(bone.quaternion.z).toBeCloseTo(expected.z, 5);
      expect(bone.quaternion.w).toBeCloseTo(expected.w, 5);
    });

    it('does NOT slerp from live bone state — uses the snapshot', () => {
      // This is the bug fix from §10.1 of the spec doc. Pre-set the bone
      // to a non-identity rotation. The slerp source must be `prev`,
      // NOT the bone's current quaternion.
      const bone = makeBone();
      const live = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.5, 0.5, 0, 'XYZ'),
      );
      bone.quaternion.copy(live);
      const bones = { shoulder_R: bone };

      // Snapshot is identity (different from live).
      const prev: Record<string, THREE.Quaternion> = {
        shoulder_R: new THREE.Quaternion(),
      };

      // Apply at easedT = 1 — should land EXACTLY on the target, not
      // somewhere between live and target.
      const target: Pose = { shoulder_R: { x: 0.3 } };
      applyPoseLayer(bones, prev, target, 1.0, new Set(['shoulder_R']));

      const expected = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.3, 0, 0, 'XYZ'),
      );
      expect(bone.quaternion.x).toBeCloseTo(expected.x, 5);
      expect(bone.quaternion.y).toBeCloseTo(expected.y, 5);
      expect(bone.quaternion.z).toBeCloseTo(expected.z, 5);
      expect(bone.quaternion.w).toBeCloseTo(expected.w, 5);
    });

    it('lands exactly at target when easedT = 1', () => {
      const bone = makeBone();
      const bones = { shoulder_R: bone };
      const prev = { shoulder_R: new THREE.Quaternion() };
      const target: Pose = { shoulder_R: { z: 0.4 } };

      applyPoseLayer(bones, prev, target, 1.0, new Set(['shoulder_R']));

      const expected = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, 0, 0.4, 'XYZ'),
      );
      expect(bone.quaternion.equals(expected)).toBe(true);
    });

    it('lands exactly at prev snapshot when easedT = 0', () => {
      const bone = makeBone();
      const bones = { shoulder_R: bone };
      const snapshotQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.2, 0, 0, 'XYZ'),
      );
      const prev = { shoulder_R: snapshotQuat.clone() };
      const target: Pose = { shoulder_R: { x: Math.PI / 2 } };

      applyPoseLayer(bones, prev, target, 0.0, new Set(['shoulder_R']));

      expect(bone.quaternion.x).toBeCloseTo(snapshotQuat.x, 5);
      expect(bone.quaternion.y).toBeCloseTo(snapshotQuat.y, 5);
      expect(bone.quaternion.z).toBeCloseTo(snapshotQuat.z, 5);
      expect(bone.quaternion.w).toBeCloseTo(snapshotQuat.w, 5);
    });

    it('slerps owned bones missing from currentPose toward identity', () => {
      const bone = makeBone();
      const bones = { shoulder_R: bone };
      // Prev snapshot is non-identity.
      const snapshotQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(1.0, 0, 0, 'XYZ'),
      );
      const prev = { shoulder_R: snapshotQuat.clone() };
      // currentPose has NO entry for shoulder_R but it IS in the owned set.
      const empty: Pose = {};

      applyPoseLayer(bones, prev, empty, 1.0, new Set(['shoulder_R']));

      // Should land at identity (rest pose).
      expect(bone.quaternion.equals(new THREE.Quaternion())).toBe(true);
    });

    it('does NOT touch bones outside ownedBoneSet', () => {
      const ownedBone = makeBone();
      const offlimitsBone = makeBone();
      const presetQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.7, 0, 0, 'XYZ'),
      );
      offlimitsBone.quaternion.copy(presetQuat);

      const bones = {
        shoulder_R: ownedBone,
        thigh_L: offlimitsBone,
      };
      const prev = {
        shoulder_R: new THREE.Quaternion(),
        thigh_L: new THREE.Quaternion(),
      };
      const target: Pose = {
        shoulder_R: { x: 0.5 },
        thigh_L: { x: 0.5 }, // would write if owned, but it's NOT in the set
      };

      applyPoseLayer(bones, prev, target, 1.0, new Set(['shoulder_R']));

      // shoulder_R was written.
      expect(ownedBone.quaternion.equals(new THREE.Quaternion())).toBe(false);
      // thigh_L kept its preset rotation untouched.
      expect(offlimitsBone.quaternion.equals(presetQuat)).toBe(true);
    });

    it('handles missing prev snapshot entry by treating as identity', () => {
      const bone = makeBone();
      const bones = { shoulder_R: bone };
      // No entry for shoulder_R in prev — should fall back to identity.
      const prev: Record<string, THREE.Quaternion> = {};
      const target: Pose = { shoulder_R: { x: 0.4 } };

      applyPoseLayer(bones, prev, target, 1.0, new Set(['shoulder_R']));

      const expected = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.4, 0, 0, 'XYZ'),
      );
      expect(bone.quaternion.equals(expected)).toBe(true);
    });

    it('skips bones not present in the bones map', () => {
      const bones: Record<string, THREE.Bone> = {};
      const prev = { shoulder_R: new THREE.Quaternion() };
      const target: Pose = { shoulder_R: { x: 0.4 } };

      // Should not throw — the missing bone is silently skipped.
      expect(() =>
        applyPoseLayer(bones, prev, target, 1.0, new Set(['shoulder_R'])),
      ).not.toThrow();
    });

    it('writes multiple bones in a single call', () => {
      const a = makeBone();
      const b = makeBone();
      const bones = { shoulder_R: a, forearm_R: b };
      const prev = {
        shoulder_R: new THREE.Quaternion(),
        forearm_R: new THREE.Quaternion(),
      };
      const target: Pose = {
        shoulder_R: { x: 0.3 },
        forearm_R: { z: 0.2 },
      };
      applyPoseLayer(
        bones,
        prev,
        target,
        1.0,
        new Set(['shoulder_R', 'forearm_R']),
      );

      expect(a.quaternion.equals(new THREE.Quaternion())).toBe(false);
      expect(b.quaternion.equals(new THREE.Quaternion())).toBe(false);
    });
  });

  describe('easeOutBack (#goal-2026-07 follow-through curve)', () => {
    it('is exact at the endpoints', () => {
      expect(easeOutBack(0)).toBe(0);
      expect(easeOutBack(1)).toBe(1);
    });

    it('clamps outside [0, 1]', () => {
      expect(easeOutBack(-1)).toBe(0);
      expect(easeOutBack(2)).toBe(1);
    });

    it('overshoots 1 in the settle region (the follow-through)', () => {
      let peak = 0;
      for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, easeOutBack(t));
      expect(peak).toBeGreaterThan(1.0);
      expect(peak).toBeLessThan(1.12); // subtle, not rubbery
    });
  });

  describe('combatPhaseBlend (#goal-2026-07 per-state time curves)', () => {
    it('Windup ignores the crossfade race — the draw fills the whole phase', () => {
      // Legacy max(phaseT, crossfadeT) hit 1.0 within 80ms; now a windup
      // 20% through its phase is 20%-ish drawn even with crossfade done.
      const early = combatPhaseBlend(CombatState.Windup, 0.2, 1.0);
      expect(early).toBeLessThan(0.2); // smoothstep(0.2) = 0.104
      expect(combatPhaseBlend(CombatState.Windup, 1, 1)).toBe(1);
    });

    it('Recovery overshoots past the target before settling (follow-through)', () => {
      let peak = 0;
      for (let t = 0; t <= 1; t += 0.01) {
        peak = Math.max(peak, combatPhaseBlend(CombatState.Recovery, t, 1.0));
      }
      expect(peak).toBeGreaterThan(1.0);
      expect(combatPhaseBlend(CombatState.Recovery, 1, 1)).toBe(1);
    });

    it('reactive states keep the crossfade race (Idle uses smoothstep(max))', () => {
      // phaseT 0 but crossfade half done → smoothstep of the crossfade.
      expect(combatPhaseBlend(CombatState.Idle, 0, 0.5)).toBeCloseTo(0.5 * 0.5 * (3 - 2 * 0.5), 6);
    });

    it('Blocking rides easeOutBack on the crossfade — a raise-in sweep (#218)', () => {
      // phaseT is always 0 during Blocking (phaseTotal == 0), so the curve is
      // purely the eased crossfade. It overshoots past guard, then settles.
      expect(combatPhaseBlend(CombatState.Blocking, 0, 0)).toBe(0);
      expect(combatPhaseBlend(CombatState.Blocking, 0, 1)).toBe(1);
      expect(combatPhaseBlend(CombatState.Blocking, 0, 0.5)).toBe(easeOutBack(0.5));
      // Overshoot: somewhere on the ramp the eased factor carries past 1.
      let peak = 0;
      for (let c = 0; c <= 1; c += 0.01) {
        peak = Math.max(peak, combatPhaseBlend(CombatState.Blocking, 0, c));
      }
      expect(peak).toBeGreaterThan(1.0);
      // The phaseT argument is a no-op for Blocking (max() removed).
      expect(combatPhaseBlend(CombatState.Blocking, 0.9, 0.3)).toBe(
        combatPhaseBlend(CombatState.Blocking, 0, 0.3),
      );
    });
  });

  describe('applyAdditivePoseLayer', () => {
    function makeBones(names: string[]): Record<string, THREE.Bone> {
      const bones: Record<string, THREE.Bone> = {};
      for (const n of names) bones[n] = new THREE.Bone();
      return bones;
    }

    it('post-multiplies the offset onto the existing bone rotation', () => {
      const bones = makeBones(['upper_arm_R']);
      // Seed a base rotation the additive layer must compose with, not clobber.
      const base = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.3, 0, 0, 'XYZ'),
      );
      bones.upper_arm_R.quaternion.copy(base);

      const offset: Pose = { upper_arm_R: { z: 0.05 } };
      applyAdditivePoseLayer(bones, offset, new Set(['upper_arm_R']));

      const expected = base
        .clone()
        .multiply(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.05, 'XYZ')),
        );
      expect(bones.upper_arm_R.quaternion.angleTo(expected)).toBeCloseTo(0, 6);
      // Must have actually changed from the base.
      expect(bones.upper_arm_R.quaternion.angleTo(base)).toBeGreaterThan(0);
    });

    it('only writes bones in BOTH the pose and the owned set', () => {
      const bones = makeBones(['upper_arm_R', 'chest']);
      const chestBefore = bones.chest.quaternion.clone();
      // chest is in the pose but NOT owned → must be left untouched.
      const offset: Pose = { upper_arm_R: { z: 0.05 }, chest: { x: 0.05 } };
      applyAdditivePoseLayer(bones, offset, new Set(['upper_arm_R']));
      expect(bones.chest.quaternion.equals(chestBefore)).toBe(true);
      expect(bones.upper_arm_R.quaternion.equals(new THREE.Quaternion())).toBe(false);
    });

    it('ignores owned bones missing from the pose or hierarchy', () => {
      const bones = makeBones(['upper_arm_R']);
      const before = bones.upper_arm_R.quaternion.clone();
      // forearm_R owned but absent from bones; upper_arm_R owned but absent
      // from pose → nothing should change.
      applyAdditivePoseLayer(bones, {}, new Set(['upper_arm_R', 'forearm_R']));
      expect(bones.upper_arm_R.quaternion.equals(before)).toBe(true);
    });
  });

  describe('crossfadeDurationFor', () => {
    it('parry is snappier and hit-stun heavier than the default', () => {
      expect(crossfadeDurationFor(CombatState.Parry)).toBeLessThan(CROSSFADE_DURATION_SEC);
      expect(crossfadeDurationFor(CombatState.HitStun)).toBeGreaterThan(CROSSFADE_DURATION_SEC);
      expect(crossfadeDurationFor(CombatState.Windup)).toBe(CROSSFADE_DURATION_SEC);
    });

    it('Blocking gets a longer, readable raise-in sweep (#218)', () => {
      // 0.14 s vs the 0.08 s default — the "raise weapon to guard" motion.
      expect(crossfadeDurationFor(CombatState.Blocking)).toBeGreaterThan(
        CROSSFADE_DURATION_SEC,
      );
      // Still slower than a Parry snap (0.05 s) — Parry stays a flourish.
      expect(crossfadeDurationFor(CombatState.Blocking)).toBeGreaterThan(
        crossfadeDurationFor(CombatState.Parry),
      );
    });
  });

  describe('anchoredPhaseT (combo-buffer pop fix)', () => {
    it('equals raw phaseT when anchorTotal === live phaseTotal (no-shrink case)', () => {
      expect(anchoredPhaseT(6, 24)).toBeCloseTo(6 / 24, 6);
      expect(anchoredPhaseT(12, 24)).toBeCloseTo(0.5, 6);
    });

    it('ignores an in-place shrink — stays on the ENTRY total', () => {
      // Recovery entered at total 24, combo shrinks live phaseTotal to 10.
      // The curve keeps using the anchor (24), so phaseElapsed=6 → 0.25,
      // NOT 6/10 = 0.6. This is the whole fix.
      expect(anchoredPhaseT(6, 24)).toBeCloseTo(0.25, 6);
      expect(anchoredPhaseT(6, 24)).not.toBeCloseTo(6 / 10, 2);
    });

    it('is monotonic across the shrink tick (no discontinuity)', () => {
      // phaseElapsed marches 5 → 6 while live phaseTotal collapses 24 → 10;
      // anchored to 24 the progress just continues 5/24 → 6/24.
      const before = anchoredPhaseT(5, 24);
      const after = anchoredPhaseT(6, 24); // anchor unchanged by the shrink
      expect(after).toBeGreaterThan(before);
      expect(after - before).toBeCloseTo(1 / 24, 6);
    });

    it('clamps to [0,1] and guards a zero/negative anchor', () => {
      expect(anchoredPhaseT(-1, 24)).toBe(0);
      expect(anchoredPhaseT(30, 24)).toBe(1);
      expect(anchoredPhaseT(5, 0)).toBe(0);
      expect(anchoredPhaseT(5, -4)).toBe(0);
    });

    it('the combat blend does NOT pop across a combo-buffered mid-Recovery shrink', () => {
      // Reproduces QA's numeric case: Longsword Overhead recovery (entry total
      // 24), combo buffered at phaseElapsed=6 → live phaseTotal shrinks to 10.
      //
      // Recovery uses `easeOutBack(phaseT)` with NO snapshot change mid-phase,
      // so the blend factor IS the arm's progress toward guard here. Assert it
      // moves continuously frame-to-frame through the shrink.
      const RECOVERY = 24;
      const COMBO = 10;
      const SHRINK_AT = 6;

      // WITHOUT the fix: drive the curve off the LIVE (shrinking) phaseTotal.
      // The shrink tick jumps easeOutBack(6/24)=0.72 → easeOutBack(6/10)=1.03.
      const noFix: number[] = [];
      let liveTotal = RECOVERY;
      for (let e = 0; e <= COMBO; e++) {
        if (e === SHRINK_AT) liveTotal = COMBO;
        const t = Math.min(1, e / liveTotal);
        noFix.push(combatPhaseBlend(CombatState.Recovery, t, 1));
      }

      // WITH the fix: anchored to the entry total (24), unaffected by the shrink.
      const fixed: number[] = [];
      for (let e = 0; e <= COMBO; e++) {
        const t = anchoredPhaseT(e, RECOVERY);
        fixed.push(combatPhaseBlend(CombatState.Recovery, t, 1));
      }

      const maxDelta = (xs: number[]): number => {
        let m = 0;
        for (let i = 1; i < xs.length; i++) m = Math.max(m, Math.abs(xs[i] - xs[i - 1]));
        return m;
      };
      const deltaAt = (xs: number[], i: number) => Math.abs(xs[i] - xs[i - 1]);

      // The no-fix version pops hard AT the shrink tick — guard the repro so a
      // regression that reverts to live phaseTotal fails here.
      expect(deltaAt(noFix, SHRINK_AT)).toBeGreaterThan(0.25);

      // The fix has NO extra jump at the shrink — that step is the smallest so
      // far (easeOutBack is decelerating), well under the no-fix pop.
      expect(deltaAt(fixed, SHRINK_AT)).toBeLessThan(0.1);
      // Every fixed step is bounded by the natural curve's steepest step (its
      // start), which is strictly smaller than the no-fix teleport.
      expect(maxDelta(fixed)).toBeLessThan(deltaAt(noFix, SHRINK_AT));
      // Monotonic non-decreasing across the whole recovery (no reversal).
      for (let i = 1; i < fixed.length; i++) {
        expect(fixed[i]).toBeGreaterThanOrEqual(fixed[i - 1] - 1e-9);
      }
    });
  });
});
