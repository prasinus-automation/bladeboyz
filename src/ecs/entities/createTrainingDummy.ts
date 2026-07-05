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
  CombatStateComp,
  CombatStateComponent,
  AnimationComp,
  HitReactComp,
  TracerTag,
  KnockbackState,
  IsNPC,
  IsTrainingDummy,
  meshRegistry,
  hitboxColliderRegistry,
} from '../components';
import { createCharacterModel } from '../../rendering/CharacterModel';
import { createHitboxes } from '../systems/HitboxSystem';
import { registerPhysicsBody } from '../systems/MovementSystem';
import { weaponBoneMap } from '../systems/TracerSystem';
import { spawnAtGround } from '../utils/spawnAtGround';
import { CombatState } from '../../combat/states';
import { Direction } from '../../combat/directions';
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from '../../core/types';
import { CombatInput, createFSM, fsmRegistry, removeFSM } from '../../combat/CombatFSM';
import { weaponConfigs } from '../../weapons/WeaponConfig';
import { weaponIdToName } from '../systems/CombatSystem';
import { weaponModelFactories } from '../../rendering/WeaponModels';
import { npcRegistry } from '../npcRegistry';
import type { GameWorld } from '../../core/types';

/* ────────────────────────────────────────────────────────────────────────────
 * createTrainingDummy
 *
 * Replaces the legacy `createDummy` factory + `activeDummies: number[]` array
 * (per `docs/training-dummies-and-bots-spec.md` §6 and §7).
 *
 * What's the same as the legacy factory:
 *   - Fixed-body capsule + `spawnAtGround` feet-origin convention from #104.
 *   - Full character model + hitbox sensors + TracerTag for tracer hit
 *     detection (so the dummy can swing during T/Y block-test poses).
 *   - 3 s no-hit auto-regen (180 ticks @ 60 Hz).
 *   - CombatFSM registered so CombatSystem ticks the dummy each fixed update.
 *
 * What's new:
 *   - `IsNPC` + `IsTrainingDummy` ECS tags. Every consumer (damage observer,
 *     `K` reset, debug overlays, killfeed labels, health bar) iterates a
 *     bitECS query instead of the old hardcoded array.
 *   - `npcRegistry` side-table holds non-numeric metadata (kind, spawn pos,
 *     spawn yaw) that bitECS components can't store.
 *   - Module-level `dummyTickCounter` global is gone — the new
 *     `tickTrainingDummyHealthReset` reads from `getCurrentFixedTick()`
 *     so it stays in lockstep with every other tick-stamped subsystem.
 *
 * Equipped weapon: defaults to `'Dagger'` to preserve current sparring-partner
 * behaviour. AGENTS.md's "default starter" is `'Longsword'` for the player
 * respawn path; per the issue body, dummies historically used Dagger and we
 * preserve that. Pass `startingWeapon: null` to spawn unarmed.
 * ──────────────────────────────────────────────────────────────────────── */

export interface CreateTrainingDummyOpts {
  /** World-space spawn position (feet origin). Y is resolved by raycast if not provided. */
  spawnPos: { x: number; y?: number; z: number };
  /** Y-rotation in radians. Default `Math.PI` (faces +Z toward player spawn). */
  facing?: number;
  /** Hex color for the procedural mesh. Default `0xcc4444` (red). */
  color?: number;
  /**
   * Weapon name from `weaponConfigs`. Default `'Dagger'`. Pass `null` to
   * spawn unarmed (no weapon model attached, no FSM registered).
   */
  startingWeapon?: string | null;
}

/** Ticks of no-hit before health resets (3 s at 60 Hz) */
export const HEALTH_RESET_TICKS = 180;

/** Per-NPC last-hit tick (read by tickTrainingDummyHealthReset). */
export const npcLastHitTick: Map<number, number> = new Map();

/** Cached ECS queries — defineQuery results are stable across ticks. */
const trainingDummyQuery = defineQuery([IsTrainingDummy]);
const npcQuery = defineQuery([IsNPC]);

import { getCurrentFixedTick } from '../../core/tickCounter';

/**
 * Create a training dummy entity with full character model, hitboxes,
 * combat state, health, and stamina.
 *
 * Dummies are static obstacles: they get a `RigidBodyType.Fixed` body with
 * a capsule collider so the player can collide with (and be stopped by)
 * them. The capsule is offset upward inside the body so the body's origin
 * is at the FEET — same convention as the player. Y is resolved via
 * `spawnAtGround` (raycast from y=50 down) when not provided.
 *
 * Dummies are NOT registered in `MovementSystem.bodyByEid` — that map is
 * for kinematic-controlled entities only. They have no `MovementIntent`.
 *
 * @returns the new entity id and the Three.js group attached to the scene
 */
