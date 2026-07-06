/**
 * createWarmupBot — a sparring opponent that actually fights back
 * (issue #119 / `docs/training-dummies-and-bots-spec.md` §4).
 *
 * A bot is structurally "a player without a keyboard": kinematic capsule
 * body driven by MovementSystem via `MovementIntent` (the documented AI
 * seam), a CombatFSM ticked by CombatSystem, hitboxes, tracers, knockback,
 * inventory — the full combatant stack. `BotAISystem` supplies the intent
 * each tick.
 *
 * Lifecycle: bots carry the `Bot` tag, which the death pipeline was built
 * around (#130): HP → 0 adds DeadTag/RespawnPending, `processDeaths` emits
 * a DeathEvent (killfeed + 25 gold to the killing player via the existing
 * `awardGoldOnKill` rules), and `processRespawns` teleports them to a
 * spawn point 3 s later with full HP. Killing bots is the game's first
 * real gold-income loop.
 *
 * Spec deviations (deliberate):
 *  - Spec §4 says "bot writes movement intent into MovementState" — that
 *    predates the #104 refactor; the AI seam is `MovementIntent` now.
 *  - Spec §3 note says bot kills award no gold; #130 deliberately wired
 *    `Bot` into the kill-credit pipeline and bots are currently the only
 *    gold source, so kills DO pay out.
 *  - Default color is orange (0xdd7722) not the spec's blue — the player
 *    model is already blue; orange reads instantly as "hostile NPC" next
 *    to the red dummies.
 */

import * as THREE from 'three';
import { addEntity, addComponent, removeEntity, defineQuery, hasComponent } from 'bitecs';
import {
  Position,
  PreviousPosition,
  Rotation,
  PreviousRotation,
  Velocity,
  CharacterModel,
  Health,
  Stamina,
  Hitboxes,
  PhysicsBody,
  MovementState,
  MovementIntent,
  CombatStateComp,
  CombatStateComponent,
  AnimationComp,
  HitReactComp,
  TracerTag,
  KnockbackState,
  Score,
  Bot,
  BotBrain,
  IsNPC,
  meshRegistry,
  hitboxColliderRegistry,
} from '../components';
import { createCharacterModel } from '../../rendering/CharacterModel';
import { createHitboxes } from '../systems/HitboxSystem';
import {
  registerPhysicsBody,
  unregisterPhysicsBody,
  getPhysicsBody,
} from '../systems/MovementSystem';
import { weaponBoneMap, colliderToHitbox } from '../systems/TracerSystem';
import { spawnAtGround } from '../utils/spawnAtGround';
import { yawTowards } from '../../utils/math';
import { CombatState } from '../../combat/states';
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from '../../core/types';
import { createFSM, removeFSM } from '../../combat/CombatFSM';
import { weaponConfigs } from '../../weapons/WeaponConfig';
import { weaponIdToName } from '../systems/CombatSystem';
import { attachThirdPersonWeapon } from '../../rendering/WeaponModels';
import { initInventory, inventoryRegistry } from '../systems/InventorySystem';
import { npcRegistry } from '../npcRegistry';
import { npcLastHitTick } from './createTrainingDummy';
import { getCurrentFixedTick } from '../../core/tickCounter';
import type { GameWorld } from '../../core/types';

export interface CreateWarmupBotOpts {
  /** World-space spawn position (feet origin). Y raycast-resolved if omitted. */
  spawnPos: { x: number; y?: number; z: number };
  /** Entity to chase. Required — usually the local player eid. */
  targetEid: number;
  /** Body color. Default 0xdd7722 (orange — hostile, distinct from red dummies / blue player). */
  color?: number;
  /** Weapon name from `weaponConfigs`. Default 'Longsword' (matches respawn default). */
  startingWeapon?: string;
  /**
   * Distance (m) at which the bot transitions Approach → Engage and starts
   * swinging. Default 1.3 — INSIDE a longsword's actual strike envelope.
   * (The spec's 2.5 m suggestion predates real tracer combat: a bot that
   * stops at 2.5 m — or even 2.0 m — parks at the very edge of its reach
   * and whiffs every swing.)
   */
  meleeRange?: number;
}

