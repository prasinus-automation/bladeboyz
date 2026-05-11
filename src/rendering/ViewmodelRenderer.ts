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
 *           └── vm_weapon_attach  (grip rotation/offset applied per-weapon — see #125)
 *
 * Per-weapon grip data (#125, see `docs/viewmodel-architecture.md` §4):
 * Each `WeaponModelResult` may carry optional `gripOffset` / `gripRotation`
 * fields. On `swapWeapon(name)` the renderer copies those onto
 * `vm_weapon_attach.position` / `.rotation` so each weapon sits in the
 * hand at its own tuned angle. The legacy `Math.PI * 0.85` constant lives
 * in the longsword factory (its legacy value); other factories supply their
 * own values. Weapons with no grip data fall back to identity position
 * and the legacy longsword rotation, which is safer than baking the value
 * into the bone hierarchy.
 *
 * Pre-warmed model cache (#125, see doc §8): each registered factory is
 * called exactly once at construction; results are cached and re-parented
 * on swap. Zero-allocation weapon swaps after init.
 */

import * as THREE from 'three';
import {
  weaponModelFactories as defaultWeaponModelFactories,
  type WeaponModelFactory,
  type WeaponModelResult,
} from './WeaponModels';
import { ARM_OFFSET, AIM_SWAY_TAU_SECONDS } from './ViewmodelTuning';
import { updateBob, resetBob } from './ViewmodelBob';

/** Render layer index for viewmodel meshes */
export const VIEWMODEL_LAYER = 1;

/** Viewmodel camera settings */
const VIEWMODEL_FOV = 70;
const VIEWMODEL_NEAR = 0.01;
const VIEWMODEL_FAR = 5;

/**
 * Size of the per-bone AxesHelper added when `--debug-viewmodel` is enabled.
 * Small enough to inspect bone-local rotations without obscuring the arm.
 * (Issue #122 spec: 0.05; doc §10.2 mentions 0.08 but the issue is the
 * authoritative spec for this PR.)
 */
const DEBUG_AXES_SIZE = 0.05;

/** Names of the bones we attach AxesHelpers to in debug mode. Keys match
 * `ViewmodelRenderer.bones`. */
const DEBUG_BONE_NAMES = ['upper_arm_R', 'forearm_R', 'hand_R', 'weapon_attach'] as const;

/**
 * `ARM_OFFSET` lives in `./ViewmodelTuning` per doc §2.2 — every visual-tuning
 * knob lives in one place. The shoulder bone sits at the viewmodel group
 * origin; `ARM_OFFSET` is the camera-local offset applied each frame so the
 * shoulder ends up just below the eye line and the arm hangs into the lower
 * right of the viewport. Avoid raising `y` above 0 — that's the bug fixed in
 * #81 (upper-arm box clipped into the top of the viewport).
 */

/**
 * Default grip rotation applied when a weapon's `WeaponModelResult` does not
 * supply its own `gripRotation`. Matches the pre-#125 hardcoded value
 * (`Math.PI * 0.85` on X) so a freshly registered weapon factory without
 * grip data renders the same as a longsword would have rendered before.
 *
 * Mutable factories (tests) may register on the fly; per-frame use should
 * instead read from the active `WeaponModelResult` so the constant stays a
 * fallback only.
 */
const DEFAULT_GRIP_OFFSET = new THREE.Vector3(0, 0, 0);
const DEFAULT_GRIP_ROTATION = new THREE.Euler(Math.PI * 0.85, 0, 0);

/**
 * Read-only view of `ARM_OFFSET` for the debug overlay. Exposed so the overlay
 * can display the live offset without reaching into the renderer's internals.
 */
export function getArmOffset(): THREE.Vector3 {
  return ARM_OFFSET;
}

/** Pre-allocated vector for syncWithCamera (avoids per-frame allocation) */
const _worldOffset = new THREE.Vector3();

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

/**
 * Dispose of all geometries + materials underneath an Object3D, including
 * skinned meshes. Used by `dispose()` for the arm group AND for every cached
 * weapon `Group` (see §8.3 of the architecture doc).
 */
function disposeMeshes(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.SkinnedMesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
}

export interface ViewmodelRendererOptions {
  /** Initial weapon name to display. Defaults to 'Dagger'. */
  initialWeapon?: string;
  /**
   * Weapon model factory registry (name -> factory). When omitted, the
   * renderer falls back to the canonical `weaponModelFactories` registry
   * exported from `./WeaponModels` so `main.ts` does not need to inline the
   * factory list (see #125 cleanup). Tests pass their own fakes here.
   *
   * Each factory must obey the `WeaponModelFactory` contract — see its
   * JSDoc for the post-cache immutability requirement (#173).
   */
  weaponFactories?: Record<string, WeaponModelFactory>;
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

  /**
   * Reference to the *currently mounted* weapon group (child of weapon_attach
   * bone). It also lives in `weaponModelCache` — `swapWeapon` only re-parents,
   * never reallocates.
   */
  private weaponGroup: THREE.Group | null = null;

  /** Currently equipped weapon name (matches `weaponFactories` key). */
  private currentWeaponName: string | null = null;

  /** The weapon_attach bone — weapon models attach here */
  private weaponAttachBone: THREE.Bone;

  /**
   * Construction-time base position of `vm_weapon_attach` in `vm_hand_R`
   * local space. Stored so per-weapon `gripOffset` values are applied as
   * offsets RELATIVE to the natural hand-bottom anchor — not as absolute
   * replacements. This way weapon authors don't need to know `HAND_H`,
   * and a weapon with `gripOffset = (0, 0, 0)` renders at the same
   * position the pre-#125 hardcoded bone would have rendered at.
   */
  private weaponAttachBasePos: THREE.Vector3;

  /**
   * Pre-warmed cache of `WeaponModelResult` keyed by weapon name. Filled
   * once at construction by calling each registered factory; weapon swaps
   * after init re-parent the cached group rather than reallocating.
   * Disposed in `dispose()`.
   */
  private weaponModelCache: Map<string, WeaponModelResult> = new Map();

  /**
   * --debug-viewmodel state.
   *
   * Allocated lazily on first `setDebugMode(true)` so disabled mode pays
   * zero scene-graph cost. Keyed by canonical bone name (without `vm_`
   * prefix); values are AxesHelper children of the corresponding bone.
   */
  private _debugMode = false;
  private _debugAxes: Map<string, THREE.AxesHelper> | null = null;

  constructor(
    scene: THREE.Scene,
    aspect: number,
    options: ViewmodelRendererOptions = {},
  ) {
    const weaponFactories =
      options.weaponFactories ?? defaultWeaponModelFactories;

    // ── Create viewmodel camera ──
    this.camera = new THREE.PerspectiveCamera(
      VIEWMODEL_FOV,
      aspect,
      VIEWMODEL_NEAR,
      VIEWMODEL_FAR,
    );
    // Only render Layer 1
    this.camera.layers.set(VIEWMODEL_LAYER);

    // ── Viewmodel lighting ──
    //
    // The arena's lights are on Layer 0 (default), so the viewmodel
    // camera (Layer 1 only) doesn't see them. Anything using PBR
    // (MeshStandardMaterial — i.e. every weapon) renders solid black
    // without lights on its layer, while the arms (MeshBasicMaterial)
    // are unlit and so kept showing regardless. Add dedicated
    // viewmodel-only lights, layered to match the camera, so PBR weapons
    // get diffuse + ambient contribution in Pass 2 without bleeding
    // into the world pass.
    //
    // An AmbientLight gives a guaranteed flat color contribution that
    // doesn't depend on geometry direction (so the weapon is visible
    // regardless of grip rotation). A DirectionalLight on top adds
    // shape-revealing highlights — its `.target` MUST be added to the
    // scene (Three.js gotcha — without it the target.matrixWorld doesn't
    // update and the light direction silently breaks).
    const vmAmbient = new THREE.AmbientLight(0xffffff, 0.8);
    vmAmbient.layers.set(VIEWMODEL_LAYER);
    scene.add(vmAmbient);

    const vmKey = new THREE.DirectionalLight(0xfff5e0, 0.7);
    vmKey.position.set(0.5, 1, 0.5);
    vmKey.target.position.set(0, 0, 0);
    vmKey.layers.set(VIEWMODEL_LAYER);
    vmKey.target.layers.set(VIEWMODEL_LAYER);
    scene.add(vmKey);
    scene.add(vmKey.target);

    // ── Build bone hierarchy ──
    this.group = new THREE.Group();
    this.group.name = 'viewmodel_root';

    const skinMat = new THREE.MeshBasicMaterial({ color: SKIN_COLOR });

    // Bone chain: upper_arm_R -> forearm_R -> hand_R -> weapon_attach
    //
    // Anchoring convention (see #81):
    //   The shoulder (root bone) is positioned at the group origin (0, 0, 0).
    //   The entire visible arm hangs *below* the origin via negative-Y child
    //   offsets (forearm at -UPPER_ARM_H, hand at -FOREARM_H from forearm,
    //   weapon_attach at -HAND_H from hand).
    //
    //   Because the group origin is itself placed slightly below the camera
    //   (ARM_OFFSET.y = -0.10), the shoulder ends up at-or-below the camera
    //   eye line and the arm enters the screen from the lower-right corner.
    //   The previous convention put the shoulder ABOVE the origin, which
    //   pushed upper-arm geometry into the top of the viewport.
    const upperArmBone = new THREE.Bone();
    upperArmBone.name = 'vm_upper_arm_R';
    upperArmBone.position.set(0, 0, 0);

    const forearmBone = new THREE.Bone();
    forearmBone.name = 'vm_forearm_R';
    forearmBone.position.set(0, -UPPER_ARM_H, 0);
    upperArmBone.add(forearmBone);

    const handBone = new THREE.Bone();
    handBone.name = 'vm_hand_R';
    handBone.position.set(0, -FOREARM_H, 0);
    forearmBone.add(handBone);

    // weapon_attach bone — the per-weapon grip data is applied here on swap.
    //
    // Position: bone is anchored at the bottom of the hand (`-HAND_H` below
    //   the hand pivot). Per-weapon `gripOffset` is ADDED to this base in
    //   `swapWeapon()`, not replacing it. The base persists across swaps so
    //   weapons with `gripOffset = (0, 0, 0)` render at the natural hand
    //   anchor (preserving pre-#125 behavior 1:1 for the longsword).
    //
    // Rotation: NO hardcoded rotation at construction (#125). A fresh
    //   renderer with no weapon equipped sits at rotation identity. The
    //   first `swapWeapon()` copies the active weapon's `gripRotation`
    //   (or the legacy fallback) onto the bone.
    const weaponAttachBone = new THREE.Bone();
    weaponAttachBone.name = 'vm_weapon_attach';
    weaponAttachBone.position.set(0, -HAND_H, 0);
    handBone.add(weaponAttachBone);

    this.weaponAttachBone = weaponAttachBone;
    this.weaponAttachBasePos = weaponAttachBone.position.clone();

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

    // Set all viewmodel meshes (arm + bones) to Layer 1.
    // Cached weapon models below have their layers set per-entry, since
    // `setLayerRecursive` traverses children — we want each cached group's
    // own meshes layered, NOT just the live-attached one.
    setLayerRecursive(this.group, VIEWMODEL_LAYER);

    // ── Pre-warm weapon model cache (#125, doc §8.1) ──
    //
    // Call each registered factory exactly once and stash the result. Layer 1
    // is set at cache time, not per-swap, so swap is allocation-free.
    // Materials/geometries live until dispose() — with 4 weapons of ~5 KB
    // geometry each the memory cost is negligible.
    for (const [name, factory] of Object.entries(weaponFactories)) {
      const result = factory();
      result.group.name = `viewmodel_weapon_${name}`;
      setLayerRecursive(result.group, VIEWMODEL_LAYER);
      this.weaponModelCache.set(name, result);
    }

    // Add to scene (viewmodel camera will see it; world camera won't)
    scene.add(this.group);

    // Attach initial weapon if it's in the cache
    const initialWeaponName = options.initialWeapon ?? 'Dagger';
    if (this.weaponModelCache.has(initialWeaponName)) {
      this.swapWeapon(initialWeaponName);
    }
  }

  /**
   * Get the currently equipped weapon name, or null if none.
   *
   * Used by the `--debug-viewmodel` overlay to label the current weapon —
   * exposed as a getter rather than reading `weaponFactories` because the
   * FSM-tracked `weaponId` and the renderer's currently-attached model are
   * the same value but maintained on different paths (combat ECS vs.
   * `swapWeapon` calls), and the overlay wants the renderer's reality.
   */
  getCurrentWeaponName(): string | null {
    return this.currentWeaponName;
  }

  /**
   * Toggle the `--debug-viewmodel` diagnostic mode.
   *
   * When enabled:
   *   - One `THREE.AxesHelper(DEBUG_AXES_SIZE)` is parented to each bone
   *     listed in `DEBUG_BONE_NAMES` (created lazily on first call).
   *   - Helpers are set to Layer 1 so they render in the viewmodel pass.
   *
   * When disabled:
   *   - Helpers' `.visible` is set to false. They remain in the scene graph
   *     so re-enabling is allocation-free, but they are not drawn.
   *
   * Zero-cost when never enabled: `_debugAxes` stays null, no AxesHelpers
   * are constructed, and per-frame code paths can early-out via `_debugMode`.
   *
   * @param enabled true to show axes, false to hide
   */
  setDebugMode(enabled: boolean): void {
    this._debugMode = enabled;

    if (enabled) {
      // Lazy-allocate on first enable.
      if (this._debugAxes === null) {
        this._debugAxes = new Map();
        for (const boneName of DEBUG_BONE_NAMES) {
          const bone = this.bones[boneName];
          if (!bone) continue;
          const helper = new THREE.AxesHelper(DEBUG_AXES_SIZE);
          // Set the helper itself + any descendants (lines) to Layer 1 so
          // the viewmodel camera renders them. AxesHelper extends LineSegments
          // and has no children today, but setLayerRecursive is defensive.
          setLayerRecursive(helper, VIEWMODEL_LAYER);
          bone.add(helper);
          this._debugAxes.set(boneName, helper);
        }
      }
      // Show all helpers.
      for (const helper of this._debugAxes.values()) {
        helper.visible = true;
      }
    } else if (this._debugAxes !== null) {
      // Disable existing helpers (keep them in the graph for cheap re-enable).
      for (const helper of this._debugAxes.values()) {
        helper.visible = false;
      }
    }
  }

  /** Returns whether `--debug-viewmodel` is currently enabled. */
  get debugMode(): boolean {
    return this._debugMode;
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
   *
   * Detaches the previously mounted weapon (without disposing — the cached
   * group stays alive for re-equip), looks up the new weapon's cached
   * `WeaponModelResult`, applies its grip offset / rotation to the
   * `weapon_attach` bone (or the legacy fallback when grip data is missing),
   * and re-parents the cached group. Zero allocations after init.
   *
   * Returns false if the weapon name is not in the cache (e.g. a typo or a
   * weapon registered after construction). Logs a warning.
   */
  swapWeapon(weaponName: string): boolean {
    const cached = this.weaponModelCache.get(weaponName);
    if (!cached) {
      console.warn(
        `ViewmodelRenderer.swapWeapon: no cached model for "${weaponName}"`,
      );
      return false;
    }

    // Detach current weapon (do NOT dispose — it stays in the cache)
    if (this.weaponGroup) {
      this.weaponAttachBone.remove(this.weaponGroup);
      this.weaponGroup = null;
    }

    // Apply per-weapon grip (#125, doc §4.2 — additive position, replacement
    // rotation):
    //
    // Position is **additive** from the construction-time hand-bottom anchor.
    //   Weapons that omit gripOffset render at the natural anchor; weapons
    //   that supply one shift relative to it. This keeps weapon authors out
    //   of the HAND_H baseline and makes the doc's "preserves current
    //   behavior" promise for the longsword (gripOffset (0,0,0)) literally
    //   true — pre-#125 the bone sat at (0, -HAND_H, 0); post-#125 with
    //   default offset it still sits at (0, -HAND_H, 0).
    //
    // Rotation is **replacement** — the bone has no construction rotation
    //   post-#125. The fallback `DEFAULT_GRIP_ROTATION` matches the pre-#125
    //   hardcoded `Math.PI * 0.85` so a freshly registered factory without
    //   grip data renders identically to a longsword.
    this.weaponAttachBone.position.copy(this.weaponAttachBasePos);
    if (cached.gripOffset) {
      this.weaponAttachBone.position.add(cached.gripOffset);
    } else {
      this.weaponAttachBone.position.add(DEFAULT_GRIP_OFFSET);
    }
    this.weaponAttachBone.rotation.copy(
      cached.gripRotation ?? DEFAULT_GRIP_ROTATION,
    );

    // Attach cached group as child of weapon_attach
    this.weaponAttachBone.add(cached.group);
    this.weaponGroup = cached.group;
    // Track the renderer's reality (used by the --debug-viewmodel overlay
    // via getCurrentWeaponName(), not from FSM weaponId — see #161).
    this.currentWeaponName = weaponName;

    // Defensive layer-leak guard (#173):
    //
    // Layer 1 is set at cache-warm time, so a well-behaved factory needs
    // no further help. But factories are user-extensible — if any
    // `WeaponModelFactory` ever mutates its returned Group post-cache
    // (adds runtime children, swaps materials, etc.), those new children
    // would inherit Layer 0 and render through world geometry (z-fight
    // with everything, pierced by walls). Re-applying the layer on every
    // swap is one cheap traverse per swap (swaps are rare — equipping a
    // new weapon, not per-frame) and closes the latent hazard without
    // changing observable behavior for any factory that obeys the
    // post-cache-immutability contract documented on `WeaponModelFactory`.
    setLayerRecursive(cached.group, VIEWMODEL_LAYER);

    return true;
  }

  /**
   * Sync viewmodel position + rotation with the world camera, applying:
   *   1. Aim-sway lag (rotational low-pass, doc §7) — the viewmodel quaternion
   *      slerps toward the camera quaternion with `alpha = 1 - exp(-dt / TAU)`,
   *      so fast aim flicks lag slightly and feel weighty.
   *   2. Locomotion bob (doc §6) — `{dx, dy}` from `ViewmodelBob` is added to
   *      `ARM_OFFSET` in camera-local space BEFORE the camera quaternion is
   *      applied (so the bob plays out in the player's frame of reference).
   *
   * Position is **always snapped exactly** to `cameraPosition + offset`. We do
   * NOT lag position — that would cause forward-and-back drift when the player
   * moves (the camera moves first, the arm catches up; eye reads as
   * seasickness, not weight). Locomotion bob is the correct vehicle for
   * positional motion.
   *
   * Both the viewmodel CAMERA's quaternion and the GROUP's quaternion are
   * lagged in lockstep — without that, snapping the camera but lagging the
   * group would cause the arm to swim in screen space.
   *
   * Called every render frame. Frame-rate-independent (the slerp blend factor
   * uses `1 - exp(-dt / TAU)`, so the perceived lag is identical at 30 Hz vs
   * 144 Hz).
   *
   * @param worldCamera The world camera to sync from (read-only).
   * @param dt          Frame delta in seconds.
   * @param velX        Player's world-space X velocity (m/s). For the bob.
   * @param velZ        Player's world-space Z velocity (m/s). For the bob.
   */
  syncWithCamera(
    worldCamera: THREE.PerspectiveCamera,
    dt: number,
    velX: number,
    velZ: number,
  ): void {
    // ── 1. Position (always snapped exactly) ──
    // Copy camera position to the viewmodel camera (no positional lag — see
    // doc §7.3 for why position must NOT be lagged).
    this.camera.position.copy(worldCamera.position);

    // Add bob to ARM_OFFSET in camera-local space, then rotate into world
    // space using the WORLD camera quaternion (not the lagged viewmodel
    // quaternion). The bob is meant to ride on top of the actual aim — using
    // the lagged quat here would couple the bob to the lag and feel mushy.
    const bob = updateBob(dt, velX, velZ);
    _worldOffset.set(
      ARM_OFFSET.x + bob.dx,
      ARM_OFFSET.y + bob.dy,
      ARM_OFFSET.z,
    );
    _worldOffset.applyQuaternion(worldCamera.quaternion);
    this.group.position.copy(worldCamera.position).add(_worldOffset);

    // ── 2. Rotation (lagged via slerp, doc §7) ──
    // alpha = 1 - exp(-dt/TAU). At dt=TAU, alpha ≈ 0.63 (one time constant).
    // Sub-millisecond dt yields a ~zero alpha (no rotation change).
    const alpha = dt > 0 ? 1 - Math.exp(-dt / AIM_SWAY_TAU_SECONDS) : 0;
    this.group.quaternion.slerp(worldCamera.quaternion, alpha);
    // Slerp the viewmodel CAMERA in lockstep with the group — without this,
    // snapping the camera but lagging the group makes the arm swim in screen
    // space (the camera frame moves under the arm).
    this.camera.quaternion.slerp(worldCamera.quaternion, alpha);
  }

  /**
   * Hard-copy the world camera quaternion onto the viewmodel group + viewmodel
   * camera, bypassing the aim-sway lag for one frame. Use after large camera
   * teleports (respawn, dev console teleport) so the viewmodel doesn't visibly
   * catch up over ~5 frames after the jump.
   *
   * Also resets the locomotion bob accumulator so a respawn doesn't carry over
   * a stale stride from the previous life.
   *
   * @param worldCamera The world camera whose orientation to snap to.
   */
  snap(worldCamera: THREE.PerspectiveCamera): void {
    this.camera.position.copy(worldCamera.position);
    this.camera.quaternion.copy(worldCamera.quaternion);
    this.group.quaternion.copy(worldCamera.quaternion);
    // Position is recomputed via ARM_OFFSET so the snap state is self-
    // consistent without bob (bob is reset to zero).
    _worldOffset.copy(ARM_OFFSET).applyQuaternion(worldCamera.quaternion);
    this.group.position.copy(worldCamera.position).add(_worldOffset);
    resetBob();
  }

  /**
   * Update the viewmodel camera aspect ratio (call on window resize).
   */
  updateAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Dispose of all viewmodel resources, including every cached weapon model.
   * After dispose, the renderer is unusable — construct a fresh one to
   * resume.
   */
  dispose(): void {
    this.group.parent?.remove(this.group);

    // Arm meshes + the currently mounted weapon (which is also in the cache,
    // but the traverse handles double-disposal safely as long as we don't
    // re-enter it below — Three.js disposers are idempotent for a single
    // call, but cheap to skip).
    disposeMeshes(this.group);

    // Cached weapon groups that aren't currently mounted. The currently
    // mounted weapon is a child of weapon_attach, which is a child of the
    // group, so it was already disposed by the traversal above. Skip it.
    for (const [, result] of this.weaponModelCache) {
      if (result.group === this.weaponGroup) continue;
      disposeMeshes(result.group);
    }
    this.weaponModelCache.clear();
    this.weaponGroup = null;
  }
}
