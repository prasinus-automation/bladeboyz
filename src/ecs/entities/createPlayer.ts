import RAPIER from '@dimforge/rapier3d-compat';
import { addEntity, addComponent } from 'bitecs';
import * as THREE from 'three';
import {
  Position,
  PreviousPosition,
  Rotation,
  PreviousRotation,
  Velocity,
  Player,
  PhysicsBody,
  MovementState,
  Health,
  CombatStateComp,
  AnimationComp,
} from '../components';
import { registerPhysicsBody } from '../systems/MovementSystem';
import type { GameWorld } from '../../core/types';

/**
 * Create the player entity with physics body and basic mesh.
 *
 * Returns entity ID. The character mesh is a simple low-poly placeholder.
 */
export function createPlayer(
  world: GameWorld,
  spawnPos: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 },
): { eid: number; mesh: THREE.Group } {
  const eid = addEntity(world.ecs);

  // Add components
  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, PreviousPosition, eid);
  addComponent(world.ecs, Rotation, eid);
  addComponent(world.ecs, PreviousRotation, eid);
  addComponent(world.ecs, Velocity, eid);
  addComponent(world.ecs, Player, eid);
  addComponent(world.ecs, PhysicsBody, eid);
  addComponent(world.ecs, MovementState, eid);
  addComponent(world.ecs, Health, eid);
  addComponent(world.ecs, CombatStateComp, eid);
  addComponent(world.ecs, AnimationComp, eid);

  // Set initial values
  Position.x[eid] = spawnPos.x;
  Position.y[eid] = spawnPos.y;
  Position.z[eid] = spawnPos.z;
  PreviousPosition.x[eid] = spawnPos.x;
  PreviousPosition.y[eid] = spawnPos.y;
  PreviousPosition.z[eid] = spawnPos.z;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  MovementState.grounded[eid] = 0;
  MovementState.sprinting[eid] = 0;
  MovementState.crouching[eid] = 0;
  MovementState.speedFactor[eid] = 0;
  Health.current[eid] = 100;
  Health.max[eid] = 100;

  // Create Rapier kinematic body
  const bodyDesc = world.rapier.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z);
  const body = world.physicsWorld.createRigidBody(bodyDesc);

  // Capsule collider (radius=0.3, half-height=0.7 -> total height ~2.0)
  const colliderDesc = world.rapier.ColliderDesc.capsule(0.7, 0.3);
  const collider = world.physicsWorld.createCollider(colliderDesc, body);

  PhysicsBody.bodyHandle[eid] = body.handle;
  PhysicsBody.colliderHandle[eid] = collider.handle;
  registerPhysicsBody(body.handle, body, collider.handle, collider);

  // Simple placeholder mesh (low-poly character)
  const group = new THREE.Group();

  // Body (box)
  const torsoGeo = new THREE.BoxGeometry(0.5, 0.7, 0.3);
  const torsoMat = new THREE.MeshStandardMaterial({ color: 0x4488aa });
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 1.05;
  group.add(torso);

  // Head (box)
  const headGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xeebb88 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.6;
  group.add(head);

  // Legs (cylinders)
  const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.7, 6);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x333366 });
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.12, 0.35, 0);
  group.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.12, 0.35, 0);
  group.add(rightLeg);

  // Arms (cylinders)
  const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x4488aa });
  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.position.set(-0.35, 1.05, 0);
  group.add(leftArm);
  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.position.set(0.35, 1.05, 0);
  group.add(rightArm);

  group.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
  world.scene.add(group);

  return { eid, mesh: group };
}
