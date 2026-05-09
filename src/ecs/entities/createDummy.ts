import { addEntity, addComponent, removeEntity } from 'bitecs';
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
  meshRegistry,
  hitboxColliderRegistry,
  TracerTag,
} from '../components';
import { createCharacterModel } from '../../rendering/CharacterModel';
import { createHitboxes } from '../systems/HitboxSystem';
import { weaponBoneMap } from '../systems/TracerSystem';
import { spawnAtGround } from '../utils/spawnAtGround';
import { CombatState } from '../../combat/states';
import { BlockDirection } from '../../combat/directions';
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from '../../core/types';
import { CombatInput, createFSM, fsmRegistry, removeFSM } from '../../combat/CombatFSM';
import { weaponConfigs } from '../../weapons/WeaponConfig';
import { weaponIdToName } from '../systems/CombatSystem';
import type { GameWorld } from '../../core/types';

/** Track all active dummy entity IDs */
export const activeDummies: number[] = [];

/** Ticks since each dummy was last hit (for health regen) */
export const dummyLastHitTick: Map<number, number> = new Map();

/** Global tick counter for dummy health reset timing */
export let dummyTickCounter = 0;

/** Ticks of no-hit before health resets (3s at 60Hz) */
const HEALTH_RESET_TICKS = 180;

/**
 * Create a training dummy entity with full character model, hitboxes,
 * combat state, health, and stamina. Faces toward +Z (player spawn).
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
 * A `CombatFSM` is registered for the dummy so `CombatSystem` will tick
 * its state every fixed update — `phaseElapsed/phaseTotal/phaseT` populate
 * during combat phases just like for the player. Dummies don't read
 * input, so their FSM stays in `Idle` until something external (a parry
 * trigger, `toggleDummyBlock`, etc.) drives a transition.
 *
 * @returns entity ID
 */
export function createDummy(
  world: GameWorld,
  x = 0,
  z = -3,
  color = 0xcc4444,
  yOverride?: number,
  startingWeapon = 'Dagger',
): number {
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

  // Resolve feet Y (raycast unless explicit override)
  const feetY =
    typeof yOverride === 'number' ? yOverride : spawnAtGround(world, x, z).y;

  Position.x[eid] = x;
  Position.y[eid] = feetY;
  Position.z[eid] = z;
  PreviousPosition.x[eid] = x;
  PreviousPosition.y[eid] = feetY;
  PreviousPosition.z[eid] = z;

  // Face toward +Z (player spawn at z=0)
  Rotation.y[eid] = Math.PI;
  PreviousRotation.y[eid] = Math.PI;

  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;

  // Start in Idle state
  CombatStateComponent.state[eid] = CombatState.Idle;
  CombatStateComponent.blockDirection[eid] = BlockDirection.Top;
  CombatStateComponent.ticksRemaining[eid] = 0;
  const weaponIndex = weaponIdToName.indexOf(startingWeapon);
  CombatStateComponent.weaponId[eid] = weaponIndex >= 0 ? weaponIndex : 0;

  // Register a CombatFSM so CombatSystem ticks the dummy each fixed update.
  // Falls back to the first registered weapon if `startingWeapon` is unknown,
  // which keeps tests/factories that pass in test-only weapon names happy.
  const dummyWeapon =
    weaponConfigs[startingWeapon] ?? Object.values(weaponConfigs)[0];
  if (dummyWeapon) {
    createFSM(eid, dummyWeapon);
  }

  // Fixed-body capsule collider. Same offset convention as the player so
  // the body origin (Position) is at feet. Without a body the dummy would
  // float wherever Position.y was set (the bug from the AGENTS.md "Hover
  // Bug" entry — issue #86 / #104).
  const bodyDesc = world.rapier.RigidBodyDesc.fixed().setTranslation(x, feetY, z);
  const body = world.physicsWorld.createRigidBody(bodyDesc);
  const colliderDesc = world.rapier.ColliderDesc.capsule(
    CAPSULE_HALF_HEIGHT,
    CAPSULE_RADIUS,
  ).setTranslation(0, CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT, 0);
  const collider = world.physicsWorld.createCollider(colliderDesc, body);
  PhysicsBody.bodyHandle[eid] = body.handle;
  PhysicsBody.colliderHandle[eid] = collider.handle;
  // NOTE: do NOT call registerPhysicsBody — that's for kinematic-controlled
  // entities only (player). Dummies don't move; MovementSystem skips them.

  const { group, skeleton, bones } = createCharacterModel(color);
  group.position.set(x, feetY, z);
  group.rotation.y = Math.PI; // face player
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, { group, skeleton, bones });

  world.scene.add(group);
  createHitboxes(world, eid, skeleton, bones);

  // Register weapon bone for tracer system (even though dummies don't attack yet)
  const weaponBone = bones['weapon_attach'];
  if (weaponBone) weaponBoneMap.set(eid, weaponBone);

  activeDummies.push(eid);
  dummyLastHitTick.set(eid, -HEALTH_RESET_TICKS); // allow immediate regen

  return eid;
}

/**
 * Remove a dummy entity and clean up its resources.
 */
