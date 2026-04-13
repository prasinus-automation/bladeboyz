import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { defineQuery } from 'bitecs';
import {
  Hitboxes,
  CharacterModel,
  Position,
  Rotation,
  meshRegistry,
  hitboxColliderRegistry,
  BodyRegion,
} from '../components';
import type { GameWorld } from '../../core/types';

/* ─── Hitbox dimensions per region (half-extents) ─── */

interface HitboxDef {
  region: BodyRegion;
  boneName: string;
  halfExtents: [number, number, number]; // x, y, z
  offset: THREE.Vector3; // local offset from bone
}

const HITBOX_DEFS: HitboxDef[] = [
  {
    region: BodyRegion.Head,
    boneName: 'head',
    halfExtents: [0.13, 0.13, 0.13],
    offset: new THREE.Vector3(0, 0.13, 0),
  },
  {
    region: BodyRegion.Torso,
    boneName: 'chest',
    halfExtents: [0.23, 0.25, 0.13],
    offset: new THREE.Vector3(0, 0, 0),
  },
  {
    region: BodyRegion.ArmLeft,
    boneName: 'upper_arm_L',
    halfExtents: [0.07, 0.25, 0.07],
    offset: new THREE.Vector3(0, -0.25, 0),
  },
  {
    region: BodyRegion.ArmRight,
    boneName: 'upper_arm_R',
    halfExtents: [0.07, 0.25, 0.07],
    offset: new THREE.Vector3(0, -0.25, 0),
  },
  {
    region: BodyRegion.LegLeft,
    boneName: 'thigh_L',
    halfExtents: [0.07, 0.35, 0.07],
    offset: new THREE.Vector3(0, -0.35, 0),
  },
  {
    region: BodyRegion.LegRight,
    boneName: 'thigh_R',
    halfExtents: [0.07, 0.35, 0.07],
    offset: new THREE.Vector3(0, -0.35, 0),
  },
];

/* ─── Temp objects for transform computation ─── */
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _offsetWorld = new THREE.Vector3();

/**
 * Create Rapier sensor colliders for all hitbox regions of an entity.
 * Attaches the Hitboxes component and populates registries.
 */
export function createHitboxes(
  world: GameWorld,
  entity: number,
  skeleton: THREE.Skeleton,
  bones: Record<string, THREE.Bone>,
): void {
  const colliderMap = new Map<BodyRegion, RAPIER.Collider>();
  const RAPIER = world.rapier;

  // We need a kinematic rigid body to parent all sensor colliders
  const rbDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
  const rigidBody = world.physicsWorld.createRigidBody(rbDesc);

  for (const def of HITBOX_DEFS) {
    const bone = bones[def.boneName];
    if (!bone) continue;

    // Create sensor collider
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      def.halfExtents[0],
      def.halfExtents[1],
      def.halfExtents[2],
    ).setSensor(true);

    const collider = world.physicsWorld.createCollider(colliderDesc, rigidBody);
    colliderMap.set(def.region, collider);
  }

  hitboxColliderRegistry.set(entity, colliderMap);

  // Store collider handles in bitECS component
  const headCollider = colliderMap.get(BodyRegion.Head);
  const torsoCollider = colliderMap.get(BodyRegion.Torso);
  const armLCollider = colliderMap.get(BodyRegion.ArmLeft);
  const armRCollider = colliderMap.get(BodyRegion.ArmRight);
  const legLCollider = colliderMap.get(BodyRegion.LegLeft);
  const legRCollider = colliderMap.get(BodyRegion.LegRight);

  Hitboxes.head[entity] = headCollider ? headCollider.handle : 0xffffffff;
  Hitboxes.torso[entity] = torsoCollider ? torsoCollider.handle : 0xffffffff;
  Hitboxes.armLeft[entity] = armLCollider ? armLCollider.handle : 0xffffffff;
  Hitboxes.armRight[entity] = armRCollider ? armRCollider.handle : 0xffffffff;
  Hitboxes.legLeft[entity] = legLCollider ? legLCollider.handle : 0xffffffff;
  Hitboxes.legRight[entity] = legRCollider ? legRCollider.handle : 0xffffffff;
}

/* ─── Hitbox sync query ─── */
const hitboxQuery = defineQuery([Hitboxes, CharacterModel]);

/**
 * HitboxSystem — syncs Rapier sensor collider positions to match
 * skeleton bone world transforms each fixed-update tick.
 */
