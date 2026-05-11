import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { ViewmodelRenderer, VIEWMODEL_LAYER, getArmOffset } from './ViewmodelRenderer';
import { resetBob } from './ViewmodelBob';
import { AIM_SWAY_TAU_SECONDS, ARM_OFFSET } from './ViewmodelTuning';

// Helper: create a minimal scene
function createTestScene(): THREE.Scene {
  return new THREE.Scene();
}

// Fake weapon factory for testing
function createFakeWeaponFactory(name: string) {
  return () => {
    const group = new THREE.Group();
    group.name = `test_weapon_${name}`;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.5, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff0000 }),
    );
    group.add(mesh);
    return { group, tracerPoints: [] };
  };
}

describe('ViewmodelRenderer', () => {
  let scene: THREE.Scene;
  let viewmodel: ViewmodelRenderer;
  const weaponFactories = {
    Dagger: createFakeWeaponFactory('Dagger'),
    Longsword: createFakeWeaponFactory('Longsword'),
    Mace: createFakeWeaponFactory('Mace'),
    Battleaxe: createFakeWeaponFactory('Battleaxe'),
  };

  beforeEach(() => {
    scene = createTestScene();
    viewmodel = new ViewmodelRenderer(scene, 16 / 9, {
      initialWeapon: 'Dagger',
      weaponFactories,
    });
  });

  describe('constructor', () => {
    it('creates a viewmodel camera on Layer 1', () => {
      expect(viewmodel.camera).toBeInstanceOf(THREE.PerspectiveCamera);
      // Camera layers mask should include layer 1
      // layers.set(1) sets mask to (1 << 1) = 2
      expect(viewmodel.camera.layers.mask).toBe(1 << VIEWMODEL_LAYER);
    });

    it('creates a viewmodel group added to the scene', () => {
      expect(scene.children).toContain(viewmodel.group);
    });

    it('viewmodel group has skinned arm meshes and root bone', () => {
      // group has: upper arm mesh + forearm mesh + hand mesh + root bone
      expect(viewmodel.group.children.length).toBe(4);
    });

    it('arm meshes are SkinnedMesh instances', () => {
      const upperArm = viewmodel.group.children.find(
        (c) => c.name === 'viewmodel_upper_arm',
      );
      const forearm = viewmodel.group.children.find(
        (c) => c.name === 'viewmodel_forearm',
      );
      const hand = viewmodel.group.children.find(
        (c) => c.name === 'viewmodel_hand',
      );

      expect(upperArm).toBeInstanceOf(THREE.SkinnedMesh);
      expect(forearm).toBeInstanceOf(THREE.SkinnedMesh);
      expect(hand).toBeInstanceOf(THREE.SkinnedMesh);
    });

    it('sets all meshes to Layer 1 recursively', () => {
      viewmodel.group.traverse((obj) => {
        // All objects should be on layer 1, not layer 0
        expect(obj.layers.mask).toBe(1 << VIEWMODEL_LAYER);
      });
    });

    it('attaches initial weapon when factory is available', () => {
      // Weapon is attached to weapon_attach bone
      const weaponAttach = viewmodel.bones['weapon_attach'];
      expect(weaponAttach).toBeDefined();
      const weaponChild = weaponAttach.children.find((c) =>
        c.name.startsWith('viewmodel_weapon_'),
      );
      expect(weaponChild).toBeDefined();
      expect(weaponChild!.name).toBe('viewmodel_weapon_Dagger');
    });

    it('does not crash when initial weapon factory is missing', () => {
      const vm = new ViewmodelRenderer(scene, 1, {
        initialWeapon: 'NonExistent',
        weaponFactories: {},
      });
      expect(vm.group).toBeDefined();
    });
  });

  describe('bone hierarchy', () => {
    it('exposes bones record with canonical names (no vm_ prefix)', () => {
      expect(viewmodel.bones).toBeDefined();
      expect(viewmodel.bones['upper_arm_R']).toBeInstanceOf(THREE.Bone);
      expect(viewmodel.bones['forearm_R']).toBeInstanceOf(THREE.Bone);
      expect(viewmodel.bones['hand_R']).toBeInstanceOf(THREE.Bone);
      expect(viewmodel.bones['weapon_attach']).toBeInstanceOf(THREE.Bone);
    });

    it('bones have vm_ prefixed internal names', () => {
      expect(viewmodel.bones['upper_arm_R'].name).toBe('vm_upper_arm_R');
      expect(viewmodel.bones['forearm_R'].name).toBe('vm_forearm_R');
      expect(viewmodel.bones['hand_R'].name).toBe('vm_hand_R');
      expect(viewmodel.bones['weapon_attach'].name).toBe('vm_weapon_attach');
    });

    it('bones form correct parent-child hierarchy', () => {
      const upperArm = viewmodel.bones['upper_arm_R'];
      const forearm = viewmodel.bones['forearm_R'];
      const hand = viewmodel.bones['hand_R'];
      const weaponAttach = viewmodel.bones['weapon_attach'];

      // forearm is child of upper_arm
      expect(forearm.parent).toBe(upperArm);
      // hand is child of forearm
      expect(hand.parent).toBe(forearm);
      // weapon_attach is child of hand
      expect(weaponAttach.parent).toBe(hand);
    });

    it('weapon_attach bone receives default grip rotation when factory omits gripRotation (#125 fallback)', () => {
      // Pre-#125 the bone was pre-rotated at construction; #125 moves grip
      // rotation onto WeaponModelResult.gripRotation. The test fakes here
      // omit grip data, so the renderer falls back to the legacy longsword
      // value (Math.PI * 0.85 on X). This regression-guards that fallback.
      const weaponAttach = viewmodel.bones['weapon_attach'];
      expect(weaponAttach.rotation.x).toBeCloseTo(Math.PI * 0.85);
      expect(weaponAttach.rotation.y).toBeCloseTo(0);
      expect(weaponAttach.rotation.z).toBeCloseTo(0);
    });

    it('weapon_attach bone is at rotation identity before any swap (no construction-time hardcode)', () => {
      // Construct with no factories → no initial swap → bone stays at
      // identity. Pre-#125 the bone was always rotated at construction; the
      // refactor makes grip data weapon-driven.
      const bareScene = createTestScene();
      const bare = new ViewmodelRenderer(bareScene, 1, { weaponFactories: {} });
      const bareWeaponAttach = bare.bones['weapon_attach'];
      expect(bareWeaponAttach.rotation.x).toBe(0);
      expect(bareWeaponAttach.rotation.y).toBe(0);
      expect(bareWeaponAttach.rotation.z).toBe(0);
    });

    it('root bone (upper_arm_R) is added to the group', () => {
      const upperArm = viewmodel.bones['upper_arm_R'];
      const boneInGroup = viewmodel.group.children.find(
        (c) => c instanceof THREE.Bone && c.name === 'vm_upper_arm_R',
      );
      expect(boneInGroup).toBe(upperArm);
    });

    it('shoulder bone is anchored at the group origin (at-or-below convention)', () => {
      // #81: shoulder must sit at (0, 0, 0) in group-local space so the
      // visible arm hangs DOWN from the group origin into the lower-right
      // viewport. Anything above 0 means the upper-arm box clips into the
      // top of the viewport.
      const upperArm = viewmodel.bones['upper_arm_R'];
      expect(upperArm.position.x).toBeCloseTo(0);
      expect(upperArm.position.y).toBeCloseTo(0);
      expect(upperArm.position.z).toBeCloseTo(0);
      // Stricter: shoulder Y must never exceed the group origin
      expect(upperArm.position.y).toBeLessThanOrEqual(0);
    });

    it('forearm/hand/weapon_attach bones extend negative Y from their parents', () => {
      // The arm hangs down from the shoulder via -Y child offsets; this is
      // what makes the "shoulder above, arm below" silhouette correct in FPS.
      const forearm = viewmodel.bones['forearm_R'];
      const hand = viewmodel.bones['hand_R'];
      const weaponAttach = viewmodel.bones['weapon_attach'];

      expect(forearm.position.y).toBeLessThan(0);
      expect(hand.position.y).toBeLessThan(0);
      expect(weaponAttach.position.y).toBeLessThan(0);
    });
  });

  describe('visible', () => {
    it('defaults to visible', () => {
      expect(viewmodel.visible).toBe(true);
      expect(viewmodel.group.visible).toBe(true);
    });

    it('hides the viewmodel group when set to false', () => {
      viewmodel.visible = false;
      expect(viewmodel.visible).toBe(false);
      expect(viewmodel.group.visible).toBe(false);
    });

    it('shows the viewmodel group when set to true', () => {
      viewmodel.visible = false;
      viewmodel.visible = true;
      expect(viewmodel.visible).toBe(true);
      expect(viewmodel.group.visible).toBe(true);
    });
  });

  describe('swapWeapon', () => {
    it('swaps weapon model to Longsword', () => {
      const result = viewmodel.swapWeapon('Longsword');
      expect(result).toBe(true);

      const weaponAttach = viewmodel.bones['weapon_attach'];
      const weaponChild = weaponAttach.children.find((c) =>
        c.name.startsWith('viewmodel_weapon_'),
      );
      expect(weaponChild!.name).toBe('viewmodel_weapon_Longsword');
    });

    it('removes old weapon when swapping', () => {
      viewmodel.swapWeapon('Longsword');
      viewmodel.swapWeapon('Mace');

      const weaponAttach = viewmodel.bones['weapon_attach'];
      // Should only have the new weapon (no old weapon)
      const weapons = weaponAttach.children.filter((c) =>
        c.name.startsWith('viewmodel_weapon_'),
      );
      expect(weapons.length).toBe(1);
      expect(weapons[0].name).toBe('viewmodel_weapon_Mace');
    });

    it('returns false for unknown weapon name', () => {
      const result = viewmodel.swapWeapon('UnknownWeapon');
      expect(result).toBe(false);
    });

    it('sets new weapon meshes to Layer 1', () => {
      viewmodel.swapWeapon('Longsword');

      const weaponAttach = viewmodel.bones['weapon_attach'];
      const weaponChild = weaponAttach.children.find((c) =>
        c.name.startsWith('viewmodel_weapon_'),
      );
      weaponChild!.traverse((obj) => {
        expect(obj.layers.mask).toBe(1 << VIEWMODEL_LAYER);
      });
    });

    it('weapon is a child of weapon_attach bone (not a plain Group)', () => {
      viewmodel.swapWeapon('Battleaxe');

      const weaponAttach = viewmodel.bones['weapon_attach'];
      expect(weaponAttach).toBeInstanceOf(THREE.Bone);

      const weaponChild = weaponAttach.children.find((c) =>
        c.name.startsWith('viewmodel_weapon_'),
      );
      expect(weaponChild).toBeDefined();
      expect(weaponChild!.name).toBe('viewmodel_weapon_Battleaxe');
    });

    it('all 4 weapons can be swapped successfully', () => {
      for (const name of ['Longsword', 'Mace', 'Dagger', 'Battleaxe']) {
        const result = viewmodel.swapWeapon(name);
        expect(result).toBe(true);

        const weaponAttach = viewmodel.bones['weapon_attach'];
        const weaponChild = weaponAttach.children.find((c) =>
          c.name.startsWith('viewmodel_weapon_'),
        );
        expect(weaponChild!.name).toBe(`viewmodel_weapon_${name}`);
      }
    });
  });

  describe('syncWithCamera', () => {
    beforeEach(() => {
      // Reset locomotion bob so cross-test state doesn't leak (the bob is
      // module-global; updateBob runs inside syncWithCamera).
      resetBob();
    });

    it('copies world camera position to viewmodel camera (no positional lag)', () => {
      const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
      worldCamera.position.set(5, 10, 15);
      worldCamera.quaternion.identity();

      // Pre-snap rotation so the rotation lag doesn't interfere with the
      // position assertion below.
      viewmodel.snap(worldCamera);
      viewmodel.syncWithCamera(worldCamera, 0.016, 0, 0);

      expect(viewmodel.camera.position.x).toBe(5);
      expect(viewmodel.camera.position.y).toBe(10);
      expect(viewmodel.camera.position.z).toBe(15);
    });

    it('positions viewmodel group offset from camera', () => {
      const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
      worldCamera.position.set(0, 0, 0);
      worldCamera.quaternion.identity();

      // Snap first so the group orientation matches the camera (we're
      // checking the offset, not the rotation lag).
      viewmodel.snap(worldCamera);
      viewmodel.syncWithCamera(worldCamera, 0.016, 0, 0);

      // With identity quaternion + zero velocity (no bob contribution),
      // the offset is exactly ARM_OFFSET = (0.25, -0.10, -0.4).
      expect(viewmodel.group.position.x).toBeCloseTo(0.25, 3);
      expect(viewmodel.group.position.y).toBeCloseTo(-0.1, 3);
      expect(viewmodel.group.position.z).toBeCloseTo(-0.4);
    });

    it('places the group origin (= shoulder anchor) at or below camera Y', () => {
      // Regression guard for #81: with identity camera orientation, the
      // viewmodel group origin (which is also the shoulder bone position in
      // group-local space) must NOT be above the camera. If this drifts
      // positive, the upper-arm box will clip into the top of the viewport.
      const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
      worldCamera.position.set(0, 0, 0);
      worldCamera.quaternion.identity();

      viewmodel.snap(worldCamera);
      viewmodel.syncWithCamera(worldCamera, 0.016, 0, 0);

      expect(viewmodel.group.position.y).toBeLessThanOrEqual(0);
    });

    it('eventually slerps group orientation to match the camera', () => {
      const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
      worldCamera.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));

      // Many frames at 16ms (~1.5s of game time, ~19 time constants) — should
      // converge to the camera quat within tolerance.
      for (let i = 0; i < 100; i++) {
        viewmodel.syncWithCamera(worldCamera, 0.016, 0, 0);
      }

      expect(viewmodel.group.quaternion.x).toBeCloseTo(worldCamera.quaternion.x, 3);
      expect(viewmodel.group.quaternion.y).toBeCloseTo(worldCamera.quaternion.y, 3);
      expect(viewmodel.group.quaternion.z).toBeCloseTo(worldCamera.quaternion.z, 3);
      expect(viewmodel.group.quaternion.w).toBeCloseTo(worldCamera.quaternion.w, 3);
    });

    // ─── Aim-sway lag (doc §7) ───
    describe('aim-sway lag', () => {
      it('first frame: viewmodel quat is partway between identity and camera (≈18% at dt=16ms)', () => {
        // alpha = 1 - exp(-0.016 / 0.080) ≈ 0.181
        const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
        worldCamera.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));

        // Start from identity (group quat is identity by construction)
        const startQuat = viewmodel.group.quaternion.clone();
        const targetAngle = startQuat.angleTo(worldCamera.quaternion);

        viewmodel.syncWithCamera(worldCamera, 0.016, 0, 0);

        const remainingAngle = viewmodel.group.quaternion.angleTo(worldCamera.quaternion);
        // After one slerp at alpha≈0.181, ~82% of the angle remains.
        const expectedAlpha = 1 - Math.exp(-0.016 / AIM_SWAY_TAU_SECONDS);
        const expectedRemaining = targetAngle * (1 - expectedAlpha);
        expect(remainingAngle).toBeCloseTo(expectedRemaining, 2);
      });

      it('5 frames at 16ms → ~63% closed (one time constant)', () => {
        const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
        worldCamera.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
        const startAngle = viewmodel.group.quaternion.angleTo(worldCamera.quaternion);

        // 5 × 0.016 = 0.080s = TAU. Expected closed ≈ 1 - 1/e ≈ 0.632.
        for (let i = 0; i < 5; i++) {
          viewmodel.syncWithCamera(worldCamera, 0.016, 0, 0);
        }
        const remainingAngle = viewmodel.group.quaternion.angleTo(worldCamera.quaternion);
        const closedFraction = 1 - remainingAngle / startAngle;
        expect(closedFraction).toBeCloseTo(0.632, 1);
      });

      it('frame-rate independent: 30Hz vs 144Hz converge similarly over equal sim time', () => {
        const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
        worldCamera.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));

        // 0.5s of sim time at 30Hz
        const a = new ViewmodelRenderer(createTestScene(), 1, {
          weaponFactories,
        });
        for (let i = 0; i < 15; i++) a.syncWithCamera(worldCamera, 1 / 30, 0, 0);

        // 0.5s of sim time at 144Hz
        const b = new ViewmodelRenderer(createTestScene(), 1, {
          weaponFactories,
        });
        for (let i = 0; i < Math.round(144 * 0.5); i++) b.syncWithCamera(worldCamera, 1 / 144, 0, 0);

        const aRemaining = a.group.quaternion.angleTo(worldCamera.quaternion);
        const bRemaining = b.group.quaternion.angleTo(worldCamera.quaternion);
        // Allow a tiny tolerance for accumulator drift between the two paths
        expect(Math.abs(aRemaining - bRemaining)).toBeLessThan(0.05);
      });

      it('viewmodel CAMERA quat is also lagged in lockstep with the group', () => {
        // Prevents arm "swimming" in screen space — the camera frame must
        // share the lag, not snap to the world camera.
        const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
        worldCamera.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));

        viewmodel.syncWithCamera(worldCamera, 0.016, 0, 0);

        // After one frame the viewmodel camera quat should match the group
        // quat (both lagged), NOT the world camera quat.
        expect(viewmodel.camera.quaternion.angleTo(viewmodel.group.quaternion))
          .toBeLessThan(1e-5);
      });
    });

    // ─── snap() ───
    describe('snap', () => {
      it('hard-copies camera quaternion to group + viewmodel camera', () => {
        const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
        worldCamera.position.set(10, 20, 30);
        worldCamera.quaternion.setFromEuler(new THREE.Euler(0.4, 1.2, 0));

        viewmodel.snap(worldCamera);

        expect(viewmodel.group.quaternion.x).toBeCloseTo(worldCamera.quaternion.x);
        expect(viewmodel.group.quaternion.y).toBeCloseTo(worldCamera.quaternion.y);
        expect(viewmodel.group.quaternion.z).toBeCloseTo(worldCamera.quaternion.z);
        expect(viewmodel.group.quaternion.w).toBeCloseTo(worldCamera.quaternion.w);
        expect(viewmodel.camera.quaternion.x).toBeCloseTo(worldCamera.quaternion.x);
        expect(viewmodel.camera.position.x).toBe(10);
      });

      it('subsequent slerp resumes from the snapped pose', () => {
        const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
        worldCamera.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));

        viewmodel.snap(worldCamera);
        // Now rotate the camera further; lag should kick in from the SNAPPED
        // pose, not from identity.
        worldCamera.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0));
        viewmodel.syncWithCamera(worldCamera, 0.016, 0, 0);

        // Group should be partway between the snapped pose (Math.PI/2) and
        // the new target (Math.PI). Verify it's NOT at identity (which would
        // mean the snap didn't take).
        const identityAngle = viewmodel.group.quaternion.angleTo(new THREE.Quaternion());
        expect(identityAngle).toBeGreaterThan(Math.PI / 4);
      });

      it('resets bob on snap (no stale stride after respawn)', () => {
        // Build up bob state by running with velocity
        for (let i = 0; i < 100; i++) {
          viewmodel.syncWithCamera(new THREE.PerspectiveCamera(78, 1, 0.1, 1000), 0.016, 4, 0);
        }
        // Snap should reset
        viewmodel.snap(new THREE.PerspectiveCamera(78, 1, 0.1, 1000));
        // After snap with stationary, no bob contribution
        const cam = new THREE.PerspectiveCamera(78, 1, 0.1, 1000);
        cam.position.set(0, 0, 0);
        cam.quaternion.identity();
        viewmodel.snap(cam); // snap again to set group position cleanly
        // Should be at exactly ARM_OFFSET (no bob contamination)
        expect(viewmodel.group.position.x).toBeCloseTo(ARM_OFFSET.x);
        expect(viewmodel.group.position.y).toBeCloseTo(ARM_OFFSET.y);
        expect(viewmodel.group.position.z).toBeCloseTo(ARM_OFFSET.z);
      });
    });

    // ─── Locomotion bob (doc §6) ───
    describe('locomotion bob integration', () => {
      it('stationary player produces no bob contribution after warmup', () => {
        const worldCamera = new THREE.PerspectiveCamera(78, 1, 0.1, 1000);
        worldCamera.position.set(0, 0, 0);
        worldCamera.quaternion.identity();

        // Snap first, then sync many frames at zero velocity. Position should
        // remain exactly at camera + ARM_OFFSET (no bob jitter).
        viewmodel.snap(worldCamera);
        for (let i = 0; i < 100; i++) {
          viewmodel.syncWithCamera(worldCamera, 0.016, 0, 0);
        }

        expect(viewmodel.group.position.x).toBeCloseTo(ARM_OFFSET.x, 4);
        expect(viewmodel.group.position.y).toBeCloseTo(ARM_OFFSET.y, 4);
        expect(viewmodel.group.position.z).toBeCloseTo(ARM_OFFSET.z, 4);
      });

      it('walking adds visible bob to position over time', () => {
        const worldCamera = new THREE.PerspectiveCamera(78, 1, 0.1, 1000);
        worldCamera.position.set(0, 0, 0);
        worldCamera.quaternion.identity();
        viewmodel.snap(worldCamera);

        // Run many frames at a moderate horizontal speed.
        let maxYDeviation = 0;
        for (let i = 0; i < 200; i++) {
          viewmodel.syncWithCamera(worldCamera, 0.016, 4, 0); // 4 m/s = WALK_SPEED
          maxYDeviation = Math.max(
            maxYDeviation,
            Math.abs(viewmodel.group.position.y - ARM_OFFSET.y),
          );
        }
        // At full bob, vertical amplitude is BOB_VERTICAL_AMPLITUDE = 0.012.
        expect(maxYDeviation).toBeGreaterThan(0.005);
        expect(maxYDeviation).toBeLessThan(0.015);
      });
    });
  });

  describe('updateAspect', () => {
    it('updates camera aspect ratio', () => {
      viewmodel.updateAspect(4 / 3);
      expect(viewmodel.camera.aspect).toBeCloseTo(4 / 3);
    });
  });

  describe('dispose', () => {
    it('removes group from scene', () => {
      expect(scene.children).toContain(viewmodel.group);
      viewmodel.dispose();
      expect(scene.children).not.toContain(viewmodel.group);
    });
  });

  // ─── Per-weapon grip data + pre-warmed cache (#125, doc §4 + §8) ───
  describe('per-weapon grip data and pre-warmed cache', () => {
    /** Build a fake factory that always returns the SAME group/result so
     *  reference-equality checks across swap roundtrips are meaningful. */
    function makeStableFactory(
      name: string,
      gripOffset?: THREE.Vector3,
      gripRotation?: THREE.Euler,
    ) {
      const group = new THREE.Group();
      group.name = `test_weapon_${name}`;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.5, 0.1),
        new THREE.MeshBasicMaterial({ color: 0xff0000 }),
      );
      group.add(mesh);
      const result: WeaponModelResultLike = {
        group,
        tracerPoints: [],
        gripOffset,
        gripRotation,
      };
      let calls = 0;
      const factory = () => {
        calls++;
        return result;
      };
      return { factory, group, getCalls: () => calls };
    }

    // Local alias to avoid coupling tests to the real type import path
    type WeaponModelResultLike = {
      group: THREE.Group;
      tracerPoints: THREE.Vector3[];
      gripOffset?: THREE.Vector3;
      gripRotation?: THREE.Euler;
    };

    describe('cache pre-warming', () => {
      it('calls each factory exactly once at construction', () => {
        const longsword = makeStableFactory('Longsword');
        const mace = makeStableFactory('Mace');
        const dagger = makeStableFactory('Dagger');
        const battleaxe = makeStableFactory('Battleaxe');

        const localScene = createTestScene();
        const _vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'Dagger',
          weaponFactories: {
            Longsword: longsword.factory,
            Mace: mace.factory,
            Dagger: dagger.factory,
            Battleaxe: battleaxe.factory,
          },
        });
        // Ensure variable is "used" — silences strict-unused warnings without
        // pulling the renderer out of scope before the assertions.
        expect(_vm).toBeDefined();

        // Each factory called exactly ONCE — pre-warm, not per-swap.
        expect(longsword.getCalls()).toBe(1);
        expect(mace.getCalls()).toBe(1);
        expect(dagger.getCalls()).toBe(1);
        expect(battleaxe.getCalls()).toBe(1);
      });

      it('multiple swaps after init do NOT call factories again', () => {
        const longsword = makeStableFactory('Longsword');
        const mace = makeStableFactory('Mace');

        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'Longsword',
          weaponFactories: {
            Longsword: longsword.factory,
            Mace: mace.factory,
          },
        });

        // Initial pre-warm hit each factory once
        expect(longsword.getCalls()).toBe(1);
        expect(mace.getCalls()).toBe(1);

        // Swap A → B → A → B
        vm.swapWeapon('Mace');
        vm.swapWeapon('Longsword');
        vm.swapWeapon('Mace');
        vm.swapWeapon('Longsword');

        // Factories still only called once — cache hit on every swap.
        expect(longsword.getCalls()).toBe(1);
        expect(mace.getCalls()).toBe(1);
      });

      it('swap re-uses the SAME cached group (reference equality preserved)', () => {
        const longsword = makeStableFactory('Longsword');
        const mace = makeStableFactory('Mace');

        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'Longsword',
          weaponFactories: {
            Longsword: longsword.factory,
            Mace: mace.factory,
          },
        });

        const weaponAttach = vm.bones['weapon_attach'];
        const longswordGroupAfterFirst = weaponAttach.children.find((c) =>
          c.name.startsWith('viewmodel_weapon_'),
        );
        expect(longswordGroupAfterFirst).toBe(longsword.group);

        vm.swapWeapon('Mace');
        vm.swapWeapon('Longsword');

        const longswordGroupAfterRoundtrip = weaponAttach.children.find((c) =>
          c.name.startsWith('viewmodel_weapon_'),
        );
        // Same THREE.Group instance — proves cache returned, not reallocated.
        expect(longswordGroupAfterRoundtrip).toBe(longsword.group);
      });

      it('cached weapon meshes are pre-set to Layer 1 (not just on swap)', () => {
        // Pre-#125 the layer was set inside swapWeapon. Now it's set at
        // cache time so currently-detached cached weapons are still Layer-1
        // ready.
        const longsword = makeStableFactory('Longsword');
        const mace = makeStableFactory('Mace');

        const localScene = createTestScene();
        const _vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'Longsword',
          weaponFactories: {
            Longsword: longsword.factory,
            Mace: mace.factory,
          },
        });
        expect(_vm).toBeDefined();

        // Mace was cached but never mounted — its meshes should still be
        // on Layer 1 from cache pre-warm.
        mace.group.traverse((obj) => {
          expect(obj.layers.mask).toBe(1 << VIEWMODEL_LAYER);
        });
      });
    });

    describe('grip data application', () => {
      it('applies gripOffset (additive from base) and gripRotation (replacement) on swap', () => {
        // gripOffset is additive from the construction-time hand-bottom
        // anchor — see ViewmodelRenderer source for the rationale. With the
        // arm proportions HAND_H = 0.12, the base position is (0, -0.12, 0).
        const offset = new THREE.Vector3(0.1, -0.05, 0.2);
        const rotation = new THREE.Euler(Math.PI * 0.5, 0.3, -0.2);
        const factoryData = makeStableFactory('CustomGrip', offset, rotation);

        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'CustomGrip',
          weaponFactories: { CustomGrip: factoryData.factory },
        });

        const weaponAttach = vm.bones['weapon_attach'];
        // Position = base (0, -HAND_H=-0.12, 0) + gripOffset (0.1, -0.05, 0.2)
        expect(weaponAttach.position.x).toBeCloseTo(0.1);
        expect(weaponAttach.position.y).toBeCloseTo(-0.12 + -0.05);
        expect(weaponAttach.position.z).toBeCloseTo(0.2);
        // Rotation is full replacement (no construction-time rotation).
        expect(weaponAttach.rotation.x).toBeCloseTo(Math.PI * 0.5);
        expect(weaponAttach.rotation.y).toBeCloseTo(0.3);
        expect(weaponAttach.rotation.z).toBeCloseTo(-0.2);
      });

      it('falls back to default offset (no shift from base) when factory omits gripOffset', () => {
        // Rotation supplied, offset omitted → bone stays at the construction
        // base (0, -HAND_H, 0). This is what makes the doc's "longsword
        // preserves current behavior" claim literally true.
        const factoryData = makeStableFactory(
          'NoOffset',
          undefined,
          new THREE.Euler(0.1, 0.2, 0.3),
        );

        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'NoOffset',
          weaponFactories: { NoOffset: factoryData.factory },
        });

        const weaponAttach = vm.bones['weapon_attach'];
        expect(weaponAttach.position.x).toBeCloseTo(0);
        // y stays at the hand-bottom anchor (≈ -0.12).
        expect(weaponAttach.position.y).toBeLessThan(0);
        expect(weaponAttach.position.z).toBeCloseTo(0);
      });

      it('falls back to legacy Math.PI * 0.85 rotation when factory omits gripRotation', () => {
        // Offset supplied, rotation omitted → fallback (PI*0.85, 0, 0)
        const factoryData = makeStableFactory(
          'NoRotation',
          new THREE.Vector3(0.1, 0.2, 0.3),
          undefined,
        );

        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'NoRotation',
          weaponFactories: { NoRotation: factoryData.factory },
        });

        const weaponAttach = vm.bones['weapon_attach'];
        expect(weaponAttach.rotation.x).toBeCloseTo(Math.PI * 0.85);
        expect(weaponAttach.rotation.y).toBeCloseTo(0);
        expect(weaponAttach.rotation.z).toBeCloseTo(0);
      });

      it('overwrites the previous weapon’s grip values on swap (no leak between weapons)', () => {
        // Position is base + gripOffset; rotation is straight replacement.
        // Both must reset to the new weapon's values on swap — no residual
        // contribution from A when we mount B.
        const aFactoryData = makeStableFactory(
          'A',
          new THREE.Vector3(0.5, 0.5, 0.5),
          new THREE.Euler(0.1, 0.2, 0.3),
        );
        const bFactoryData = makeStableFactory(
          'B',
          new THREE.Vector3(-0.5, -0.5, -0.5),
          new THREE.Euler(-0.1, -0.2, -0.3),
        );

        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'A',
          weaponFactories: {
            A: aFactoryData.factory,
            B: bFactoryData.factory,
          },
        });
        const weaponAttach = vm.bones['weapon_attach'];

        // After A: rotation should be A's, position = base + A's offset
        expect(weaponAttach.rotation.x).toBeCloseTo(0.1);
        expect(weaponAttach.position.x).toBeCloseTo(0 + 0.5);

        vm.swapWeapon('B');
        // After B: rotation = B's (no residual A), position = base + B's offset
        expect(weaponAttach.position.x).toBeCloseTo(0 + -0.5);
        expect(weaponAttach.rotation.x).toBeCloseTo(-0.1);

        vm.swapWeapon('A');
        // Roundtrip back to A: A's values restored
        expect(weaponAttach.position.x).toBeCloseTo(0 + 0.5);
        expect(weaponAttach.rotation.x).toBeCloseTo(0.1);
      });
    });

    describe('real weapon factories supply grip data', () => {
      // Doc §4.3 supplied initial tuning values; these tests pin the values
      // so visual tuning regressions surface as test diffs (not silent).
      it('all 4 canonical weapons carry gripOffset and gripRotation', async () => {
        // Importing the real factories — forced inside the test so the rest
        // of the suite stays scene-mock based.
        const { weaponModelFactories: realFactories } = await import(
          './WeaponModels'
        );
        for (const name of ['Longsword', 'Mace', 'Dagger', 'Battleaxe']) {
          const factory = realFactories[name];
          expect(factory).toBeDefined();
          const result = factory();
          expect(result.gripOffset).toBeInstanceOf(THREE.Vector3);
          expect(result.gripRotation).toBeInstanceOf(THREE.Euler);
        }
      });

      it('Longsword preserves the legacy Math.PI * 0.85 grip rotation (no visual regression)', async () => {
        const { createLongswordModel } = await import('./CharacterModel');
        const result = createLongswordModel();
        expect(result.gripRotation!.x).toBeCloseTo(Math.PI * 0.85);
        expect(result.gripRotation!.y).toBeCloseTo(0);
        expect(result.gripRotation!.z).toBeCloseTo(0);
        expect(result.gripOffset!.x).toBeCloseTo(0);
        expect(result.gripOffset!.y).toBeCloseTo(0);
        expect(result.gripOffset!.z).toBeCloseTo(0);
      });

      it('cached real factories produce a fully-Layer-1 viewmodel', async () => {
        const { weaponModelFactories: realFactories } = await import(
          './WeaponModels'
        );
        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'Longsword',
          weaponFactories: realFactories,
        });

        // After construction, a swap to each real weapon should land its
        // mesh tree on Layer 1.
        for (const name of ['Longsword', 'Mace', 'Dagger', 'Battleaxe']) {
          const ok = vm.swapWeapon(name);
          expect(ok).toBe(true);
          const weaponAttach = vm.bones['weapon_attach'];
          const child = weaponAttach.children.find((c) =>
            c.name.startsWith('viewmodel_weapon_'),
          );
          expect(child).toBeDefined();
          child!.traverse((obj) => {
            expect(obj.layers.mask).toBe(1 << VIEWMODEL_LAYER);
          });
        }
      });
    });

    describe('dispose disposes every cached model', () => {
      it('calls geometry.dispose() and material.dispose() on every cached weapon', () => {
        // Spy on dispose for each mesh in the cached groups (currently
        // mounted + currently detached).
        const longsword = makeStableFactory('Longsword');
        const mace = makeStableFactory('Mace');

        const longswordGeomDispose = vi.spyOn(
          (longsword.group.children[0] as THREE.Mesh).geometry,
          'dispose',
        );
        const longswordMatDispose = vi.spyOn(
          (longsword.group.children[0] as THREE.Mesh).material as THREE.Material,
          'dispose',
        );
        const maceGeomDispose = vi.spyOn(
          (mace.group.children[0] as THREE.Mesh).geometry,
          'dispose',
        );
        const maceMatDispose = vi.spyOn(
          (mace.group.children[0] as THREE.Mesh).material as THREE.Material,
          'dispose',
        );

        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'Longsword',
          weaponFactories: {
            Longsword: longsword.factory,
            Mace: mace.factory,
          },
        });
        // Mace is cached but never mounted; longsword is mounted.
        vm.dispose();

        expect(longswordGeomDispose).toHaveBeenCalled();
        expect(longswordMatDispose).toHaveBeenCalled();
        expect(maceGeomDispose).toHaveBeenCalled();
        expect(maceMatDispose).toHaveBeenCalled();
      });

      it('does not double-dispose the currently mounted weapon', () => {
        // The mounted weapon is a child of weapon_attach (inside the arm
        // group), so it's covered by the arm-group traverse. Disposing again
        // from the cache walk would call .dispose() twice — Three.js handles
        // it gracefully but we want to be explicit about not doing it.
        const longsword = makeStableFactory('Longsword');
        const longswordGeomDispose = vi.spyOn(
          (longsword.group.children[0] as THREE.Mesh).geometry,
          'dispose',
        );

        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'Longsword',
          weaponFactories: { Longsword: longsword.factory },
        });
        vm.dispose();

        // Mounted weapon disposed exactly once via the arm-group traverse.
        expect(longswordGeomDispose).toHaveBeenCalledTimes(1);
      });

      it('clears the internal cache after dispose', () => {
        // Indirect assertion: post-dispose, swapWeapon should return false
        // for any weapon (cache empty).
        const longsword = makeStableFactory('Longsword');
        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'Longsword',
          weaponFactories: { Longsword: longsword.factory },
        });

        // Silence the expected console.warn inside swapWeapon
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vm.dispose();
        expect(vm.swapWeapon('Longsword')).toBe(false);
        warnSpy.mockRestore();
      });
    });

    describe('default weaponFactories (cleanup of main.ts duplication)', () => {
      it('falls back to imported weaponModelFactories when option omitted', async () => {
        // ViewmodelRenderer with NO weaponFactories option should still
        // wire up the 4 canonical weapons from `./WeaponModels`, removing
        // the need to inline the registry in main.ts.
        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: 'Longsword',
        });

        // Initial weapon should attach successfully
        const weaponAttach = vm.bones['weapon_attach'];
        const child = weaponAttach.children.find((c) =>
          c.name.startsWith('viewmodel_weapon_'),
        );
        expect(child).toBeDefined();
        expect(child!.name).toBe('viewmodel_weapon_Longsword');

        // All 4 should be swappable (proves the canonical registry was used)
        expect(vm.swapWeapon('Mace')).toBe(true);
        expect(vm.swapWeapon('Dagger')).toBe(true);
        expect(vm.swapWeapon('Battleaxe')).toBe(true);
        expect(vm.swapWeapon('Longsword')).toBe(true);
      });
    });
  });

  describe('getCurrentWeaponName', () => {
    it('returns the initial weapon name', () => {
      expect(viewmodel.getCurrentWeaponName()).toBe('Dagger');
    });

    it('returns null when initial weapon factory was missing', () => {
      const vm = new ViewmodelRenderer(scene, 1, {
        initialWeapon: 'NonExistent',
        weaponFactories: {},
      });
      expect(vm.getCurrentWeaponName()).toBeNull();
    });

    it('updates after a swapWeapon call', () => {
      viewmodel.swapWeapon('Mace');
      expect(viewmodel.getCurrentWeaponName()).toBe('Mace');
      viewmodel.swapWeapon('Battleaxe');
      expect(viewmodel.getCurrentWeaponName()).toBe('Battleaxe');
    });

    it('does not update on a failed swap', () => {
      // Initial weapon is Dagger.
      const result = viewmodel.swapWeapon('NotARealWeapon');
      expect(result).toBe(false);
      expect(viewmodel.getCurrentWeaponName()).toBe('Dagger');
    });
  });

  describe('getArmOffset', () => {
    it('returns a Vector3 with the FPS lower-right offset', () => {
      const offset = getArmOffset();
      expect(offset).toBeInstanceOf(THREE.Vector3);
      expect(offset.x).toBeCloseTo(0.25);
      expect(offset.y).toBeCloseTo(-0.1);
      expect(offset.z).toBeCloseTo(-0.4);
    });
  });

  // ─── Layer-leak contract guard (#173, parent #171) ───
  //
  // The two-pass render pipeline relies on every Object3D under the
  // viewmodel group being on Layer 1. The viewmodel camera renders Layer 1
  // ONLY, and the world camera renders Layer 0 ONLY (after `scene.background`
  // is nulled). Any object that drifts to Layer 0 would render in the world
  // pass — z-fighting with everything and visibly pierced by walls. These
  // tests pin the invariant under construction + repeated swaps so a future
  // factory that mutates its returned group post-cache surfaces immediately
  // instead of as a runtime visual artifact.
  describe('layer-leak contract (#173)', () => {
    const SWAP_CYCLE = ['Longsword', 'Mace', 'Dagger', 'Battleaxe'] as const;

    function assertAllLayer1(root: THREE.Object3D): void {
      root.traverse((obj) => {
        expect(obj.layers.mask).toBe(1 << VIEWMODEL_LAYER);
      });
    }

    it('every Object3D in the viewmodel group is on Layer 1 after construction (all 4 weapons)', () => {
      for (const initial of SWAP_CYCLE) {
        const localScene = createTestScene();
        const vm = new ViewmodelRenderer(localScene, 1, {
          initialWeapon: initial,
          weaponFactories,
        });
        assertAllLayer1(vm.group);
      }
    });

    it('100-cycle swapWeapon stress (A→B→C→D→A→…) keeps every Object3D on Layer 1', () => {
      const localScene = createTestScene();
      const vm = new ViewmodelRenderer(localScene, 1, {
        initialWeapon: 'Dagger',
        weaponFactories,
      });
      for (let i = 0; i < 100; i++) {
        const name = SWAP_CYCLE[i % SWAP_CYCLE.length];
        expect(vm.swapWeapon(name)).toBe(true);
        // Spot-check inside the loop too — surfaces the offending iteration
        // if the invariant ever breaks, not just the final state.
        assertAllLayer1(vm.group);
      }
    });

    it('swap-stress against real weapon factories also keeps every Object3D on Layer 1', async () => {
      const { weaponModelFactories: realFactories } = await import('./WeaponModels');
      const localScene = createTestScene();
      const vm = new ViewmodelRenderer(localScene, 1, {
        initialWeapon: 'Longsword',
        weaponFactories: realFactories,
      });
      for (let i = 0; i < 100; i++) {
        const name = SWAP_CYCLE[i % SWAP_CYCLE.length];
        vm.swapWeapon(name);
      }
      assertAllLayer1(vm.group);
    });

    it('AxesHelpers stay on Layer 1 through swap stress with debug mode on', () => {
      // Layer-guard re-application must NOT inadvertently affect helpers
      // parented to arm bones (which live outside the cached weapon group).
      const localScene = createTestScene();
      const vm = new ViewmodelRenderer(localScene, 1, {
        initialWeapon: 'Dagger',
        weaponFactories,
      });
      vm.setDebugMode(true);
      for (let i = 0; i < 100; i++) {
        vm.swapWeapon(SWAP_CYCLE[i % SWAP_CYCLE.length]);
      }
      let axesCount = 0;
      vm.group.traverse((obj) => {
        if (obj instanceof THREE.AxesHelper) {
          axesCount++;
          expect(obj.layers.mask).toBe(1 << VIEWMODEL_LAYER);
        }
      });
      // One AxesHelper per animatable bone (4 bones in DEBUG_BONE_NAMES).
      expect(axesCount).toBe(4);
    });

    it('defensive guard rescues a post-cache mutated group (no-Layer-0 escape)', () => {
      // Simulates the hazard the issue describes: a factory that adds a
      // child to its returned group AFTER the renderer has cached it. The
      // hostile child enters at Layer 0; the next swapWeapon call must
      // re-apply Layer 1 recursively and rescue it.
      const localScene = createTestScene();
      const vm = new ViewmodelRenderer(localScene, 1, {
        initialWeapon: 'Longsword',
        weaponFactories,
      });

      // Reach into the live cache and add a Layer-0 mesh to the Longsword
      // group, mimicking a misbehaving factory or animation system.
      const weaponAttach = vm.bones['weapon_attach'];
      const cachedLongswordGroup = weaponAttach.children.find((c) =>
        c.name.startsWith('viewmodel_weapon_'),
      ) as THREE.Group;
      const hostileMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, 0.01, 0.01),
        new THREE.MeshBasicMaterial(),
      );
      // Default Object3D layers mask = 1 << 0 (Layer 0).
      expect(hostileMesh.layers.mask).toBe(1 << 0);
      cachedLongswordGroup.add(hostileMesh);

      // Swap to a different weapon, then back. The defensive
      // `setLayerRecursive` on swap should rescue the hostile mesh.
      vm.swapWeapon('Mace');
      vm.swapWeapon('Longsword');

      expect(hostileMesh.layers.mask).toBe(1 << VIEWMODEL_LAYER);
      assertAllLayer1(vm.group);
    });
  });

  // ─── Cache stability contract (#173) ───
  //
  // `swapWeapon` must re-parent the cached `THREE.Group`, never reallocate.
  // Reference equality before/after no-op (A→A) and roundtrip (A→B→A)
  // swaps pins this — a future "convenience" rewrite that calls the factory
  // again on swap would fail these tests.
  describe('swap cache stability (#173)', () => {
    function makeRefStableFactory(name: string) {
      const group = new THREE.Group();
      group.name = `stable_weapon_${name}`;
      group.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.5, 0.1),
          new THREE.MeshBasicMaterial({ color: 0xabcdef }),
        ),
      );
      const result = { group, tracerPoints: [] as THREE.Vector3[] };
      let calls = 0;
      const factory = () => {
        calls++;
        return result;
      };
      return { factory, group, getCalls: () => calls };
    }

    it('A→A no-op swap returns the same cached Group instance (no re-alloc)', () => {
      const longsword = makeRefStableFactory('Longsword');
      const localScene = createTestScene();
      const vm = new ViewmodelRenderer(localScene, 1, {
        initialWeapon: 'Longsword',
        weaponFactories: { Longsword: longsword.factory },
      });
      const weaponAttach = vm.bones['weapon_attach'];
      const before = weaponAttach.children.find((c) =>
        c.name.startsWith('viewmodel_weapon_'),
      );
      expect(before).toBe(longsword.group);

      const ok = vm.swapWeapon('Longsword'); // A→A no-op swap
      expect(ok).toBe(true);

      const after = weaponAttach.children.find((c) =>
        c.name.startsWith('viewmodel_weapon_'),
      );
      // Same exact Group instance from the cache, never reallocated.
      expect(after).toBe(before);
      // And the factory was only ever called once (pre-warm) — A→A swap
      // does not re-invoke it.
      expect(longsword.getCalls()).toBe(1);
    });

    it('A→B→A returns the same A instance both times', () => {
      const longsword = makeRefStableFactory('Longsword');
      const mace = makeRefStableFactory('Mace');
      const localScene = createTestScene();
      const vm = new ViewmodelRenderer(localScene, 1, {
        initialWeapon: 'Longsword',
        weaponFactories: {
          Longsword: longsword.factory,
          Mace: mace.factory,
        },
      });
      const weaponAttach = vm.bones['weapon_attach'];

      const firstA = weaponAttach.children.find((c) =>
        c.name.startsWith('viewmodel_weapon_'),
      );
      expect(firstA).toBe(longsword.group);

      vm.swapWeapon('Mace');
      vm.swapWeapon('Longsword');

      const secondA = weaponAttach.children.find((c) =>
        c.name.startsWith('viewmodel_weapon_'),
      );
      expect(secondA).toBe(firstA);
      expect(secondA).toBe(longsword.group);

      // Each factory called exactly once during pre-warm — swaps are
      // cache-hits, not factory invocations.
      expect(longsword.getCalls()).toBe(1);
      expect(mace.getCalls()).toBe(1);
    });

    it('100-cycle swap stress preserves cache reference equality', () => {
      const factories = {
        Longsword: makeRefStableFactory('Longsword'),
        Mace: makeRefStableFactory('Mace'),
        Dagger: makeRefStableFactory('Dagger'),
        Battleaxe: makeRefStableFactory('Battleaxe'),
      };
      const localScene = createTestScene();
      const vm = new ViewmodelRenderer(localScene, 1, {
        initialWeapon: 'Dagger',
        weaponFactories: {
          Longsword: factories.Longsword.factory,
          Mace: factories.Mace.factory,
          Dagger: factories.Dagger.factory,
          Battleaxe: factories.Battleaxe.factory,
        },
      });
      const weaponAttach = vm.bones['weapon_attach'];
      const cycle = ['Longsword', 'Mace', 'Dagger', 'Battleaxe'] as const;
      const expectedByName: Record<string, THREE.Group> = {
        Longsword: factories.Longsword.group,
        Mace: factories.Mace.group,
        Dagger: factories.Dagger.group,
        Battleaxe: factories.Battleaxe.group,
      };
      for (let i = 0; i < 100; i++) {
        const name = cycle[i % cycle.length];
        vm.swapWeapon(name);
        const mounted = weaponAttach.children.find((c) =>
          c.name.startsWith('viewmodel_weapon_'),
        );
        expect(mounted).toBe(expectedByName[name]);
      }
      // Every factory still called exactly once — no swap re-invoked any of
      // them across 100 cycles.
      expect(factories.Longsword.getCalls()).toBe(1);
      expect(factories.Mace.getCalls()).toBe(1);
      expect(factories.Dagger.getCalls()).toBe(1);
      expect(factories.Battleaxe.getCalls()).toBe(1);
    });
  });

  describe('setDebugMode (--debug-viewmodel toggle)', () => {
    it('defaults to off (no AxesHelpers in scene)', () => {
      // Walk the bone hierarchy and confirm zero AxesHelpers exist before
      // setDebugMode(true) is ever called. This pins the zero-cost-when-disabled
      // contract from the issue.
      let helperCount = 0;
      viewmodel.group.traverse((obj) => {
        if (obj instanceof THREE.AxesHelper) helperCount++;
      });
      expect(helperCount).toBe(0);
      expect(viewmodel.debugMode).toBe(false);
    });

    it('parents an AxesHelper to each animatable bone when enabled', () => {
      viewmodel.setDebugMode(true);
      expect(viewmodel.debugMode).toBe(true);

      // Each of the four bones should have an AxesHelper child.
      for (const boneName of ['upper_arm_R', 'forearm_R', 'hand_R', 'weapon_attach']) {
        const bone = viewmodel.bones[boneName];
        const helpers = bone.children.filter((c) => c instanceof THREE.AxesHelper);
        expect(helpers.length).toBe(1);
      }
    });

    it('AxesHelpers are on Layer 1 (viewmodel layer)', () => {
      viewmodel.setDebugMode(true);

      for (const boneName of ['upper_arm_R', 'forearm_R', 'hand_R', 'weapon_attach']) {
        const bone = viewmodel.bones[boneName];
        const helper = bone.children.find((c) => c instanceof THREE.AxesHelper);
        expect(helper).toBeDefined();
        expect(helper!.layers.mask).toBe(1 << VIEWMODEL_LAYER);
      }
    });

    it('hides existing AxesHelpers when disabled (without re-allocating)', () => {
      viewmodel.setDebugMode(true);
      const upperArmHelper = viewmodel.bones['upper_arm_R'].children.find(
        (c) => c instanceof THREE.AxesHelper,
      ) as THREE.AxesHelper;
      expect(upperArmHelper.visible).toBe(true);

      viewmodel.setDebugMode(false);

      // Helper still in scene (lazy: cheap re-enable) but hidden.
      const stillThere = viewmodel.bones['upper_arm_R'].children.find(
        (c) => c instanceof THREE.AxesHelper,
      );
      expect(stillThere).toBe(upperArmHelper); // same instance, no re-alloc
      expect(upperArmHelper.visible).toBe(false);
      expect(viewmodel.debugMode).toBe(false);
    });

    it('re-enabling does not allocate new AxesHelpers', () => {
      viewmodel.setDebugMode(true);
      const original = viewmodel.bones['upper_arm_R'].children.find(
        (c) => c instanceof THREE.AxesHelper,
      ) as THREE.AxesHelper;

      viewmodel.setDebugMode(false);
      viewmodel.setDebugMode(true);

      // Should still be exactly one helper per bone, and it should be the
      // same instance allocated on the first enable.
      const helpers = viewmodel.bones['upper_arm_R'].children.filter(
        (c) => c instanceof THREE.AxesHelper,
      );
      expect(helpers.length).toBe(1);
      expect(helpers[0]).toBe(original);
      expect(original.visible).toBe(true);
    });

    it('uses the size constant 0.05 (matches issue spec)', () => {
      viewmodel.setDebugMode(true);
      const helper = viewmodel.bones['upper_arm_R'].children.find(
        (c) => c instanceof THREE.AxesHelper,
      ) as THREE.AxesHelper;

      // AxesHelper geometry stores six vertices at +/- size on each axis.
      // The largest absolute coordinate equals the size argument.
      const posAttr = helper.geometry.getAttribute('position');
      let maxAbs = 0;
      for (let i = 0; i < posAttr.count * 3; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(posAttr.array[i]));
      }
      expect(maxAbs).toBeCloseTo(0.05);
    });

    it('handles repeated toggles without leaks', () => {
      // Toggle a bunch of times — should always end with exactly one helper
      // per bone in the scene.
      for (let i = 0; i < 10; i++) {
        viewmodel.setDebugMode(i % 2 === 0);
      }
      viewmodel.setDebugMode(true);

      let total = 0;
      viewmodel.group.traverse((obj) => {
        if (obj instanceof THREE.AxesHelper) total++;
      });
      expect(total).toBe(4);
    });

    it('setDebugMode(false) is a safe no-op when never enabled', () => {
      // Flag never went on, _debugAxes is still null — disable must not throw
      // and must not allocate anything.
      expect(() => viewmodel.setDebugMode(false)).not.toThrow();

      let total = 0;
      viewmodel.group.traverse((obj) => {
        if (obj instanceof THREE.AxesHelper) total++;
      });
      expect(total).toBe(0);
      expect(viewmodel.debugMode).toBe(false);
    });
  });
});
