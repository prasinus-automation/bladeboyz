import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { ViewmodelRenderer, VIEWMODEL_LAYER } from './ViewmodelRenderer';

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

    it('weapon_attach bone is pre-rotated Math.PI * 0.85 on X', () => {
      const weaponAttach = viewmodel.bones['weapon_attach'];
      expect(weaponAttach.rotation.x).toBeCloseTo(Math.PI * 0.85);
    });

    it('root bone (upper_arm_R) is added to the group', () => {
      const upperArm = viewmodel.bones['upper_arm_R'];
      const boneInGroup = viewmodel.group.children.find(
        (c) => c instanceof THREE.Bone && c.name === 'vm_upper_arm_R',
      );
      expect(boneInGroup).toBe(upperArm);
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

      // With identity quaternion, offset should be applied directly
      // ARM_OFFSET = (0.25, -0.25, -0.4)
      expect(viewmodel.group.position.x).toBeCloseTo(0.25);
      expect(viewmodel.group.position.y).toBeCloseTo(-0.25);
      expect(viewmodel.group.position.z).toBeCloseTo(-0.4);
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
});
