import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { ViewmodelRenderer, VIEWMODEL_LAYER, getArmOffset } from './ViewmodelRenderer';

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
    it('copies world camera position and quaternion to viewmodel camera', () => {
      const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
      worldCamera.position.set(5, 10, 15);
      worldCamera.quaternion.setFromEuler(new THREE.Euler(0.5, 1.0, 0));

      viewmodel.syncWithCamera(worldCamera);

      expect(viewmodel.camera.position.x).toBe(5);
      expect(viewmodel.camera.position.y).toBe(10);
      expect(viewmodel.camera.position.z).toBe(15);
      expect(viewmodel.camera.quaternion.x).toBeCloseTo(worldCamera.quaternion.x);
      expect(viewmodel.camera.quaternion.y).toBeCloseTo(worldCamera.quaternion.y);
      expect(viewmodel.camera.quaternion.z).toBeCloseTo(worldCamera.quaternion.z);
      expect(viewmodel.camera.quaternion.w).toBeCloseTo(worldCamera.quaternion.w);
    });

    it('positions viewmodel group offset from camera', () => {
      const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
      worldCamera.position.set(0, 0, 0);
      worldCamera.quaternion.identity();

      viewmodel.syncWithCamera(worldCamera);

      // With identity quaternion, offset should be applied directly.
      // ARM_OFFSET = (0.25, -0.10, -0.4) — the group origin (= shoulder) sits
      // slightly below the camera so the arm hangs into the lower-right FOV.
      expect(viewmodel.group.position.x).toBeCloseTo(0.25);
      expect(viewmodel.group.position.y).toBeCloseTo(-0.1);
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

      viewmodel.syncWithCamera(worldCamera);

      expect(viewmodel.group.position.y).toBeLessThanOrEqual(0);
    });

    it('applies camera rotation to viewmodel group orientation', () => {
      const worldCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 1000);
      worldCamera.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));

      viewmodel.syncWithCamera(worldCamera);

      expect(viewmodel.group.quaternion.x).toBeCloseTo(worldCamera.quaternion.x);
      expect(viewmodel.group.quaternion.y).toBeCloseTo(worldCamera.quaternion.y);
      expect(viewmodel.group.quaternion.z).toBeCloseTo(worldCamera.quaternion.z);
      expect(viewmodel.group.quaternion.w).toBeCloseTo(worldCamera.quaternion.w);
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
