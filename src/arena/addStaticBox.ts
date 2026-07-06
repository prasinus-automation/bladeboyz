/**
 * `addStaticBox` — shared arena prop helper (extracted from `createArena.ts`
 * so Arena v1 and Arena v2 place static geometry identically, #207).
 *
 * Every static prop is a `THREE.BoxGeometry` mesh plus a matching Rapier
 * `RigidBodyType.Fixed` cuboid collider with IDENTICAL half-extents:
 * `BoxGeometry(w, h, d)` takes full extents; `ColliderDesc.cuboid(hx, hy, hz)`
 * takes half-extents, so the collider gets `(w/2, h/2, d/2)`. Centralizing the
 * conversion here keeps mesh↔collider parity a single-source invariant.
 */

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { GameWorld } from '../core/types';
import type { Vec3 } from './types';

/**
 * A placed static box's disposable handles. `createCastle` / `addMedievalProps`
 * collect these so a caller can tear the geometry down on HMR / arena swap
 * (dispose the mesh's geometry+material, remove the rigid body). Older callers
 * that don't need disposal simply ignore the return value.
 */
export interface StaticHandle {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
}

export function addStaticBox(
  world: GameWorld,
  center: Vec3,
  size: { x: number; y: number; z: number },
  color: number,
): StaticHandle {
  // Visual mesh
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const mat = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(center.x, center.y, center.z);
  world.scene.add(mesh);

  // Rapier static collider with matching half-extents
  const bodyDesc = world.rapier.RigidBodyDesc.fixed().setTranslation(
    center.x,
    center.y,
    center.z,
  );
  const body = world.physicsWorld.createRigidBody(bodyDesc);
  const colliderDesc = world.rapier.ColliderDesc.cuboid(
    size.x / 2,
    size.y / 2,
    size.z / 2,
  );
  world.physicsWorld.createCollider(colliderDesc, body);

  return { mesh, body };
}