export function createTrainingDummy(
  world: GameWorld,
  opts: CreateTrainingDummyOpts,
): { eid: number; mesh: THREE.Group } {
  const { spawnPos } = opts;
  const facing = opts.facing ?? Math.PI;
  const color = opts.color ?? 0xcc4444;
  const startingWeapon =
    opts.startingWeapon === undefined ? 'Dagger' : opts.startingWeapon;

  const x = spawnPos.x;
  const z = spawnPos.z;
  const feetY =
    typeof spawnPos.y === 'number' ? spawnPos.y : spawnAtGround(world, x, z).y;

  const eid = addEntity(world.ecs);

  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, PreviousPosition, eid);
  addComponent(world.ecs, Rotation, eid);
  addComponent(world.ecs, PreviousRotation, eid);
  addComponent(world.ecs, CharacterModel, eid);
  addComponent(world.ecs, Health, eid);
  addComponent(world.ecs, Stamina, eid);
  addComponent(world.ecs, Hitboxes, eid);
  addComponent(world.ecs, PhysicsBody, eid);
  addComponent(world.ecs, Velocity, eid);
  addComponent(world.ecs, CombatStateComp, eid);
  addComponent(world.ecs, CombatStateComponent, eid);
  addComponent(world.ecs, AnimationComp, eid);
  addComponent(world.ecs, HitReactComp, eid);
  addComponent(world.ecs, TracerTag, eid);
  addComponent(world.ecs, KnockbackState, eid);
  // NPC tags — single source of truth for "is this entity a non-player
  // training dummy?". Replaces the legacy `activeDummies` array.
  addComponent(world.ecs, IsNPC, eid);
  addComponent(world.ecs, IsTrainingDummy, eid);

  Position.x[eid] = x;
  Position.y[eid] = feetY;
  Position.z[eid] = z;
  PreviousPosition.x[eid] = x;
  PreviousPosition.y[eid] = feetY;
  PreviousPosition.z[eid] = z;

  Rotation.y[eid] = facing;
  PreviousRotation.y[eid] = facing;

  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;

  // Initial combat state. With FSM v2's unified Direction (#139), the dummy's
  // initial block direction is `Overhead` (formerly `BlockDirection.Top`).
  CombatStateComponent.state[eid] = CombatState.Idle;
  CombatStateComponent.blockDirection[eid] = Direction.Overhead;
  CombatStateComponent.ticksRemaining[eid] = 0;
  const weaponIndex = startingWeapon ? weaponIdToName.indexOf(startingWeapon) : -1;
  CombatStateComponent.weaponId[eid] = weaponIndex >= 0 ? weaponIndex : 0;

  // Register a CombatFSM unless explicitly unarmed. CombatSystem ticks
  // every entity with an FSM, so an unarmed dummy stays at Idle forever
  // (and `T`/`Y` debug controls become no-ops for it — fine).
  if (startingWeapon) {
    const dummyWeapon =
      weaponConfigs[startingWeapon] ?? Object.values(weaponConfigs)[0];
    if (dummyWeapon) {
      createFSM(eid, dummyWeapon);
    }
  }

  // Fixed-body capsule collider. Same offset convention as the player so
  // the body origin (Position) is at feet. Without a body the dummy would
  // float wherever Position.y was set (the bug AGENTS.md's "Hover Bug"
  // entry called out — issue #86 / #104).
  const bodyDesc = world.rapier.RigidBodyDesc.fixed().setTranslation(x, feetY, z);
  const body = world.physicsWorld.createRigidBody(bodyDesc);
  const colliderDesc = world.rapier.ColliderDesc.capsule(
    CAPSULE_HALF_HEIGHT,
    CAPSULE_RADIUS,
  ).setTranslation(0, CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT, 0);
  const collider = world.physicsWorld.createCollider(colliderDesc, body);
  PhysicsBody.bodyHandle[eid] = body.handle;
  PhysicsBody.colliderHandle[eid] = collider.handle;
  // Registered so KnockbackSystem can teleport the body when the dummy is
  // sent flying by a heavy hit. MovementSystem still skips dummies — its
  // query requires MovementIntent, which dummies don't have.
  registerPhysicsBody(eid, body, collider);

  const { group, skeleton, bones } = createCharacterModel(color);
  group.position.set(x, feetY, z);
  group.rotation.y = facing;
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, { group, skeleton, bones });

  world.scene.add(group);
  createHitboxes(world, eid, skeleton, bones);

  // Register weapon bone for tracer system (even though dummies don't
  // attack yet). The TracerTag component above is required for the bone
  // map to be consulted by TracerSystem.
  const weaponBone = bones['weapon_attach'];
  if (weaponBone) weaponBoneMap.set(eid, weaponBone);

  // Attach the weapon model to the weapon_attach bone, mirroring the
  // player's behaviour from createPlayer. So the dummy visibly looks like
  // a sparring partner instead of holding empty air.
  if (startingWeapon && weaponBone) {
    const factory = weaponModelFactories[startingWeapon];
    if (factory) {
      const weaponModel = factory();
      weaponBone.add(weaponModel.group);
    }
  }

  // Side-table metadata for HUD chrome / future debug overlays.
  npcRegistry.set(eid, {
    kind: 'training-dummy',
    spawnPos: { x, y: feetY, z },
    spawnYaw: facing,
    spawnTick: getCurrentFixedTick(),
  });
  // Allow immediate regen — set last-hit tick to a value far enough in the
  // past that `(currentTick - lastHit) >= HEALTH_RESET_TICKS` on tick 0.
  npcLastHitTick.set(eid, getCurrentFixedTick() - HEALTH_RESET_TICKS);

  return { eid, mesh: group };
}

