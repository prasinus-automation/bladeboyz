import { describe, it, expect } from 'vitest';
import {
  ARC_SWING_PARAMS,
  ARC_SWING_PARAMS_PER_WEAPON,
  ARC_SWING_OWNED_BONES,
  ARC_SWING_VIEWMODEL_BONES,
  computeArcSwingPose,
  type WeaponName,
} from './arcSwing';
import { Direction } from '../combat/directions';

describe('arcSwing', () => {
  describe('ARC_SWING_PARAMS', () => {
    it('has params for all 4 active directions', () => {
      // Direction.Underhand was retired in #131/#139 — only 4 keys here.
      const directions = [
        Direction.Overhead,
        Direction.Left,
        Direction.Right,
        Direction.Stab,
      ];
      for (const dir of directions) {
        expect(ARC_SWING_PARAMS[dir as number]).toBeDefined();
      }
    });

    it('Left and Right are mirrored on the Z axis', () => {
      const left = ARC_SWING_PARAMS[Direction.Left as number];
      const right = ARC_SWING_PARAMS[Direction.Right as number];
      // Z component is mirrored — left's start = -right's start, etc.
      expect(left.shoulderStart.z).toBe(-(right.shoulderStart.z ?? 0));
      expect(left.shoulderEnd.z).toBe(-(right.shoulderEnd.z ?? 0));
    });

    it('Overhead arc rotates the shoulder substantially around X', () => {
      const params = ARC_SWING_PARAMS[Direction.Overhead as number];
      // Start at -2.5, end at +1.0 — total sweep ≈ 3.5 rad (≈ 200°).
      const start = params.shoulderStart.x ?? 0;
      const end = params.shoulderEnd.x ?? 0;
      expect(Math.abs(end - start)).toBeGreaterThan(2.0);
    });
  });

  describe('computeArcSwingPose', () => {
    it('returns the start values at t=0', () => {
      const pose = computeArcSwingPose(Direction.Overhead, 0);
      const params = ARC_SWING_PARAMS[Direction.Overhead as number];
      expect(pose.shoulder_R?.x).toBeCloseTo(params.shoulderStart.x ?? 0, 6);
      expect(pose.forearm_R?.x).toBeCloseTo(params.forearmStart.x ?? 0, 6);
    });

    it('returns the end values at t=1', () => {
      const pose = computeArcSwingPose(Direction.Overhead, 1);
      const params = ARC_SWING_PARAMS[Direction.Overhead as number];
      expect(pose.shoulder_R?.x).toBeCloseTo(params.shoulderEnd.x ?? 0, 6);
      expect(pose.forearm_R?.x).toBeCloseTo(params.forearmEnd.x ?? 0, 6);
    });

    it('returns midpoint values at t=0.5', () => {
      const pose = computeArcSwingPose(Direction.Overhead, 0.5);
      const params = ARC_SWING_PARAMS[Direction.Overhead as number];
      const expectedX =
        ((params.shoulderStart.x ?? 0) + (params.shoulderEnd.x ?? 0)) / 2;
      expect(pose.shoulder_R?.x).toBeCloseTo(expectedX, 6);
    });

    it('clamps t below 0', () => {
      const a = computeArcSwingPose(Direction.Left, -0.5);
      const b = computeArcSwingPose(Direction.Left, 0);
      expect(a.shoulder_R?.z).toBe(b.shoulder_R?.z);
    });

    it('clamps t above 1', () => {
      const a = computeArcSwingPose(Direction.Left, 2);
      const b = computeArcSwingPose(Direction.Left, 1);
      expect(a.shoulder_R?.z).toBe(b.shoulder_R?.z);
    });

    it('always returns shoulder_R, forearm_R, and hand_R', () => {
      for (const dir of [
        Direction.Overhead,
        Direction.Left,
        Direction.Right,
        Direction.Stab,
      ]) {
        const pose = computeArcSwingPose(dir, 0.5);
        expect(pose.shoulder_R).toBeDefined();
        expect(pose.forearm_R).toBeDefined();
        expect(pose.hand_R).toBeDefined();
      }
    });

    it('includes spine for Overhead/Left/Right (chest follow-through)', () => {
      expect(computeArcSwingPose(Direction.Overhead, 0.5).spine).toBeDefined();
      expect(computeArcSwingPose(Direction.Left, 0.5).spine).toBeDefined();
      expect(computeArcSwingPose(Direction.Right, 0.5).spine).toBeDefined();
    });

    it('does NOT include spine for Stab (no follow-through on a thrust)', () => {
      const pose = computeArcSwingPose(Direction.Stab, 0.5);
      expect(pose.spine).toBeUndefined();
    });

    it('falls back to Stab arc for unknown directions', () => {
      const fallback = computeArcSwingPose(99 as Direction, 0.5);
      const stab = computeArcSwingPose(Direction.Stab, 0.5);
      expect(fallback.shoulder_R?.x).toBe(stab.shoulder_R?.x);
      expect(fallback.forearm_R?.x).toBe(stab.forearm_R?.x);
    });

    it('all returned BoneRotation values are finite numbers', () => {
      for (const dir of [
        Direction.Overhead,
        Direction.Left,
        Direction.Right,
        Direction.Stab,
      ]) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const pose = computeArcSwingPose(dir, t);
          for (const bone of Object.values(pose)) {
            for (const axis of ['x', 'y', 'z'] as const) {
              const v = bone[axis];
              if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
            }
          }
        }
      }
    });
  });

  describe('ARC_SWING_PARAMS_PER_WEAPON (#132)', () => {
    const weapons: WeaponName[] = [
      'Longsword',
      'Mace',
      'Dagger',
      'Battleaxe',
    ];
    const directions = [
      Direction.Overhead,
      Direction.Left,
      Direction.Right,
      Direction.Stab,
    ];

    it('has 4 weapons × 4 directions = 16 param sets defined', () => {
      for (const w of weapons) {
        expect(ARC_SWING_PARAMS_PER_WEAPON[w]).toBeDefined();
        for (const d of directions) {
          expect(ARC_SWING_PARAMS_PER_WEAPON[w][d as number]).toBeDefined();
        }
      }
    });

    it('Longsword arc params match the baseline ARC_SWING_PARAMS', () => {
      for (const d of directions) {
        const base = ARC_SWING_PARAMS[d as number];
        const ls = ARC_SWING_PARAMS_PER_WEAPON.Longsword[d as number];
        expect(ls.shoulderStart.x ?? 0).toBeCloseTo(base.shoulderStart.x ?? 0, 6);
        expect(ls.shoulderStart.y ?? 0).toBeCloseTo(base.shoulderStart.y ?? 0, 6);
        expect(ls.shoulderStart.z ?? 0).toBeCloseTo(base.shoulderStart.z ?? 0, 6);
        expect(ls.shoulderEnd.x ?? 0).toBeCloseTo(base.shoulderEnd.x ?? 0, 6);
        expect(ls.forearmStart.x ?? 0).toBeCloseTo(base.forearmStart.x ?? 0, 6);
        expect(ls.forearmEnd.x ?? 0).toBeCloseTo(base.forearmEnd.x ?? 0, 6);
      }
    });

    it('Mace shoulder rotation is ~1.15× the Longsword baseline', () => {
      const lsLeft = ARC_SWING_PARAMS_PER_WEAPON.Longsword[Direction.Left as number];
      const macLeft = ARC_SWING_PARAMS_PER_WEAPON.Mace[Direction.Left as number];
      // shoulderStart.z is 1.4 in Longsword; Mace should be 1.4 * 1.15 = 1.61
      expect(macLeft.shoulderStart.z ?? 0).toBeCloseTo(
        (lsLeft.shoulderStart.z ?? 0) * 1.15,
        4,
      );
    });

    it('Dagger shoulder is smaller (0.75×) and forearm is larger (1.2×) than Longsword', () => {
      const lsOver = ARC_SWING_PARAMS_PER_WEAPON.Longsword[Direction.Overhead as number];
      const dagOver = ARC_SWING_PARAMS_PER_WEAPON.Dagger[Direction.Overhead as number];
      expect(Math.abs(dagOver.shoulderStart.x ?? 0)).toBeLessThan(
        Math.abs(lsOver.shoulderStart.x ?? 0),
      );
      expect(Math.abs(dagOver.forearmEnd.x ?? 0)).toBeGreaterThan(
        Math.abs(lsOver.forearmEnd.x ?? 0),
      );
    });

    it('Battleaxe shoulder is the largest of the four weapons', () => {
      // For a clean comparison, use Overhead which has nonzero shoulderStart.x
      // on every weapon. Test using absolute magnitude (sign is preserved by
      // the scale; we want amplitude growth from Dagger up to Battleaxe).
      const overByWeapon = weapons.map(
        (w) => Math.abs(ARC_SWING_PARAMS_PER_WEAPON[w][Direction.Overhead as number].shoulderStart.x ?? 0),
      );
      // overByWeapon = [Longsword, Mace, Dagger, Battleaxe]
      // Hierarchy: Dagger < Longsword < Mace < Battleaxe
      const [ls, mace, dag, axe] = overByWeapon;
      expect(dag).toBeLessThan(ls);
      expect(ls).toBeLessThan(mace);
      expect(mace).toBeLessThan(axe);
    });

    it('Dagger has zero spine commitment (no torso wind-up)', () => {
      // Overhead, Left, Right have spine entries in the Longsword baseline.
      // Dagger's spine factor is 0 — spine endpoints should be all zeros.
      // Use Math.abs to absorb signed-zero (e.g. -0.15 * 0 = -0).
      for (const d of [Direction.Overhead, Direction.Left, Direction.Right]) {
        const dag = ARC_SWING_PARAMS_PER_WEAPON.Dagger[d as number];
        expect(dag.spineStart).toBeDefined();
        const start = dag.spineStart!;
        const end = dag.spineEnd!;
        expect(Math.abs(start.x ?? 0)).toBe(0);
        expect(Math.abs(start.y ?? 0)).toBe(0);
        expect(Math.abs(start.z ?? 0)).toBe(0);
        expect(Math.abs(end.x ?? 0)).toBe(0);
        expect(Math.abs(end.y ?? 0)).toBe(0);
        expect(Math.abs(end.z ?? 0)).toBe(0);
      }
    });

    it('Battleaxe spine commitment is 1.5× Longsword for horizontal slashes', () => {
      const lsLeft = ARC_SWING_PARAMS_PER_WEAPON.Longsword[Direction.Left as number];
      const axeLeft = ARC_SWING_PARAMS_PER_WEAPON.Battleaxe[Direction.Left as number];
      expect(axeLeft.spineStart!.y ?? 0).toBeCloseTo(
        (lsLeft.spineStart!.y ?? 0) * 1.5,
        4,
      );
    });

    it('all weapons omit spine for Stab (no follow-through on a thrust)', () => {
      for (const w of weapons) {
        const stab = ARC_SWING_PARAMS_PER_WEAPON[w][Direction.Stab as number];
        expect(stab.spineStart).toBeUndefined();
        expect(stab.spineEnd).toBeUndefined();
      }
    });
  });

  describe('computeArcSwingPose with weaponName (#132)', () => {
    it('3-arg form (direction, weaponName, t) returns the same pose as the cached table', () => {
      const pose = computeArcSwingPose(Direction.Overhead, 'Mace', 0.5);
      const params = ARC_SWING_PARAMS_PER_WEAPON.Mace[Direction.Overhead as number];
      const expectedShoulderX =
        ((params.shoulderStart.x ?? 0) + (params.shoulderEnd.x ?? 0)) / 2;
      expect(pose.shoulder_R?.x).toBeCloseTo(expectedShoulderX, 6);
    });

    it('2-arg form (direction, t) returns the Longsword baseline (backward compat)', () => {
      const twoArg = computeArcSwingPose(Direction.Overhead, 0.5);
      const threeArg = computeArcSwingPose(Direction.Overhead, 'Longsword', 0.5);
      expect(twoArg.shoulder_R?.x).toBeCloseTo(threeArg.shoulder_R?.x ?? 0, 6);
      expect(twoArg.forearm_R?.x).toBeCloseTo(threeArg.forearm_R?.x ?? 0, 6);
      expect(twoArg.hand_R?.x ?? 0).toBeCloseTo(threeArg.hand_R?.x ?? 0, 6);
    });

    it('different weapons produce different shoulder magnitudes at the same phaseT', () => {
      // At any nonzero t, the per-weapon scaling produces different shoulder
      // rotations. Compare absolute magnitudes for the Overhead chop.
      const dag = computeArcSwingPose(Direction.Overhead, 'Dagger', 0.5);
      const ls = computeArcSwingPose(Direction.Overhead, 'Longsword', 0.5);
      const axe = computeArcSwingPose(Direction.Overhead, 'Battleaxe', 0.5);
      const dMag = Math.abs(dag.shoulder_R?.x ?? 0);
      const lMag = Math.abs(ls.shoulder_R?.x ?? 0);
      const aMag = Math.abs(axe.shoulder_R?.x ?? 0);
      expect(dMag).toBeLessThan(lMag);
      expect(lMag).toBeLessThan(aMag);
    });

    it('Stab is spine-less regardless of weapon', () => {
      for (const w of ['Longsword', 'Mace', 'Dagger', 'Battleaxe'] as WeaponName[]) {
        const pose = computeArcSwingPose(Direction.Stab, w, 0.5);
        expect(pose.spine).toBeUndefined();
      }
    });

    it('Dagger gets no spine at any phaseT (zero spine factor)', () => {
      // Overhead has spine in the Longsword baseline. Dagger scales to zero.
      // The spine entries are still present (start/end exist), but every
      // axis value is exactly 0 — `computeArcSwingPose` still returns a spine
      // entry but it's a no-op rotation. Math.abs absorbs signed-zero.
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const pose = computeArcSwingPose(Direction.Overhead, 'Dagger', t);
        expect(pose.spine).toBeDefined();
        expect(Math.abs(pose.spine?.x ?? 0)).toBe(0);
        expect(Math.abs(pose.spine?.y ?? 0)).toBe(0);
        expect(Math.abs(pose.spine?.z ?? 0)).toBe(0);
      }
    });

    it('unknown weaponName falls back to Longsword silently', () => {
      const unknown = computeArcSwingPose(
        Direction.Overhead,
        'Greatsword' as unknown as WeaponName,
        0.5,
      );
      const ls = computeArcSwingPose(Direction.Overhead, 'Longsword', 0.5);
      expect(unknown.shoulder_R?.x).toBeCloseTo(ls.shoulder_R?.x ?? 0, 6);
    });

    it('Mace at phaseT=1 lands on its (scaled) shoulderEnd, not the Longsword end', () => {
      const pose = computeArcSwingPose(Direction.Overhead, 'Mace', 1);
      const macEnd =
        ARC_SWING_PARAMS_PER_WEAPON.Mace[Direction.Overhead as number].shoulderEnd
          .x ?? 0;
      const lsEnd =
        ARC_SWING_PARAMS_PER_WEAPON.Longsword[Direction.Overhead as number]
          .shoulderEnd.x ?? 0;
      expect(pose.shoulder_R?.x).toBeCloseTo(macEnd, 6);
      // And Mace's end is bigger than Longsword's.
      expect(Math.abs(macEnd)).toBeGreaterThan(Math.abs(lsEnd));
    });

    it('all 16 (weapon × direction) param sets produce finite numbers at every sampled t', () => {
      for (const w of ['Longsword', 'Mace', 'Dagger', 'Battleaxe'] as WeaponName[]) {
        for (const d of [
          Direction.Overhead,
          Direction.Left,
          Direction.Right,
          Direction.Stab,
        ]) {
          for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            const pose = computeArcSwingPose(d, w, t);
            for (const bone of Object.values(pose)) {
              for (const axis of ['x', 'y', 'z'] as const) {
                const v = bone[axis];
                if (v !== undefined) {
                  expect(Number.isFinite(v)).toBe(true);
                }
              }
            }
          }
        }
      }
    });
  });

  describe('ARC_SWING_VIEWMODEL_BONES (#132)', () => {
    it('contains the viewmodel-arm bones (upper_arm_R, forearm_R, hand_R)', () => {
      expect(ARC_SWING_VIEWMODEL_BONES.has('upper_arm_R')).toBe(true);
      expect(ARC_SWING_VIEWMODEL_BONES.has('forearm_R')).toBe(true);
      expect(ARC_SWING_VIEWMODEL_BONES.has('hand_R')).toBe(true);
    });

    it('does NOT contain weapon_attach (owned by per-weapon grip data, #125)', () => {
      expect(ARC_SWING_VIEWMODEL_BONES.has('weapon_attach')).toBe(false);
      expect(ARC_SWING_VIEWMODEL_BONES.has('vm_weapon_attach')).toBe(false);
    });

    it('does NOT contain left-arm bones (viewmodel has no left arm)', () => {
      expect(ARC_SWING_VIEWMODEL_BONES.has('shoulder_L')).toBe(false);
      expect(ARC_SWING_VIEWMODEL_BONES.has('forearm_L')).toBe(false);
      expect(ARC_SWING_VIEWMODEL_BONES.has('hand_L')).toBe(false);
    });
  });

  describe('ARC_SWING_OWNED_BONES', () => {
    it('includes shoulder_R, forearm_R, hand_R', () => {
      expect(ARC_SWING_OWNED_BONES.has('shoulder_R')).toBe(true);
      expect(ARC_SWING_OWNED_BONES.has('forearm_R')).toBe(true);
      expect(ARC_SWING_OWNED_BONES.has('hand_R')).toBe(true);
    });

    it('does NOT include left-arm bones', () => {
      expect(ARC_SWING_OWNED_BONES.has('shoulder_L')).toBe(false);
      expect(ARC_SWING_OWNED_BONES.has('forearm_L')).toBe(false);
    });

    it('does NOT include weapon_attach (preserved by per-weapon grip)', () => {
      expect(ARC_SWING_OWNED_BONES.has('weapon_attach')).toBe(false);
    });
  });
});