export function hitboxSystem(world: GameWorld): void {
  const entities = hitboxQuery(world.ecs);

  for (const eid of entities) {
    const modelData = meshRegistry.get(eid);
    if (!modelData) continue;

    const colliderMap = hitboxColliderRegistry.get(eid);
    if (!colliderMap) continue;

    const { skeleton, bones } = modelData;

    for (const def of HITBOX_DEFS) {
      const bone = bones[def.boneName];
      if (!bone) continue;

      const collider = colliderMap.get(def.region);
      if (!collider) continue;

      // Get bone world transform
      bone.updateWorldMatrix(true, false);
      bone.getWorldPosition(_worldPos);
      bone.getWorldQuaternion(_worldQuat);

      // Apply local offset in bone space
      _offsetWorld.copy(def.offset).applyQuaternion(_worldQuat).add(_worldPos);

      // Sync to Rapier collider parent rigid body
      const rb = collider.parent();
      if (rb) {
        rb.setTranslation(
          { x: _offsetWorld.x, y: _offsetWorld.y, z: _offsetWorld.z },
          true,
        );
        rb.setRotation(
          { x: _worldQuat.x, y: _worldQuat.y, z: _worldQuat.z, w: _worldQuat.w },
          true,
        );
      }
    }
  }
}

/* ─── Debug visualization ─── */

/** Color per body region for debug wireframes */
const REGION_COLORS: Record<BodyRegion, number> = {
  [BodyRegion.Head]: 0xff0000, // red
  [BodyRegion.Torso]: 0x0000ff, // blue
  [BodyRegion.ArmLeft]: 0x00ff00, // green
  [BodyRegion.ArmRight]: 0x00ff00, // green
  [BodyRegion.LegLeft]: 0xffff00, // yellow
  [BodyRegion.LegRight]: 0xffff00, // yellow
};

const debugMeshes = new Map<number, THREE.Group>();
let debugVisible = false;

/**
 * Toggle hitbox debug wireframe rendering.
 */
export function toggleHitboxDebug(world: GameWorld): void {
  debugVisible = !debugVisible;

  if (!debugVisible) {
    // Remove all debug meshes
    for (const [, debugGroup] of debugMeshes) {
      world.scene.remove(debugGroup);
      debugGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }
    debugMeshes.clear();
    return;
  }

  // Create debug wireframes for all hitbox entities
  const entities = hitboxQuery(world.ecs);
  for (const eid of entities) {
    createDebugWireframes(world, eid);
  }
}

function createDebugWireframes(world: GameWorld, entity: number): void {
  if (debugMeshes.has(entity)) return;

  const debugGroup = new THREE.Group();
  debugGroup.name = `hitbox-debug-${entity}`;

  for (const def of HITBOX_DEFS) {
    const boxGeom = new THREE.BoxGeometry(
      def.halfExtents[0] * 2,
      def.halfExtents[1] * 2,
      def.halfExtents[2] * 2,
    );
    const edges = new THREE.EdgesGeometry(boxGeom);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: REGION_COLORS[def.region] }),
    );
    line.name = `hitbox-region-${def.region}`;
    line.userData.region = def.region;
    line.userData.boneName = def.boneName;
    line.userData.offset = def.offset.clone();
    debugGroup.add(line);
    boxGeom.dispose(); // edges holds its own data
  }

  world.scene.add(debugGroup);
  debugMeshes.set(entity, debugGroup);
}

/**
 * Update debug wireframe positions to match bone transforms.
 * Call each frame when debug is visible.
 */
export function updateHitboxDebug(world: GameWorld): void {
  if (!debugVisible) return;

  const entities = hitboxQuery(world.ecs);

  for (const eid of entities) {
    const modelData = meshRegistry.get(eid);
    if (!modelData) continue;

    let debugGroup = debugMeshes.get(eid);
    if (!debugGroup) {
      createDebugWireframes(world, eid);
      debugGroup = debugMeshes.get(eid);
      if (!debugGroup) continue;
    }

    const { bones } = modelData;

    debugGroup.children.forEach((child) => {
      const boneName = child.userData.boneName as string;
      const offset = child.userData.offset as THREE.Vector3;
      const bone = bones[boneName];
      if (!bone) return;

      bone.updateWorldMatrix(true, false);
      bone.getWorldPosition(_worldPos);
      bone.getWorldQuaternion(_worldQuat);

      _offsetWorld.copy(offset).applyQuaternion(_worldQuat).add(_worldPos);

      child.position.copy(_offsetWorld);
      child.quaternion.copy(_worldQuat);
    });
  }
}

export function isHitboxDebugVisible(): boolean {
  return debugVisible;
}

export { HITBOX_DEFS };