/**
 * Despawn one training dummy and free its resources.
 *
 * Safe to call with an eid that's already been removed (no-op).
 */
export function removeTrainingDummy(world: GameWorld, eid: number): void {
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
        if (Array.isArray(o.material)) {
          o.material.forEach((m) => m.dispose());
        } else {
          o.material.dispose();
        }
      }
    });
    meshRegistry.delete(eid);
  }
  hitboxColliderRegistry.delete(eid);
  removeFSM(eid);
  npcRegistry.delete(eid);
  npcLastHitTick.delete(eid);
  weaponBoneMap.delete(eid);

  removeEntity(world.ecs, eid);
}

/**
 * Reset every training dummy in the world to full HP / stamina / Idle.
 *
 * Iterates `defineQuery([IsTrainingDummy])` — pulling the tag off an entity
 * is enough to exclude it from this reset (proves the spec's tag-based
 * filter, not a hardcoded list).
 */
export function resetAllTrainingDummies(_world: GameWorld): void {
  const eids = trainingDummyQuery(_world.ecs);
  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i];
    Health.current[eid] = Health.max[eid];
    Stamina.current[eid] = Stamina.max[eid];
    // Reset the FSM through its public API so internal counters
    // (ticksRemaining, combo buffer, etc.) stay consistent — bypassing
    // the FSM here would desync `fsmRegistry` from `CombatStateComponent`.
    const fsm = fsmRegistry.get(eid);
    if (fsm) fsm.reset();
    CombatStateComponent.state[eid] = CombatState.Idle;
    CombatStateComponent.ticksRemaining[eid] = 0;
    npcLastHitTick.set(eid, getCurrentFixedTick() - HEALTH_RESET_TICKS);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Debug controls (T / Y / J — preserved from the legacy factory)
 * ──────────────────────────────────────────────────────────────────────── */

// FSM v2 (#139): the unified `Direction` enum has 4 values
// (Overhead, Left, Right, Stab). The cycle order is preserved from v1
// (Top→Bottom→Left→Right) by mapping Top→Overhead and Bottom→Stab,
// since the v1 `Bottom` block pose was reused as the new Stab block pose
// in `AnimationData.ts`/`ViewmodelAnimationData.ts`.
const BLOCK_DIRECTIONS = [
  Direction.Overhead,
  Direction.Stab,
  Direction.Left,
  Direction.Right,
] as const;

const BLOCK_DIR_NAMES: Record<number, string> = {
  [Direction.Overhead]: 'Overhead',
  [Direction.Stab]: 'Stab',
  [Direction.Left]: 'Left',
  [Direction.Right]: 'Right',
};

/**
 * Toggle block state for all training dummies via the FSM transition API.
 *
 * Going OFF block → `ReleaseBlock`; going ON block → `Block`. Per FSM v2
 * (#135) the parry window is now an internal `parryActive` flag inside the
 * single `Blocking` state — there's no separate `ParryWindow` state to
 * pass through anymore. Syncs the FSM's state back onto
 * `CombatStateComponent` immediately so callers don't have to wait for
 * the next `CombatSystem` tick. Returns description of the new state for
 * HUD feedback.
 */
