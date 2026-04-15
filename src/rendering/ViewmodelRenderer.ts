/**
 * ViewmodelRenderer — first-person arms and weapon rendering.
 *
 * Uses Three.js render layers to separate viewmodel from world geometry:
 * - Layer 0 (default): World scene
 * - Layer 1: Viewmodel (first-person arms + weapon)
 *
 * A separate PerspectiveCamera (viewmodelCamera) renders only Layer 1
 * with a lower FOV and near clip for the classic "weapon feels close" effect.
 * The world camera renders Layer 0 as usual. Each frame:
 *   1. Render world scene (Layer 0) with world camera
 *   2. Clear depth only, render viewmodel (Layer 1) with viewmodel camera
 * This ensures the viewmodel always renders on top of world geometry.
 *
 * The arm is built from a THREE.Bone hierarchy with SkinnedMesh parts,
 * enabling bone-driven pose animation.
 *
 * Bone hierarchy:
 *   vm_upper_arm_R
 *   └── vm_forearm_R
 *       └── vm_hand_R
 *           └── vm_weapon_attach  (pre-rotated Math.PI on X)
 */

import * as THREE from 'three';

/** Render layer index for viewmodel meshes */
export const VIEWMODEL_LAYER = 1;

/** Viewmodel camera settings */
const VIEWMODEL_FOV = 70;
const VIEWMODEL_NEAR = 0.01;
const VIEWMODEL_FAR = 5;

/** Arm offset from camera in camera-local space (lower-right of view) */
const ARM_OFFSET = new THREE.Vector3(0.3, -0.3, -0.5);

/** Arm proportions */
const UPPER_ARM_W = 0.12;
const UPPER_ARM_H = 0.28;
const UPPER_ARM_D = 0.12;
const FOREARM_W = 0.12;
const FOREARM_H = 0.35;
const FOREARM_D = 0.12;
const HAND_W = 0.1;
const HAND_H = 0.12;
const HAND_D = 0.1;

/** Skin color matching the character model */
const SKIN_COLOR = 0xf5cba7;

/**
 * Set all meshes in a hierarchy to a specific render layer.
 * Must be called recursively on every child — layers.set() only affects the object itself.
 */
function setLayerRecursive(object: THREE.Object3D, layer: number): void {
  object.layers.set(layer);
  for (const child of object.children) {
    setLayerRecursive(child, layer);
  }
}

export interface ViewmodelRendererOptions {
  /** Initial weapon name to display. Defaults to 'Dagger'. */
  initialWeapon?: string;
  /** Weapon model factory registry (name -> factory function). */
  weaponFactories?: Record<string, () => { group: THREE.Group }>;
}

export class ViewmodelRenderer {
  /** The viewmodel camera — renders Layer 1 only */
  public readonly camera: THREE.PerspectiveCamera;

  /** Root group containing arm + weapon, added to scene on Layer 1 */
  public readonly group: THREE.Group;

  /**
   * Exposed bone references keyed by canonical name (without vm_ prefix).
   * Keys: 'upper_arm_R', 'forearm_R', 'hand_R', 'weapon_attach'
   * Animation systems can use these directly — names match AnimationData.ts.
   */
  public readonly bones: Record<string, THREE.Bone>;

  /** Whether the viewmodel is currently visible (FPS mode) */
  private _visible = true;

  /** Reference to the current weapon group (child of weapon_attach bone) */
  private weaponGroup: THREE.Group | null = null;

  /** The weapon_attach bone — weapon models attach here */
  private weaponAttachBone: THREE.Bone;

  /** Weapon factory registry */
  private weaponFactories: Record<string, () => { group: THREE.Group }>;

