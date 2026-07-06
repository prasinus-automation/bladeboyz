import { addEntity, addComponent, removeEntity } from 'bitecs';
import {
  Position,
  Rotation,
  CharacterModel,
  meshRegistry,
} from '../components';
import { createCharacterModel } from '../../rendering/CharacterModel';
import { spawnAtGround } from '../utils/spawnAtGround';
import { yawTowards } from '../../utils/math';
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
  y?: number,
  z: number = 0,
  options: CreateShopkeepOptions = {},
): number {
  const eid = addEntity(world.ecs);

  // Resolve spawn Y off the ground (matches createPlayer / createTrainingDummy)
  // instead of the deprecated flat `SPAWN_HEIGHT` constant (#206). An explicit
  // `y` still wins — every current caller passes one, so behavior is unchanged.
  const resolvedY = typeof y === 'number' ? y : spawnAtGround(world, x, z).y;

  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, Rotation, eid);
  addComponent(world.ecs, CharacterModel, eid);

  Position.x[eid] = x;
  Position.y[eid] = resolvedY;
  Position.z[eid] = z;

  // Face toward the arena center (origin) under the forward = (-sin yaw,
  // -cos yaw) convention (yaw=0 looks down -Z). `yawTowards(x, z)` = atan2(x, z)
  // orients the shopkeep inward. For the default corner (8, *, 8) this gives
  // atan2(8, 8) = π/4. (The old `atan2(-x, -z)` = -3π/4 was π off and faced the
  // shopkeep AWAY from the arena — fixed in #211/#212.)
  Rotation.y[eid] = yawTowards(x, z);

  const { group, skeleton, bones } = createCharacterModel(SHOPKEEP_COLOR);
  group.position.set(x, resolvedY, z);
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
 * Symmetrical to `removeTrainingDummy`.
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
