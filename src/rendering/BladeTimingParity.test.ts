/**
 * Blade-timing parity test (#132 acceptance criterion).
 *
 * Critical regression guard: at any `phaseT` in Release, the third-person
 * arm and the first-person viewmodel arm must reach the SAME arc-swing
 * pose for the SAME (direction, weapon, t) triplet. This is what makes
 * the local player's view align with what other players see during the
 * Release phase (the window in which tracer hit-detection fires).
 *
 * Rotational parity is the contract — the two rigs have different bone
 * proportions (CharacterModel.ts vs ViewmodelRenderer.ts), different
 * pivot conventions (3rd-person pivots from `shoulder_R`; FP pivots from
 * `upper_arm_R`), and different attachment points (3rd is attached to
 * the body, FP is attached to the camera with ARM_OFFSET). World-space
 * hand positions will differ in MAGNITUDE because of arm length, but the
 * blade DIRECTION (the world-space vector from forearm pivot to hand
 * pivot) must point in the same direction at any phaseT.
 *
 * What this test pins:
 *  1. The arc-swing rotations applied to (`shoulder_R` 3rd-person /
 *     `upper_arm_R` FP) match exactly — both consume the same
 *     `computeArcSwingPose(direction, weapon, t).shoulder_R` value.
 *  2. The arc-swing rotations applied to (`forearm_R`, `hand_R`) match
 *     in both rigs.
 *  3. The hand-position arc traced over phaseT moves in the SAME
 *     direction in both rigs (a regression where one rig swung "up" and
 *     the other swung "down" would be caught here).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWorld, addEntity, addComponent } from 'bitecs';
import {
  CharacterModel,
  CombatStateComp,
  AnimationComp,
  HitReactComp,
  MovementState,
  meshRegistry,
} from '../ecs/components';
import {
  animationSystem,
  resetAnimationSystem,
} from '../ecs/systems/AnimationSystem';
import {
  viewmodelAnimationSystem,
  resetViewmodelAnimationSystem,
} from './ViewmodelAnimationSystem';
import {
  CombatState,
  MovementState as MovementStateEnum,
} from '../combat/states';
import { Direction } from '../combat/directions';
import {
  computeArcSwingPose,
  type WeaponName,
} from '../animation/arcSwing';
import { createCharacterModel } from './CharacterModel';
import { ViewmodelRenderer } from './ViewmodelRenderer';
import type { GameWorld } from '../core/types';

// ── Test fixtures ────────────────────────────────────────

const WEAPON_ID_TO_NAME: string[] = ['Longsword', 'Mace', 'Dagger', 'Battleaxe'];

function createTestWorld(): GameWorld {
  return {
    ecs: createWorld(),
    scene: new THREE.Scene(),
    rapier: null as any,
    physicsWorld: null as any,
    renderer: null as any,
    camera: null as any,
    playerEntity: 0,
  };
}

function createTestEntity(world: GameWorld): number {
  const eid = addEntity(world.ecs);
  addComponent(world.ecs, CharacterModel, eid);
  addComponent(world.ecs, CombatStateComp, eid);
  addComponent(world.ecs, AnimationComp, eid);
  addComponent(world.ecs, MovementState, eid);
  addComponent(world.ecs, HitReactComp, eid);

  const { group, skeleton, bones } = createCharacterModel(0x888888);
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, { group, skeleton, bones });

  CombatStateComp.state[eid] = CombatState.Idle;
  CombatStateComp.direction[eid] = 0;
  CombatStateComp.phaseElapsed[eid] = 0;
  CombatStateComp.phaseTotal[eid] = 0;
  CombatStateComp.phaseT[eid] = 0;
  CombatStateComp.weaponId[eid] = 0; // Longsword

  AnimationComp.crossfadeT[eid] = 1;
  AnimationComp.movementState[eid] = MovementStateEnum.Idle;
  AnimationComp.walkCycle[eid] = 0;
  AnimationComp.prevCombatState[eid] = CombatState.Idle;
  AnimationComp.prevDirection[eid] = 0;

  MovementState.speedFactor[eid] = 0;
  MovementState.grounded[eid] = 1;
  MovementState.crouching[eid] = 0;
  MovementState.sprinting[eid] = 0;

  HitReactComp.active[eid] = 0;
  HitReactComp.magnitude[eid] = 0;

  return eid;
}

function createFakeWeaponFactory() {
  return () => {
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.5, 0.1),
        new THREE.MeshBasicMaterial({ color: 0xff0000 }),
      ),
    );
    return { group, tracerPoints: [] };
  };
}

/**
 * Drive a system to "fully blended into Release at phaseT" by ramping
 * enough variable-rate ticks that `crossfadeT` saturates at 1 — at that
 * point both arc-swing systems behave as pure functions of (direction,
 * weapon, phaseT) with no residual blend from the previous state.
 */
