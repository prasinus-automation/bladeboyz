import { addEntity, addComponent, removeEntity } from 'bitecs';
import {
  Position,
  Rotation,
  CharacterModel,
  meshRegistry,
} from '../components';
import { createCharacterModel } from '../../rendering/CharacterModel';
import { SPAWN_HEIGHT } from '../../core/types';
import type { GameWorld } from '../../core/types';

/**
 * Side-table data for shopkeep entities.
 * `name` is a string, so it can't live on a bitECS component (TypedArrays
 * only). `interactRadius` is here for symmetry / future tunability.
 */
export interface ShopkeepData {
  name: string;
  interactRadius: number;
}

/**
 * Module-level registry mapping shopkeep entity IDs → ShopkeepData.
 * Same pattern as `meshRegistry`, `fsmRegistry`, etc.
 */
export const shopkeepRegistry: Map<number, ShopkeepData> = new Map();

/** Default interaction radius in meters. */
export const DEFAULT_INTERACT_RADIUS = 2.5;

/** Default body color (gold/yellow) — distinguishes shopkeep from dummies (red) and player (blue). */
const SHOPKEEP_COLOR = 0xddaa44;

export interface CreateShopkeepOptions {
  /** Display name for the nameplate. Defaults to 'Shopkeep'. */
  name?: string;
  /** Override the default interaction radius (meters). */
  interactRadius?: number;
}

/**
 * Create a static shopkeep NPC entity.
 *
 * The shopkeep is a non-combatant NPC: only Position, Rotation, and
 * CharacterModel components — no Velocity, Health, Stamina, Hitboxes, or
 * combat state. It's not hittable and doesn't move.
 *
 * Faces toward the arena center (origin) by default.
 *
 * @returns the entity ID
 */
export function createShopkeep(
  world: GameWorld,
  x: number,
  y: number = SPAWN_HEIGHT,
  z: number = 0,
  options: CreateShopkeepOptions = {},
): number {
  const eid = addEntity(world.ecs);

  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, Rotation, eid);
  addComponent(world.ecs, CharacterModel, eid);

  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;

  // Face toward the arena center (origin). Yaw=0 looks down -Z, so the
  // shopkeep yaw is atan2(playerX - x, playerZ - z) where (playerX,playerZ)=(0,0).
  // For the default spawn corner (8, *, 8), this gives a yaw of atan2(-8, -8) = -3π/4
  // which orients the shopkeep facing inward toward origin.
  Rotation.y[eid] = Math.atan2(-x, -z);

  const { group, skeleton, bones } = createCharacterModel(SHOPKEEP_COLOR);
  group.position.set(x, y, z);
  group.rotation.y = Rotation.y[eid];
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, { group, skeleton, bones });

  world.scene.add(group);

  shopkeepRegistry.set(eid, {
    name: options.name ?? 'Shopkeep',
    interactRadius: options.interactRadius ?? DEFAULT_INTERACT_RADIUS,
  });

  return eid;
}

/**
 * Remove a shopkeep entity and clean up its resources.
 * Symmetrical to `removeDummy`.
 */
export function removeShopkeep(world: GameWorld, eid: number): void {
  const modelData = meshRegistry.get(eid);
  if (modelData) {
    world.scene.remove(modelData.group);
    modelData.group.traverse((obj) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = obj as any;
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mat = o.material;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose());
        else mat.dispose();
      }
    });
    meshRegistry.delete(eid);
  }
  shopkeepRegistry.delete(eid);
  removeEntity(world.ecs, eid);
}
