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
  Stamina,
  CombatStateComp,
  CombatStateComponent,
  AnimationComp,
  CharacterModel,
  meshRegistry,
} from '../components';
import { registerPhysicsBody } from '../systems/MovementSystem';
import { createCharacterModel } from '../../rendering/CharacterModel';
import { weaponModelFactories } from '../../rendering/WeaponModels';
import { weaponIdToName } from '../systems/CombatSystem';
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS, SPAWN_HEIGHT } from '../../core/types';
import type { GameWorld } from '../../core/types';

/** Options for creating a player entity */
export interface CreatePlayerOptions {
  x?: number;
  y?: number;
  z?: number;
  /** Starting weapon name (default: 'Dagger') */
  startingWeapon?: string;
}

/**
 * Create the player entity with physics body and skeletal character model.
 *
 * Returns entity ID and the Three.js group for camera attachment.
 * Uses the full procedural skeletal model with bone hierarchy and
 * attaches the starting weapon model to the weapon_attach bone.
 */
export function createPlayer(
  world: GameWorld,
  spawnPos: { x: number; y: number; z: number } = { x: 0, y: SPAWN_HEIGHT, z: 0 },
  options: CreatePlayerOptions = {},
): { eid: number; mesh: THREE.Group } {
  const startingWeapon = options.startingWeapon ?? 'Dagger';
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
  addComponent(world.ecs, Stamina, eid);
  addComponent(world.ecs, CombatStateComp, eid);
  addComponent(world.ecs, CombatStateComponent, eid);
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
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;
  CombatStateComponent.state[eid] = 0; // Idle
  CombatStateComponent.ticksRemaining[eid] = 0;
  const weaponIndex = weaponIdToName.indexOf(startingWeapon);
  CombatStateComponent.weaponId[eid] = weaponIndex >= 0 ? weaponIndex : 0;

  // Create Rapier kinematic body
  const bodyDesc = world.rapier.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z);
  const body = world.physicsWorld.createRigidBody(bodyDesc);

  // Capsule collider (total height ~2.0)
  const colliderDesc = world.rapier.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS);
  const collider = world.physicsWorld.createCollider(colliderDesc, body);

  PhysicsBody.bodyHandle[eid] = body.handle;
  PhysicsBody.colliderHandle[eid] = collider.handle;
  registerPhysicsBody(eid, body, collider);

  // Skeletal character model (procedural low-poly with full bone hierarchy)
  const characterModelData = createCharacterModel(0x4488aa);
  const { group, bones } = characterModelData;

  // Register CharacterModel component so AnimationSystem can find this entity
  addComponent(world.ecs, CharacterModel, eid);
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, characterModelData);

  // Attach starting weapon model to the weapon_attach bone on hand_R
  const weaponAttachBone = bones['weapon_attach'];
  if (weaponAttachBone) {
    const factory = weaponModelFactories[startingWeapon];
    if (factory) {
      const weaponModel = factory();
      weaponAttachBone.add(weaponModel.group);
    }
  }

  group.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
  world.scene.add(group);

  return { eid, mesh: group };
}