export function toggleTrainingDummyBlock(world: GameWorld): string {
  const eids = trainingDummyQuery(world.ecs);
  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i];
    const fsm = fsmRegistry.get(eid);
    if (!fsm) continue;

    const currentState = fsm.state;
    const blockDir = CombatStateComponent.blockDirection[eid] as Direction;
    if (currentState === CombatState.Blocking) {
      fsm.transition(CombatInput.ReleaseBlock);
    } else if (currentState === CombatState.Idle) {
      fsm.transition(CombatInput.Block, blockDir);
    }
    // Other states (Windup/Recovery/HitStun/etc.) — toggle is a no-op,
    // matching the FSM's `canTransition` rules.

    // Mirror FSM state onto the component immediately so callers and HUD
    // see the change this frame.
    CombatStateComponent.state[eid] = fsm.state;
    CombatStateComponent.ticksRemaining[eid] = fsm.ticksRemaining;
    CombatStateComponent.blockDirection[eid] = fsm.direction;
  }
  if (eids.length === 0) return 'No dummies';
  const firstEid = eids[0];
  const firstFsm = fsmRegistry.get(firstEid);
  const state = firstFsm ? firstFsm.state : CombatState.Idle;
  if (state === CombatState.Blocking) {
    const dir = CombatStateComponent.blockDirection[firstEid];
    return `Block: ${BLOCK_DIR_NAMES[dir] ?? 'Overhead'}`;
  }
  return 'Idle';
}

/**
 * Cycle block direction for all training dummies through the FSM (so
 * CombatSystem's per-tick sync from `fsm.blockDirection →
 * CombatStateComponent` doesn't overwrite the new direction). Returns the
 * new direction name.
 */
export function cycleTrainingDummyBlockDirection(world: GameWorld): string {
  const eids = trainingDummyQuery(world.ecs);
  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i];
    const fsm = fsmRegistry.get(eid);
    if (!fsm) continue;
    const current = fsm.direction;
    const idx = BLOCK_DIRECTIONS.indexOf(current);
    const next = BLOCK_DIRECTIONS[(idx + 1) % BLOCK_DIRECTIONS.length];
    fsm.setBlockDirection(next);
    CombatStateComponent.blockDirection[eid] = next;
  }
  if (eids.length === 0) return 'No dummies';
  const firstEid = eids[0];
  const firstFsm = fsmRegistry.get(firstEid);
  const dir = firstFsm
    ? firstFsm.direction
    : CombatStateComponent.blockDirection[firstEid];
  return BLOCK_DIR_NAMES[dir] ?? 'Overhead';
}

/* ────────────────────────────────────────────────────────────────────────────
 * Auto-regen
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Tick training-dummy health regen. Call once per fixedUpdate.
 *
 * If a dummy hasn't been hit for `HEALTH_RESET_TICKS` ticks, restore HP
 * to max. Reads `getCurrentFixedTick()` so the timer stays in lockstep
 * with every other tick-stamped subsystem (kill attribution window, hit
 * react duration, etc.) — the legacy module-level `dummyTickCounter` is
 * gone.
 */
export function tickTrainingDummyHealthReset(world: GameWorld): void {
  const currentTick = getCurrentFixedTick();
  const eids = trainingDummyQuery(world.ecs);
  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i];
    const lastHit = npcLastHitTick.get(eid) ?? 0;
    if (currentTick - lastHit >= HEALTH_RESET_TICKS) {
      if (Health.current[eid] < Health.max[eid]) {
        Health.current[eid] = Health.max[eid];
      }
    }
  }
}

/**
 * Record that an NPC was hit this tick — used to defer auto-regen on
 * training dummies (and ignored by entities without `IsTrainingDummy`).
 *
 * Renamed from `recordDummyHit` per spec §6 to make it clear that this
 * is a generic NPC hit recorder; bots will use this same function (their
 * regen branch in `tickTrainingDummyHealthReset` is gated by the
 * `IsTrainingDummy` query, so recording a hit on a bot is harmless).
 */
export function recordNpcHit(eid: number): void {
  npcLastHitTick.set(eid, getCurrentFixedTick());
}

/* ────────────────────────────────────────────────────────────────────────────
 * Iteration helpers (consumers should prefer the queries directly, but
 * these short-hand wrappers keep call sites readable)
 * ──────────────────────────────────────────────────────────────────────── */

/** Query-based iteration of every entity tagged `IsTrainingDummy`. */
export function getTrainingDummyEids(world: GameWorld): number[] {
  return Array.from(trainingDummyQuery(world.ecs));
}

/** Query-based iteration of every entity tagged `IsNPC`. */
export function getNpcEids(world: GameWorld): number[] {
  return Array.from(npcQuery(world.ecs));
}

/** Predicate — `true` iff `eid` carries the `IsNPC` tag. */
export function isNpc(world: GameWorld, eid: number): boolean {
  return hasComponent(world.ecs, IsNPC, eid);
}

/** Predicate — `true` iff `eid` carries the `IsTrainingDummy` tag. */
export function isTrainingDummy(world: GameWorld, eid: number): boolean {
  return hasComponent(world.ecs, IsTrainingDummy, eid);
}