const botQuery = defineQuery([Bot, BotBrain]);

/** All live warmup-bot eids (query-backed, mirrors getTrainingDummyEids). */
export function getWarmupBotEids(world: GameWorld): number[] {
  return Array.from(botQuery(world.ecs));
}

export function createWarmupBot(
  world: GameWorld,
  opts: CreateWarmupBotOpts,
): { eid: number; mesh: THREE.Group } {
  const color = opts.color ?? 0xdd7722;
  const startingWeapon = opts.startingWeapon ?? 'Longsword';
  const meleeRange = opts.meleeRange ?? 1.3;

  const x = opts.spawnPos.x;
  const z = opts.spawnPos.z;
  const feetY =
    typeof opts.spawnPos.y === 'number'
      ? opts.spawnPos.y
      : spawnAtGround(world, x, z).y;

  const eid = addEntity(world.ecs);

  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, PreviousPosition, eid);
  addComponent(world.ecs, Rotation, eid);
  addComponent(world.ecs, PreviousRotation, eid);
  addComponent(world.ecs, Velocity, eid);
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
  addComponent(world.ecs, KnockbackState, eid);
  addComponent(world.ecs, Hitboxes, eid);
  addComponent(world.ecs, Score, eid);
  addComponent(world.ecs, Bot, eid);
  addComponent(world.ecs, BotBrain, eid);
  addComponent(world.ecs, IsNPC, eid);

  Position.x[eid] = x;
  Position.y[eid] = feetY;
  Position.z[eid] = z;
  PreviousPosition.x[eid] = x;
  PreviousPosition.y[eid] = feetY;
  PreviousPosition.z[eid] = z;

  // Face the target initially; BotAISystem re-aims every tick.
  // yawTowards(self, target) = atan2(-(targetX-x), -(targetZ-z)) — identical to
  // the old inline, via the shared helper (#212).
  Rotation.y[eid] = yawTowards(
    x,
    z,
    Position.x[opts.targetEid],
    Position.z[opts.targetEid],
  );
  PreviousRotation.y[eid] = Rotation.y[eid];

  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;
  // Grounded from tick 0 — raycast-placed on the floor; avoids one frame
  // of airborne pose (AnimationSystem defends, but be tidy at the source).
  MovementState.grounded[eid] = 1;
  MovementState.lastGroundedTick[eid] = 0;
  MovementState.jumpBufferTick[eid] = 0;

  CombatStateComponent.state[eid] = CombatState.Idle;
  const weaponIndex = weaponIdToName.indexOf(startingWeapon);
  CombatStateComponent.weaponId[eid] = weaponIndex >= 0 ? weaponIndex : 0;

  BotBrain.targetEid[eid] = opts.targetEid;
  BotBrain.mode[eid] = 0; // Approach
  BotBrain.lastSwingTick[eid] = 0;
  BotBrain.meleeRange[eid] = meleeRange;
  BotBrain.prevX[eid] = x;
  BotBrain.prevZ[eid] = z;
  BotBrain.stuckTicks[eid] = 0;
  BotBrain.detourUntilTick[eid] = 0;
  BotBrain.detourSign[eid] = 0;

  // Kinematic capsule — same convention as the player (feet origin,
  // collider offset upward). MovementSystem drives it via MovementIntent.
  const bodyDesc = world.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
    x,
    feetY,
    z,
  );
  const body = world.physicsWorld.createRigidBody(bodyDesc);
  const colliderDesc = world.rapier.ColliderDesc.capsule(
    CAPSULE_HALF_HEIGHT,
    CAPSULE_RADIUS,
  ).setTranslation(0, CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT, 0);
  const collider = world.physicsWorld.createCollider(colliderDesc, body);
  PhysicsBody.bodyHandle[eid] = body.handle;
  PhysicsBody.colliderHandle[eid] = collider.handle;
  registerPhysicsBody(eid, body, collider);

  // FSM + inventory. The starting weapon doubles as the protected starter,
  // so drop-on-death never litters the floor with bot weapons; respawn
  // re-equips via equipDefaultStarter (Longsword) like any combatant.
  const config = weaponConfigs[startingWeapon] ?? weaponConfigs['Longsword'];
  createFSM(eid, config);
  initInventory(eid, [startingWeapon], startingWeapon, startingWeapon);

  const { group, skeleton, bones } = createCharacterModel(color);
  group.position.set(x, feetY, z);
  group.rotation.y = Rotation.y[eid];
  addComponent(world.ecs, CharacterModel, eid);
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, { group, skeleton, bones });
  world.scene.add(group);

  const weaponBone = bones['weapon_attach'];
  if (weaponBone) {
    weaponBoneMap.set(eid, weaponBone);
    attachThirdPersonWeapon(weaponBone, startingWeapon);
  }

  createHitboxes(world, eid, skeleton, bones);

  npcRegistry.set(eid, {
    kind: 'warmup-bot',
    spawnPos: { x, y: feetY, z },
    spawnYaw: Rotation.y[eid],
    spawnTick: getCurrentFixedTick(),
  });

  return { eid, mesh: group };
}

