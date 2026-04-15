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

  /** Whether the viewmodel is currently visible (FPS mode) */
  private _visible = true;

  /** Reference to the current weapon group (child of hand) */
  private weaponGroup: THREE.Group | null = null;

  /** Hand mesh group (weapon attaches here) */
  private handGroup: THREE.Group;

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

    // ── Build arm meshes ──
    this.group = new THREE.Group();
    this.group.name = 'viewmodel_root';

    const skinMat = new THREE.MeshBasicMaterial({ color: SKIN_COLOR });

    // Forearm
    const forearm = new THREE.Mesh(
      new THREE.BoxGeometry(FOREARM_W, FOREARM_H, FOREARM_D),
      skinMat,
    );
    forearm.name = 'viewmodel_forearm';
    forearm.position.set(0, 0, 0);
    this.group.add(forearm);

    // Hand (positioned at the end of forearm)
    this.handGroup = new THREE.Group();
    this.handGroup.name = 'viewmodel_hand';
    this.handGroup.position.set(0, -FOREARM_H / 2 - HAND_H / 2, 0);

    const handMesh = new THREE.Mesh(
      new THREE.BoxGeometry(HAND_W, HAND_H, HAND_D),
      skinMat,
    );
    handMesh.name = 'viewmodel_hand_mesh';
    this.handGroup.add(handMesh);
    this.group.add(this.handGroup);

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
   */
  swapWeapon(weaponName: string): boolean {
    const factory = this.weaponFactories[weaponName];
    if (!factory) {
      console.warn(`ViewmodelRenderer.swapWeapon: no factory for "${weaponName}"`);
      return false;
    }

    // Remove old weapon
    if (this.weaponGroup) {
      this.handGroup.remove(this.weaponGroup);
      this.weaponGroup = null;
    }

    // Create new weapon from factory (separate instance from world model)
    const { group: newWeapon } = factory();
    newWeapon.name = `viewmodel_weapon_${weaponName}`;

    // Position weapon extending from hand
    newWeapon.position.set(0, -HAND_H / 2, 0);
    // Flip weapon to point outward (same as weapon_attach bone rotation)
    newWeapon.rotation.x = Math.PI;

    // Set layer on all weapon meshes
    setLayerRecursive(newWeapon, VIEWMODEL_LAYER);

    this.handGroup.add(newWeapon);
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