function rampToFullyBlended<TArgs extends unknown[]>(
  tick: (...args: TArgs) => void,
  args: TArgs,
  ticks = 30,
  dt = 0.016,
): void {
  // 30 ticks @ 0.016s = 0.48s — way past CROSSFADE_DURATION_SEC=0.08, so
  // crossfadeT saturates at 1 for every entity.
  void dt;
  for (let i = 0; i < ticks; i++) tick(...args);
}

// ── Tests ────────────────────────────────────────────────

describe('Blade-timing parity (#132)', () => {
  let world: GameWorld;
  let eid: number;
  let scene: THREE.Scene;
  let viewmodel: ViewmodelRenderer;

  beforeEach(() => {
    resetAnimationSystem();
    resetViewmodelAnimationSystem();

    world = createTestWorld();
    eid = createTestEntity(world);

    scene = new THREE.Scene();
    viewmodel = new ViewmodelRenderer(scene, 16 / 9, {
      initialWeapon: 'Longsword',
      weaponFactories: {
        Longsword: createFakeWeaponFactory(),
        Mace: createFakeWeaponFactory(),
        Dagger: createFakeWeaponFactory(),
        Battleaxe: createFakeWeaponFactory(),
      },
    });
  });

  describe('rotational parity at phaseT=0.5', () => {
    const directions: Array<[string, Direction]> = [
      ['Overhead', Direction.Overhead],
      ['Left', Direction.Left],
      ['Right', Direction.Right],
      ['Stab', Direction.Stab],
    ];

    for (const [label, dir] of directions) {
      it(`3rd-person shoulder_R rotation matches FP upper_arm_R at Release ${label} t=0.5`, () => {
        // Drive both systems into Release at the same phaseT.
        const phaseT = 0.5;
        CombatStateComp.state[eid] = CombatState.Release;
        CombatStateComp.direction[eid] = dir;
        CombatStateComp.phaseT[eid] = phaseT;
        CombatStateComp.weaponId[eid] = 0; // Longsword

        rampToFullyBlended(
          (w, dt) => animationSystem(w, dt),
          [world, 0.016] as const,
        );
        rampToFullyBlended(
          (vm, e, dt, n) => viewmodelAnimationSystem(vm, e, dt, n),
          [viewmodel, eid, 0.016, WEAPON_ID_TO_NAME] as const,
        );

        const thirdShoulder = meshRegistry.get(eid)!.bones['shoulder_R'];
        const fpUpperArm = viewmodel.bones['upper_arm_R'];
        const angle = thirdShoulder.quaternion.angleTo(fpUpperArm.quaternion);
        // Tight tolerance — both should be near-identical (the arc fed both
        // bones the same Euler delta). Allow a tiny epsilon for slerp
        // round-off across the parallel blend.
        expect(angle).toBeLessThan(0.02);
      });

      it(`3rd-person forearm_R rotation matches FP forearm_R at Release ${label} t=0.5`, () => {
        const phaseT = 0.5;
        CombatStateComp.state[eid] = CombatState.Release;
        CombatStateComp.direction[eid] = dir;
        CombatStateComp.phaseT[eid] = phaseT;
        CombatStateComp.weaponId[eid] = 0;

        rampToFullyBlended(
          (w, dt) => animationSystem(w, dt),
          [world, 0.016] as const,
        );
        rampToFullyBlended(
          (vm, e, dt, n) => viewmodelAnimationSystem(vm, e, dt, n),
          [viewmodel, eid, 0.016, WEAPON_ID_TO_NAME] as const,
        );

        const thirdForearm = meshRegistry.get(eid)!.bones['forearm_R'];
        const fpForearm = viewmodel.bones['forearm_R'];
        const angle = thirdForearm.quaternion.angleTo(fpForearm.quaternion);
        expect(angle).toBeLessThan(0.02);
      });

      it(`3rd-person hand_R rotation matches FP hand_R at Release ${label} t=0.5`, () => {
        const phaseT = 0.5;
        CombatStateComp.state[eid] = CombatState.Release;
        CombatStateComp.direction[eid] = dir;
        CombatStateComp.phaseT[eid] = phaseT;
        CombatStateComp.weaponId[eid] = 0;

        rampToFullyBlended(
          (w, dt) => animationSystem(w, dt),
          [world, 0.016] as const,
        );
        rampToFullyBlended(
          (vm, e, dt, n) => viewmodelAnimationSystem(vm, e, dt, n),
          [viewmodel, eid, 0.016, WEAPON_ID_TO_NAME] as const,
        );

        const thirdHand = meshRegistry.get(eid)!.bones['hand_R'];
        const fpHand = viewmodel.bones['hand_R'];
        const angle = thirdHand.quaternion.angleTo(fpHand.quaternion);
        expect(angle).toBeLessThan(0.02);
      });
    }
  });

  describe('parity across phaseT samples', () => {
    it('Overhead arc has matching rotations at t=0, 0.25, 0.5, 0.75, 1', () => {
      for (const phaseT of [0, 0.25, 0.5, 0.75, 1]) {
        // Fresh state so crossfade doesn't carry across samples.
        resetAnimationSystem();
        resetViewmodelAnimationSystem();
        // Re-create entity since prevPoseSnapshots was wiped.
        CombatStateComp.state[eid] = CombatState.Release;
        CombatStateComp.direction[eid] = Direction.Overhead;
        CombatStateComp.phaseT[eid] = phaseT;
        CombatStateComp.weaponId[eid] = 0;

        rampToFullyBlended(
          (w, dt) => animationSystem(w, dt),
          [world, 0.016] as const,
        );
        rampToFullyBlended(
          (vm, e, dt, n) => viewmodelAnimationSystem(vm, e, dt, n),
          [viewmodel, eid, 0.016, WEAPON_ID_TO_NAME] as const,
        );

        const thirdShoulder = meshRegistry.get(eid)!.bones['shoulder_R'];
        const fpUpperArm = viewmodel.bones['upper_arm_R'];
        const angle = thirdShoulder.quaternion.angleTo(fpUpperArm.quaternion);
        expect(angle).toBeLessThan(0.02);
      }
    });
  });

  describe('per-weapon parity', () => {
    const weapons: Array<[WeaponName, number]> = [
      ['Longsword', 0],
      ['Mace', 1],
      ['Dagger', 2],
      ['Battleaxe', 3],
    ];

    for (const [weaponName, weaponId] of weapons) {
      it(`${weaponName} arc-swing produces matching FP and 3rd-person poses`, () => {
        resetAnimationSystem();
        resetViewmodelAnimationSystem();

        CombatStateComp.state[eid] = CombatState.Release;
        CombatStateComp.direction[eid] = Direction.Overhead;
        CombatStateComp.phaseT[eid] = 0.5;
        CombatStateComp.weaponId[eid] = weaponId;

        rampToFullyBlended(
          (w, dt) => animationSystem(w, dt),
          [world, 0.016] as const,
        );
        rampToFullyBlended(
          (vm, e, dt, n) => viewmodelAnimationSystem(vm, e, dt, n),
          [viewmodel, eid, 0.016, WEAPON_ID_TO_NAME] as const,
        );

        const thirdShoulder = meshRegistry.get(eid)!.bones['shoulder_R'];
        const fpUpperArm = viewmodel.bones['upper_arm_R'];
        const angle = thirdShoulder.quaternion.angleTo(fpUpperArm.quaternion);

        // Sanity check: the arc returned by the per-weapon table actually
        // landed on the 3rd-person bone (and therefore on the FP bone too).
        // Compare to the expected pose.
        const expected = computeArcSwingPose(
          Direction.Overhead,
          weaponName,
          0.5,
        );
        const expectedEuler = new THREE.Euler(
          expected.shoulder_R?.x ?? 0,
          expected.shoulder_R?.y ?? 0,
          expected.shoulder_R?.z ?? 0,
          'XYZ',
        );
        const expectedQuat = new THREE.Quaternion().setFromEuler(expectedEuler);
        const thirdToExpected = thirdShoulder.quaternion.angleTo(expectedQuat);
        const fpToExpected = fpUpperArm.quaternion.angleTo(expectedQuat);

        // Both bones should be (a) close to each other, (b) close to the
        // exact expected arc rotation.
        expect(angle).toBeLessThan(0.02);
        expect(thirdToExpected).toBeLessThan(0.02);
        expect(fpToExpected).toBeLessThan(0.02);
      });
    }
  });

  describe('world-space blade direction parity', () => {
    it('hand position moves in the same world-space direction across phaseT samples', () => {
      // Pin the 3rd-person root and the FP group at world origin with
      // identity rotation so world-space hand positions reflect ONLY the
      // bone-chain rotations (not parent transforms). The arm proportions
      // differ between rigs (CharacterModel vs Viewmodel), so we don't
      // assert matching MAGNITUDES; we assert matching DIRECTIONS — the
      // unit vector from upper-arm-base to hand-position should agree.
      const modelData = meshRegistry.get(eid)!;
      modelData.group.position.set(0, 0, 0);
      modelData.group.quaternion.identity();
      modelData.group.updateMatrixWorld(true);

      viewmodel.group.position.set(0, 0, 0);
      viewmodel.group.quaternion.identity();
      viewmodel.group.updateMatrixWorld(true);

      const direction = Direction.Overhead;
      const weaponId = 0;
      // Sample two distinct phaseT values; the hand should sweep in the
      // SAME direction in both rigs (the swing should advance in the same
      // sense — never opposite).
      const samples = [0.2, 0.8];
      const thirdHandPositions: THREE.Vector3[] = [];
      const fpHandPositions: THREE.Vector3[] = [];

      for (const phaseT of samples) {
        resetAnimationSystem();
        resetViewmodelAnimationSystem();

        CombatStateComp.state[eid] = CombatState.Release;
        CombatStateComp.direction[eid] = direction;
        CombatStateComp.phaseT[eid] = phaseT;
        CombatStateComp.weaponId[eid] = weaponId;

        rampToFullyBlended(
          (w, dt) => animationSystem(w, dt),
          [world, 0.016] as const,
        );
        rampToFullyBlended(
          (vm, e, dt, n) => viewmodelAnimationSystem(vm, e, dt, n),
          [viewmodel, eid, 0.016, WEAPON_ID_TO_NAME] as const,
        );

        // Force matrix-world refresh on both rigs.
        modelData.group.updateMatrixWorld(true);
        viewmodel.group.updateMatrixWorld(true);

        const thirdHandWorld = new THREE.Vector3();
        modelData.bones['hand_R'].getWorldPosition(thirdHandWorld);
        thirdHandPositions.push(thirdHandWorld);

        const fpHandWorld = new THREE.Vector3();
        viewmodel.bones['hand_R'].getWorldPosition(fpHandWorld);
        fpHandPositions.push(fpHandWorld);
      }

      // Direction vector from t=0.2 hand → t=0.8 hand, for both rigs.
      const thirdDelta = thirdHandPositions[1]
        .clone()
        .sub(thirdHandPositions[0]);
      const fpDelta = fpHandPositions[1].clone().sub(fpHandPositions[0]);

      // Magnitudes will differ (arm lengths differ). Compare direction —
      // unit vectors should be close to parallel. A dot product close to
      // +1 means same direction; -1 means opposite. The arc-swing rotation
      // is the SAME so both hands should sweep in the same direction.
      const thirdDir = thirdDelta.clone().normalize();
      const fpDir = fpDelta.clone().normalize();
      const dot = thirdDir.dot(fpDir);

      // Tolerance: angle < ~30° → dot > 0.866. The two rigs have small
      // structural asymmetries (3rd has a shoulder bone that adds an extra
      // pivot, FP doesn't), so we allow some divergence. The key invariant
      // is they're NOT opposing (dot would be negative).
      expect(dot).toBeGreaterThan(0.5);
    });
  });

  describe('non-Release states bypass the arc — no spurious parity violation', () => {
    it('Windup uses keyframe poses, not the arc — different bone targets per rig', () => {
      // Sanity: outside Release, the 3rd-person system reads
      // `getCombatPose` and the FP system reads `getViewmodelPose`.
      // Those are DIFFERENT pose tables with different rotation values, so
      // we expect the two rigs to NOT match in Windup. This test pins that
      // expectation so a future "let's unify Windup too" change can't
      // silently regress visual diversity between the two views.
      CombatStateComp.state[eid] = CombatState.Windup;
      CombatStateComp.direction[eid] = Direction.Overhead;
      CombatStateComp.phaseT[eid] = 0.5;
      CombatStateComp.weaponId[eid] = 0; // Longsword

      rampToFullyBlended(
        (w, dt) => animationSystem(w, dt),
        [world, 0.016] as const,
      );
      rampToFullyBlended(
        (vm, e, dt, n) => viewmodelAnimationSystem(vm, e, dt, n),
        [viewmodel, eid, 0.016, WEAPON_ID_TO_NAME] as const,
      );

      const thirdShoulder = meshRegistry.get(eid)!.bones['shoulder_R'];
      const fpUpperArm = viewmodel.bones['upper_arm_R'];
      // These COULD coincide by accident, but in practice the third-person
      // Overhead windup is dramatically different from the FP one (the
      // Longsword windup uses different chamber poses). Document that
      // they're independent.
      const angle = thirdShoulder.quaternion.angleTo(fpUpperArm.quaternion);
      // Loose lower bound — the bones should be noticeably different.
      expect(angle).toBeGreaterThan(0.05);
    });
  });
});
