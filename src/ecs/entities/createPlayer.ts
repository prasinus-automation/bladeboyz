import { addEntity, addComponent } from 'bitecs';
import {
  Position,
  Rotation,
  Velocity,
  CharacterModel,
  Health,
  Stamina,
  Hitboxes,
  IsPlayer,
  meshRegistry,
} from '../components';
import { createCharacterModel, createLongswordModel } from '../../rendering/CharacterModel';
import { createHitboxes } from '../systems/HitboxSystem';
import type { GameWorld } from '../../core/types';

/**
 * Create a full player entity with:
 * - Position, Rotation, Velocity
 * - CharacterModel (procedural mesh + skeleton)
 * - Hitboxes (Rapier sensor colliders)
 * - Health, Stamina
 * - IsPlayer tag
 *
 * @returns entity ID
 */
export function createPlayer(world: GameWorld, color?: number): number {
  const eid = addEntity(world.ecs);

  // Add basic components
  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, Rotation, eid);
  addComponent(world.ecs, Velocity, eid);
  addComponent(world.ecs, Health, eid);
  addComponent(world.ecs, Stamina, eid);
  addComponent(world.ecs, IsPlayer, eid);
  addComponent(world.ecs, CharacterModel, eid);
  addComponent(world.ecs, Hitboxes, eid);

  // Set initial values
  Position.x[eid] = 0;
  Position.y[eid] = 0;
  Position.z[eid] = 0;
  Rotation.x[eid] = 0;
  Rotation.y[eid] = 0;
  Rotation.z[eid] = 0;
  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;

  // Create procedural character model
  const { group, skeleton, bones } = createCharacterModel(color);
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, { group, skeleton, bones });

  // Attach longsword to weapon_attach bone
  const weaponBone = bones['weapon_attach'];
  if (weaponBone) {
    const { group: swordGroup } = createLongswordModel();
    weaponBone.add(swordGroup);
  }

  // Add character model to scene
  world.scene.add(group);

  // Create hitbox sensor colliders
  createHitboxes(world, eid, skeleton, bones);

  return eid;
}
