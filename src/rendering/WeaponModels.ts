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

  return { group, tracerPoints };
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

  return { group, tracerPoints };
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

  return { group, tracerPoints };
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
