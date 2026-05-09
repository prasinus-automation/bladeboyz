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
  MovementIntent,
  Health,
  Stamina,
  CombatStateComp,
  CombatStateComponent,
  AnimationComp,
  HitReactComp,
  CharacterModel,
  TracerTag,
  Hitboxes,
  Score,
  meshRegistry,
} from '../components';
import { registerPhysicsBody } from '../systems/MovementSystem';
import { spawnAtGround } from '../utils/spawnAtGround';
import { createCharacterModel } from '../../rendering/CharacterModel';
import { weaponModelFactories } from '../../rendering/WeaponModels';
import { weaponIdToName } from '../systems/CombatSystem';
import { weaponBoneMap } from '../systems/TracerSystem';
import { createHitboxes } from '../systems/HitboxSystem';
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from '../../core/types';
import { selectSpawnPoint } from '../../world/SpawnPoints';
import type { GameWorld } from '../../core/types';

/** Options for creating a player entity */
export interface CreatePlayerOptions {
  x?: number;
  y?: number;
  z?: number;
  /**
   * Starting weapon name. Default: `'Longsword'` (issue #130). The default
   * shifted from `'Dagger'` to `'Longsword'` when the spawn/death/respawn
   * design landed; respawning entities are auto-equipped with the same
   * default. Tests that previously hardcoded `'Dagger'` should pass it
   * explicitly here.
   */
  startingWeapon?: string;
}

/**
 * Create the player entity with physics body and skeletal character model.
 *
 * Spawn position resolution (in priority order):
 *   1. If `spawnPos` is supplied, use those coordinates directly. Y is
 *      resolved by `spawnAtGround` raycast unless an explicit `y` is given
 *      (test path).
 *   2. Otherwise consult `selectSpawnPoint({ enemies: [] })` — the
 *      spawn-point registry seeded by the arena (#91) or the placeholder
 *      helper (#134). The initial spawn passes no enemies because no other
 *      combatants exist yet at world-load time.
 *   3. Fall back to `(0, raycast, 0)` if the registry is empty (tests, or
 *      a future game mode that doesn't seed spawn points).
 *
 * Capsule collider sits at `(0, R+H, 0)` inside the body so the body's
 * origin (= ECS Position) is at the **feet**. Mesh root is also at feet,
 * so `meshGroup.position = ECS Position` is a direct copy with NO offset.
 *
 * TODO(#91): when the real arena lands, the registry-driven path becomes
 * the dominant one — placeholder corners get replaced with arena-defined
 * spawn locations. No code change needed here; the registry is the seam.
 *
 * Returns entity ID and the Three.js group for camera attachment.
 */
export function createPlayer(
  world: GameWorld,
  spawnPos?: { x?: number; y?: number; z?: number },
  options: CreatePlayerOptions = {},
): { eid: number; mesh: THREE.Group } {
  const startingWeapon = options.startingWeapon ?? 'Longsword';

  let x: number;
  let resolvedY: number;
  let z: number;
  let initialYaw = 0;

  if (spawnPos !== undefined) {
    // Explicit override path — tests pass concrete coordinates.
    x = spawnPos.x ?? 0;
    z = spawnPos.z ?? 0;
    resolvedY =
      typeof spawnPos.y === 'number' ? spawnPos.y : spawnAtGround(world, x, z).y;
  } else {
    // Registry path — the arena (or seedPlaceholderSpawnPoints in dev)
    // is responsible for populating the registry before this runs.
    const sp = selectSpawnPoint({ enemies: [] });
    if (sp) {
      x = sp.position.x;
      resolvedY = sp.position.y;
      z = sp.position.z;
      initialYaw = sp.yaw;
    } else {
      // Empty registry — preserve legacy behavior so unit tests that
      // don't seed spawn points still get a usable spawn at the origin.
      x = 0;
      z = 0;
      resolvedY = spawnAtGround(world, x, z).y;
    }
  }

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
  addComponent(world.ecs, MovementIntent, eid);
  addComponent(world.ecs, Health, eid);
  addComponent(world.ecs, Stamina, eid);
  addComponent(world.ecs, CombatStateComp, eid);
  addComponent(world.ecs, CombatStateComponent, eid);
  addComponent(world.ecs, AnimationComp, eid);
  addComponent(world.ecs, HitReactComp, eid);
  addComponent(world.ecs, TracerTag, eid);
  addComponent(world.ecs, Hitboxes, eid);
  // Score is initialized to all-zeroes via bitECS's typed-array default.
  // Lifetime kills/deaths persist across the respawn loop.
  addComponent(world.ecs, Score, eid);

  // Set initial values (feet position)
  Position.x[eid] = x;
  Position.y[eid] = resolvedY;
  Position.z[eid] = z;
  PreviousPosition.x[eid] = x;
  PreviousPosition.y[eid] = resolvedY;
  PreviousPosition.z[eid] = z;
  // Apply spawn-point yaw if one was selected. Unit tests that build the
  // player at (0,0) with no registry leave Rotation.y at 0 — which matches
  // the pre-#134 behavior where spawn rotation was always identity.
  Rotation.y[eid] = initialYaw;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  MovementState.grounded[eid] = 0;
  MovementState.sprinting[eid] = 0;
  MovementState.crouching[eid] = 0;
  MovementState.speedFactor[eid] = 0;
  MovementState.verticalVelocity[eid] = 0;
  MovementState.lastJumpTick[eid] = -1;
  MovementIntent.moveX[eid] = 0;
  MovementIntent.moveZ[eid] = 0;
  MovementIntent.sprint[eid] = 0;
  MovementIntent.crouch[eid] = 0;
  MovementIntent.jumpRequested[eid] = 0;
  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;
  Score.kills[eid] = 0;
  Score.deaths[eid] = 0;
  Score.goldThisLife[eid] = 0;
  CombatStateComponent.state[eid] = 0; // Idle
  CombatStateComponent.ticksRemaining[eid] = 0;
  const weaponIndex = weaponIdToName.indexOf(startingWeapon);
  CombatStateComponent.weaponId[eid] = weaponIndex >= 0 ? weaponIndex : 0;

  // Create Rapier kinematic body at FEET position (no +1 offset).
  const bodyDesc = world.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
    x,
    resolvedY,
    z,
  );
  const body = world.physicsWorld.createRigidBody(bodyDesc);

  // Capsule collider, offset upward inside the body so the bottom hemisphere
  // sits at the body origin (= feet). See AGENTS.md spatial conventions.
  const colliderDesc = world.rapier.ColliderDesc.capsule(
    CAPSULE_HALF_HEIGHT,
    CAPSULE_RADIUS,
  ).setTranslation(0, CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT, 0);
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
    weaponBoneMap.set(eid, weaponAttachBone);
    const factory = weaponModelFactories[startingWeapon];
    if (factory) {
      const weaponModel = factory();
      weaponAttachBone.add(weaponModel.group);
    }
  }

  // Mesh root bone is at feet (y=0 in local space), so this is a direct copy.
  group.position.set(x, resolvedY, z);
  world.scene.add(group);

  // Create hitbox sensor colliders for the player (enables damage detection)
  createHitboxes(world, eid, characterModelData.skeleton, characterModelData.bones);

  return { eid, mesh: group };
}
