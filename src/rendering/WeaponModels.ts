import * as THREE from 'three';
import { createLongswordModel, type WeaponModelResult } from './CharacterModel';

export type { WeaponModelResult } from './CharacterModel';

// ── Mace Model ──────────────────────────────────────────────

/**
 * Create a procedural mace model.
 * Cylinder handle + sphere head.
 */
export function createMaceModel(): WeaponModelResult {
  const group = new THREE.Group();

  const handleMat = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    flatShading: true,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x777777,
    flatShading: true,
  });

  // Handle (cylinder)
  const HANDLE_RADIUS = 0.025;
  const HANDLE_LEN = 0.4;
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(HANDLE_RADIUS, HANDLE_RADIUS, HANDLE_LEN, 6),
    handleMat,
  );
  handle.position.set(0, HANDLE_LEN / 2, 0);
  group.add(handle);

  // Mace head (sphere)
  const HEAD_RADIUS = 0.08;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(HEAD_RADIUS, 6, 4),
    headMat,
  );
  head.position.set(0, HANDLE_LEN + HEAD_RADIUS, 0);
  group.add(head);

  // Tracer points on the head (3 points: bottom, center, top)
  const tracerPoints: THREE.Vector3[] = [
    new THREE.Vector3(0, HANDLE_LEN, 0),                        // bottom of head
    new THREE.Vector3(0, HANDLE_LEN + HEAD_RADIUS, 0),          // center of head
    new THREE.Vector3(0, HANDLE_LEN + HEAD_RADIUS * 2, 0),      // top of head
  ];

  // Viewmodel grip data (#125, doc §4.3). Head angled up-forward to
  // emphasize the heavy mace head; small Z-axis lean reads as off-axis grip.
  const gripOffset = new THREE.Vector3(0, 0, 0);
  const gripRotation = new THREE.Euler(Math.PI * 0.75, 0, -0.15);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Dagger Model ────────────────────────────────────────────

/**
 * Create a procedural dagger model.
 * Small grip + short blade.
 */
export function createDaggerModel(): WeaponModelResult {
  const group = new THREE.Group();

  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x654321,
    flatShading: true,
  });
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xbbbbbb,
    flatShading: true,
  });

  // Grip (cylinder)
  const GRIP_RADIUS = 0.018;
  const GRIP_LEN = 0.1;
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, GRIP_LEN, 6),
    gripMat,
  );
  grip.position.set(0, GRIP_LEN / 2, 0);
  group.add(grip);

  // Blade (short, narrow box)
  const BLADE_W = 0.03;
  const BLADE_H = 0.2;
  const BLADE_D = 0.01;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(BLADE_W, BLADE_H, BLADE_D),
    bladeMat,
  );
  blade.position.set(0, GRIP_LEN + BLADE_H / 2, 0);
  group.add(blade);

  // Tracer points along the blade (2 points: base and tip)
  const tracerPoints: THREE.Vector3[] = [
    new THREE.Vector3(0, GRIP_LEN + 0.03, 0),           // blade base
    new THREE.Vector3(0, GRIP_LEN + BLADE_H - 0.02, 0), // blade tip
  ];

  // Viewmodel grip data (#125, doc §4.3). Tighter grip pulled slightly
  // toward the camera (Z negative), blade tilted further forward — sells
  // the small/quick feel. A reverse-grip variant could rotate ~π on Z.
  const gripOffset = new THREE.Vector3(0, 0, -0.02);
  const gripRotation = new THREE.Euler(Math.PI * 0.9, 0, 0);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Battleaxe Model ─────────────────────────────────────────

/**
 * Create a procedural battleaxe model.
 * Long cylinder handle + large box axe head.
 */
export function createBattleaxeModel(): WeaponModelResult {
  const group = new THREE.Group();

  const handleMat = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    flatShading: true,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x555555,
    flatShading: true,
  });

  // Long handle (cylinder)
  const HANDLE_RADIUS = 0.025;
  const HANDLE_LEN = 0.8;
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(HANDLE_RADIUS, HANDLE_RADIUS, HANDLE_LEN, 6),
    handleMat,
  );
  handle.position.set(0, HANDLE_LEN / 2, 0);
  group.add(handle);

  // Axe head (wide, flat box offset to one side)
  const HEAD_W = 0.25;
  const HEAD_H = 0.3;
  const HEAD_D = 0.04;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(HEAD_W, HEAD_H, HEAD_D),
    headMat,
  );
  head.position.set(HEAD_W / 2 - 0.02, HANDLE_LEN + HEAD_H / 2 - 0.05, 0);
  group.add(head);

  // Tracer points on the axe head (4 points, evenly spaced base to top)
  const headBase = HANDLE_LEN - 0.05;
  const tracerPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3; // 0, 1/3, 2/3, 1
    tracerPoints.push(new THREE.Vector3(0, headBase + t * HEAD_H, 0));
  }

  // Viewmodel grip data (#125, doc §4.3). Head heavy + angled
  // down-sideways — Y-offset pulls the model down toward the hand bottom
  // (long handle), small +Z rotation tilts the head. Sells the weight.
  const gripOffset = new THREE.Vector3(0, -0.05, 0);
  const gripRotation = new THREE.Euler(Math.PI * 0.8, 0, 0.1);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Weapon Model Factory Registry ───────────────────────────