export function removeDummy(world: GameWorld, eid: number): void {
  const modelData = meshRegistry.get(eid);
  if (modelData) {
    world.scene.remove(modelData.group);
    modelData.group.traverse((obj) => {
      if ((obj as any).geometry) (obj as any).geometry.dispose();
      if ((obj as any).material) {
        const mat = (obj as any).material;
        if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose());
        else mat.dispose();
      }
    });
    meshRegistry.delete(eid);
  }
  hitboxColliderRegistry.delete(eid);
  removeFSM(eid);

  const idx = activeDummies.indexOf(eid);
  if (idx !== -1) activeDummies.splice(idx, 1);
  dummyLastHitTick.delete(eid);

  removeEntity(world.ecs, eid);
}

/**
 * Reset all dummies to full health in Idle state.
 */
export function resetAllDummies(world: GameWorld): void {
  for (const eid of activeDummies) {
    Health.current[eid] = Health.max[eid];
    Stamina.current[eid] = Stamina.max[eid];
    // Reset the FSM through its public API so internal counters
    // (ticksRemaining, combo buffer, etc.) stay consistent — bypassing
    // the FSM here would desync `fsmRegistry` from `CombatStateComponent`.
    const fsm = fsmRegistry.get(eid);
    if (fsm) fsm.reset();
    CombatStateComponent.state[eid] = CombatState.Idle;
    CombatStateComponent.ticksRemaining[eid] = 0;
    dummyLastHitTick.set(eid, -HEALTH_RESET_TICKS);
  }
}

const BLOCK_DIRECTIONS = [
  BlockDirection.Top,
  BlockDirection.Bottom,
  BlockDirection.Left,
  BlockDirection.Right,
] as const;

const BLOCK_DIR_NAMES: Record<number, string> = {
  [BlockDirection.Top]: 'Top',
  [BlockDirection.Bottom]: 'Bottom',
  [BlockDirection.Left]: 'Left',
  [BlockDirection.Right]: 'Right',
};

/**
 * Toggle block state for all dummies via the FSM transition API.
 * Going OFF block → ReleaseBlock; going ON block → Block (which enters
 * ParryWindow first, exactly like the player). Syncs the FSM's state
 * back onto `CombatStateComponent` immediately so callers don't have
 * to wait for the next `CombatSystem` tick. Returns description of the
 * new state for HUD feedback.
 */
export function toggleDummyBlock(): string {
  for (const eid of activeDummies) {
    const fsm = fsmRegistry.get(eid);
    if (!fsm) continue;

    const currentState = fsm.state;
    const blockDir = CombatStateComponent.blockDirection[eid] as BlockDirection;
    if (currentState === CombatState.Blocking) {
      // FSM v2 (#135): single Blocking state absorbs old Block + ParryWindow.
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
    CombatStateComponent.blockDirection[eid] = fsm.blockDirection;
  }
  if (activeDummies.length === 0) return 'No dummies';
  const firstFsm = fsmRegistry.get(activeDummies[0]);
  const state = firstFsm ? firstFsm.state : CombatState.Idle;
  if (state === CombatState.Blocking) {
    const dir = CombatStateComponent.blockDirection[activeDummies[0]];
    return `Block: ${BLOCK_DIR_NAMES[dir] ?? 'Top'}`;
  }
  return 'Idle';
}

/**
 * Cycle block direction for all dummies through the FSM (so CombatSystem's
 * per-tick sync from `fsm.blockDirection → CombatStateComponent` doesn't
 * overwrite the new direction). Returns the new direction name.
 */
export function cycleDummyBlockDirection(): string {
  for (const eid of activeDummies) {
    const fsm = fsmRegistry.get(eid);
    if (!fsm) continue;
    const current = fsm.blockDirection;
    const idx = BLOCK_DIRECTIONS.indexOf(current);
    const next = BLOCK_DIRECTIONS[(idx + 1) % BLOCK_DIRECTIONS.length];
    fsm.setBlockDirection(next);
    CombatStateComponent.blockDirection[eid] = next;
  }
  if (activeDummies.length === 0) return 'No dummies';
  const firstFsm = fsmRegistry.get(activeDummies[0]);
  const dir = firstFsm
    ? firstFsm.blockDirection
    : CombatStateComponent.blockDirection[activeDummies[0]];
  return BLOCK_DIR_NAMES[dir] ?? 'Top';
}

/**
 * Tick dummy health reset logic. Call each fixedUpdate.
 * If a dummy hasn't been hit for 3 seconds, reset health to max.
 */
export function tickDummyHealthReset(): void {
  dummyTickCounter++;
  for (const eid of activeDummies) {
    const lastHit = dummyLastHitTick.get(eid) ?? 0;
    if (dummyTickCounter - lastHit >= HEALTH_RESET_TICKS) {
      if (Health.current[eid] < Health.max[eid]) {
        Health.current[eid] = Health.max[eid];
      }
    }
  }
}

/**
 * Record that a dummy was hit this tick.
 */
export function recordDummyHit(eid: number): void {
  dummyLastHitTick.set(eid, dummyTickCounter);
}