  constructor(
    scene: THREE.Scene,
    aspect: number,
    options: ViewmodelRendererOptions = {},
  ) {
    this.weaponFactories = options.weaponFactories ?? {};

    // ── Create viewmodel camera ──
    this.camera = new THREE.PerspectiveCamera(
      VIEWMODEL_FOV,
      aspect,
      VIEWMODEL_NEAR,
      VIEWMODEL_FAR,
    );
    // Only render Layer 1
    this.camera.layers.set(VIEWMODEL_LAYER);

    // ── Build bone hierarchy ──
    this.group = new THREE.Group();
    this.group.name = 'viewmodel_root';

    const skinMat = new THREE.MeshBasicMaterial({ color: SKIN_COLOR });

    // Bone chain: upper_arm_R -> forearm_R -> hand_R -> weapon_attach
    // Root bone is positioned so forearm mesh center remains at (0, 0, 0)
    // in group space, preserving the original arm visual placement.
    const upperArmBone = new THREE.Bone();
    upperArmBone.name = 'vm_upper_arm_R';
    upperArmBone.position.set(0, UPPER_ARM_H + FOREARM_H / 2, 0);

    const forearmBone = new THREE.Bone();
    forearmBone.name = 'vm_forearm_R';
    forearmBone.position.set(0, -UPPER_ARM_H, 0);
    upperArmBone.add(forearmBone);

    const handBone = new THREE.Bone();
    handBone.name = 'vm_hand_R';
    handBone.position.set(0, -FOREARM_H, 0);
    forearmBone.add(handBone);

    const weaponAttachBone = new THREE.Bone();
    weaponAttachBone.name = 'vm_weapon_attach';
    weaponAttachBone.position.set(0, -HAND_H, 0);
    weaponAttachBone.rotation.x = Math.PI; // Flip +Y to point outward from hand
    handBone.add(weaponAttachBone);

    this.weaponAttachBone = weaponAttachBone;

    // Expose bones without vm_ prefix (matches AnimationData.ts bone names)
    this.bones = {
      upper_arm_R: upperArmBone,
      forearm_R: forearmBone,
      hand_R: handBone,
      weapon_attach: weaponAttachBone,
    };

    // ── Create skeleton ──
    const boneArray = [upperArmBone, forearmBone, handBone, weaponAttachBone];
    const skeleton = new THREE.Skeleton(boneArray);

    // Helper: create a SkinnedMesh bound 100% to a single bone
    // (same pattern as CharacterModel.ts createPart)
    const createPart = (
      geom: THREE.BufferGeometry,
      material: THREE.Material,
      bone: THREE.Bone,
      offset: THREE.Vector3,
    ): THREE.SkinnedMesh => {
      const mesh = new THREE.SkinnedMesh(geom, material);

      // Skinning: every vertex weighted 100% to this one bone
      const posAttr = geom.getAttribute('position');
      const count = posAttr.count;
      const boneIndex = boneArray.indexOf(bone);
      const skinIndices: number[] = [];
      const skinWeights: number[] = [];
      for (let i = 0; i < count; i++) {
        skinIndices.push(boneIndex, 0, 0, 0);
        skinWeights.push(1, 0, 0, 0);
      }
      geom.setAttribute(
        'skinIndex',
        new THREE.Uint16BufferAttribute(skinIndices, 4),
      );
      geom.setAttribute(
        'skinWeight',
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );

      // Translate geometry so bone is the pivot
      geom.translate(offset.x, offset.y, offset.z);

      // Need a root bone in the mesh for skeleton binding
      mesh.add(upperArmBone.clone(false));
      mesh.bind(skeleton);

      return mesh;
    };

    // ── Create skinned mesh parts ──

    // Upper arm
    const upperArmMesh = createPart(
      new THREE.BoxGeometry(UPPER_ARM_W, UPPER_ARM_H, UPPER_ARM_D),
      skinMat,
      upperArmBone,
      new THREE.Vector3(0, -UPPER_ARM_H / 2, 0),
    );
    upperArmMesh.name = 'viewmodel_upper_arm';
    this.group.add(upperArmMesh);

    // Forearm
    const forearmMesh = createPart(
      new THREE.BoxGeometry(FOREARM_W, FOREARM_H, FOREARM_D),
      skinMat,
      forearmBone,
      new THREE.Vector3(0, -FOREARM_H / 2, 0),
    );
    forearmMesh.name = 'viewmodel_forearm';
    this.group.add(forearmMesh);

    // Hand
    const handMesh = createPart(
      new THREE.BoxGeometry(HAND_W, HAND_H, HAND_D),
      skinMat,
      handBone,
      new THREE.Vector3(0, -HAND_H / 2, 0),
    );
    handMesh.name = 'viewmodel_hand';
    this.group.add(handMesh);

    // Add root bone to group so skeleton transforms propagate
    this.group.add(upperArmBone);

    // Set all viewmodel meshes to Layer 1
    setLayerRecursive(this.group, VIEWMODEL_LAYER);

    // Add to scene (viewmodel camera will see it; world camera won't)
    scene.add(this.group);

    // Attach initial weapon if specified
    const initialWeaponName = options.initialWeapon ?? 'Dagger';
    if (this.weaponFactories[initialWeaponName]) {
      this.swapWeapon(initialWeaponName);
    }
  }

  /** Get current visibility */
  get visible(): boolean {
    return this._visible;
  }

  /** Show or hide the viewmodel */
  set visible(value: boolean) {
    this._visible = value;
    this.group.visible = value;
  }

  /**
   * Swap the weapon model on the viewmodel.
   * Removes the old weapon, creates a new one from the factory, and sets layers.
   * Weapon is attached to the weapon_attach bone.
   */
  swapWeapon(weaponName: string): boolean {
    const factory = this.weaponFactories[weaponName];
    if (!factory) {
      console.warn(`ViewmodelRenderer.swapWeapon: no factory for "${weaponName}"`);
      return false;
    }

    // Remove old weapon
    if (this.weaponGroup) {
      this.weaponAttachBone.remove(this.weaponGroup);
      this.weaponGroup = null;
    }

    // Create new weapon from factory (separate instance from world model)
    const { group: newWeapon } = factory();
    newWeapon.name = `viewmodel_weapon_${weaponName}`;

    // No position/rotation needed — weapon_attach bone provides both
    // (bone is pre-positioned at hand bottom, pre-rotated Math.PI on X)

    // Set layer on all weapon meshes
    setLayerRecursive(newWeapon, VIEWMODEL_LAYER);

    this.weaponAttachBone.add(newWeapon);
    this.weaponGroup = newWeapon;

    return true;
  }

  /**
   * Sync viewmodel position with the world camera.
   * Called each frame during render(). Copies camera position/quaternion
   * and offsets the arm group in camera-local space.
   */
  syncWithCamera(worldCamera: THREE.PerspectiveCamera): void {
    // Copy world camera transform to viewmodel camera
    this.camera.position.copy(worldCamera.position);
    this.camera.quaternion.copy(worldCamera.quaternion);

    // Position arm group relative to camera using camera-local offset
    // Convert ARM_OFFSET from camera-local space to world space
    const worldOffset = ARM_OFFSET.clone().applyQuaternion(worldCamera.quaternion);
    this.group.position.copy(worldCamera.position).add(worldOffset);
    this.group.quaternion.copy(worldCamera.quaternion);
  }

  /**
   * Update the viewmodel camera aspect ratio (call on window resize).
   */
  updateAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Dispose of all viewmodel resources.
   */
  dispose(): void {
    this.group.parent?.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
}