/**
 * Registry mapping weapon names to their procedural model factories.
 * Used by entity creation to attach the correct model for each weapon.
 */
export const weaponModelFactories: Record<string, () => WeaponModelResult> = {
  'Longsword': createLongswordModel,
  'Mace': createMaceModel,
  'Dagger': createDaggerModel,
  'Battleaxe': createBattleaxeModel,
};

// ── Ground Pickup Model ─────────────────────────────────────

/**
 * Per-weapon "lying flat" orientation tweaks used by `createGroundPickupModel`.
 *
 * Default rotation is `x = -π/2` — rotates the upright weapon (long axis = +Y)
 * onto its side so the long axis points along world +Z and the flat side
 * faces the ground. Some weapons add an extra roll for visual readability:
 *
 * - **Longsword / Dagger / Mace**: blade/handle lies naturally on `-π/2 X`.
 *   (Mace _could_ take a small Z roll to keep the head from sitting awkwardly,
 *   but the spherical head is rotation-symmetric enough that the simple
 *   default reads fine — see architect note in PR #127.)
 * - **Battleaxe**: asymmetric (axe head offset to one side of the haft) —
 *   add `z = π/4` so the head rolls down and the axe lies on its broad
 *   face rather than balancing on the haft edge.
 */
const PICKUP_ORIENTATIONS: Record<string, { x: number; y: number; z: number }> = {
  'Longsword': { x: -Math.PI / 2, y: 0, z: 0 },
  'Mace':      { x: -Math.PI / 2, y: 0, z: 0 },
  'Dagger':    { x: -Math.PI / 2, y: 0, z: 0 },
  'Battleaxe': { x: -Math.PI / 2, y: 0, z: Math.PI / 4 },
};

const DEFAULT_PICKUP_ORIENTATION = { x: -Math.PI / 2, y: 0, z: 0 };

/**
 * Build the ground-pickup mesh for a weapon.
 *
 * Calls `weaponModelFactories[weaponName]()`, applies a per-weapon "lying flat"
 * rotation, and walks the group to collect a unique `THREE.Material[]` for
 * the rendering layer to use during blink/fade in the last 5s of life
 * (see `PickupRenderer`).
 *
 * **Material handling**: each factory in this module allocates fresh
 * `MeshStandardMaterial` instances per call, so opacity changes on one
 * pickup never leak across pickups. We also flip `material.transparent = true`
 * on every collected material here at creation time (idempotent — sticky for
 * the pickup's whole life). `PickupRenderer` only mutates `material.opacity`
 * thereafter, never `transparent`, per the renderer-state guidance in #127.
 *
 * Throws on unknown weapon name (no factory in `weaponModelFactories`).
 */
export function createGroundPickupModel(weaponName: string): {
  group: THREE.Group;
  materials: THREE.Material[];
} {
  const factory = weaponModelFactories[weaponName];
  if (!factory) {
    throw new Error(
      `createGroundPickupModel: unknown weapon "${weaponName}" — not in weaponModelFactories`,
    );
  }
  const { group } = factory();

  const orientation = PICKUP_ORIENTATIONS[weaponName] ?? DEFAULT_PICKUP_ORIENTATION;
  group.rotation.set(orientation.x, orientation.y, orientation.z);

  // Collect unique materials. Cache for blink/fade — avoids re-traversing
  // the group every frame in the hot path.
  const materials: THREE.Material[] = [];
  group.traverse((obj) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mat = (obj as any).material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (!mat) return;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (m && !materials.includes(m)) materials.push(m);
      }
    } else if (!materials.includes(mat)) {
      materials.push(mat);
    }
  });

  // Flip `transparent = true` once at spawn so the renderer only ever has
  // to touch `opacity` — see PickupRenderer header for the rationale.
  for (const m of materials) {
    m.transparent = true;
  }

  return { group, materials };
}