/**
 * Despawn a bot: dispose meshes, remove Rapier bodies (capsule + all six
 * hitbox sensor bodies — unlike `removeTrainingDummy`, which leaks them),
 * and clear every side-table entry.
 */
export function removeWarmupBot(world: GameWorld, eid: number): void {
  const modelData = meshRegistry.get(eid);
  if (modelData) {
    world.scene.remove(modelData.group);
    modelData.group.traverse((obj) => {
      const o = obj as unknown as {
        geometry?: { dispose: () => void };
        material?: { dispose: () => void } | Array<{ dispose: () => void }>;
      };
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    meshRegistry.delete(eid);
  }

  // Hitbox sensor bodies + their colliderToHitbox entries.
  const colliderMap = hitboxColliderRegistry.get(eid);
  if (colliderMap) {
    for (const [, sensor] of colliderMap) {
      colliderToHitbox.delete(sensor.handle);
      const rb = sensor.parent();
      if (rb) world.physicsWorld.removeRigidBody(rb);
    }
    hitboxColliderRegistry.delete(eid);
  }

  // Main capsule body.
  const body = getPhysicsBody(eid);
  if (body) world.physicsWorld.removeRigidBody(body);
  unregisterPhysicsBody(eid);

  removeFSM(eid);
  inventoryRegistry.delete(eid);
  npcRegistry.delete(eid);
  npcLastHitTick.delete(eid);
  weaponBoneMap.delete(eid);

  removeEntity(world.ecs, eid);
}

/**
 * Single-player convenience for the B toggle: despawn the live bot if one
 * exists, otherwise spawn one targeting the local player at the arena
 * spawn point furthest from them (or a fixed offset without an arena).
 * Returns true if a bot is now active.
 */
export function toggleWarmupBot(
  world: GameWorld,
  localPlayerEid: number,
): boolean {
  const bots = getWarmupBotEids(world);
  if (bots.length > 0) {
    for (const eid of bots) removeWarmupBot(world, eid);
    return false;
  }

  let spawn = { x: Position.x[localPlayerEid], z: Position.z[localPlayerEid] + 6 };
  const arena = world.arena;
  if (arena) {
    let bestD = -1;
    for (const sp of arena.spawnPoints) {
      const d =
        (sp.position.x - Position.x[localPlayerEid]) ** 2 +
        (sp.position.z - Position.z[localPlayerEid]) ** 2;
      if (d > bestD) {
        bestD = d;
        spawn = { x: sp.position.x, z: sp.position.z };
      }
    }
  }

  createWarmupBot(world, { spawnPos: spawn, targetEid: localPlayerEid });
  return true;
}

/** True iff `eid` is a live warmup bot. */
export function isWarmupBot(world: GameWorld, eid: number): boolean {
  return hasComponent(world.ecs, Bot, eid) && hasComponent(world.ecs, BotBrain, eid);
}
