import { addEntity, addComponent, removeEntity } from 'bitecs';
import {
  Position,
  Rotation,
  Velocity,
  CharacterModel,
  Health,
  Stamina,
  Hitboxes,
  CombatStateComp,
  CombatStateComponent,
  AnimationComp,
  meshRegistry,
  hitboxColliderRegistry,
} from '../components';
import { createCharacterModel } from '../../rendering/CharacterModel';
import { createHitboxes } from '../systems/HitboxSystem';
import { CombatState } from '../../combat/states';
import { BlockDirection } from '../../combat/directions';
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
 * @returns entity ID
 */
export function createDummy(
  world: GameWorld,
  x = 0,
  y = 0,
  z = -3,
  color = 0xcc4444,
): number {
  const eid = addEntity(world.ecs);

  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, Rotation, eid);
  addComponent(world.ecs, CharacterModel, eid);
  addComponent(world.ecs, Health, eid);
  addComponent(world.ecs, Stamina, eid);
  addComponent(world.ecs, Hitboxes, eid);
  addComponent(world.ecs, Velocity, eid);
  addComponent(world.ecs, CombatStateComp, eid);
  addComponent(world.ecs, CombatStateComponent, eid);
  addComponent(world.ecs, AnimationComp, eid);

  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;

  // Face toward +Z (player spawn at z=0)
  Rotation.y[eid] = Math.PI;

  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;

  // Start in Idle state
  CombatStateComponent.state[eid] = CombatState.Idle;
  CombatStateComponent.blockDirection[eid] = BlockDirection.Top;
  CombatStateComponent.ticksRemaining[eid] = 0;
  CombatStateComponent.weaponId[eid] = 0;

  const { group, skeleton, bones } = createCharacterModel(color);
  group.position.set(x, y, z);
  group.rotation.y = Math.PI; // face player
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, { group, skeleton, bones });

  world.scene.add(group);
  createHitboxes(world, eid, skeleton, bones);

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
 * Toggle block state for all dummies.
 * Returns description of new state.
 */
export function toggleDummyBlock(): string {
  for (const eid of activeDummies) {
    const currentState = CombatStateComponent.state[eid] as CombatState;
    if (currentState === CombatState.Block || currentState === CombatState.ParryWindow) {
      CombatStateComponent.state[eid] = CombatState.Idle;
    } else {
      CombatStateComponent.state[eid] = CombatState.Block;
    }
  }
  if (activeDummies.length === 0) return 'No dummies';
  const state = CombatStateComponent.state[activeDummies[0]] as CombatState;
  if (state === CombatState.Block) {
    const dir = CombatStateComponent.blockDirection[activeDummies[0]];
    return `Block: ${BLOCK_DIR_NAMES[dir] ?? 'Top'}`;
  }
  return 'Idle';
}

/**
 * Cycle block direction for all dummies.
 * Returns the new direction name.
 */
export function cycleDummyBlockDirection(): string {
  for (const eid of activeDummies) {
    const current = CombatStateComponent.blockDirection[eid];
    const idx = BLOCK_DIRECTIONS.indexOf(current as BlockDirection);
    const next = BLOCK_DIRECTIONS[(idx + 1) % BLOCK_DIRECTIONS.length];
    CombatStateComponent.blockDirection[eid] = next;
  }
  if (activeDummies.length === 0) return 'No dummies';
  const dir = CombatStateComponent.blockDirection[activeDummies[0]];
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
