import { addEntity, addComponent } from 'bitecs';
import {
  Position,
  Rotation,
  Velocity,
  CharacterModel,
  Health,
  Hitboxes,
  Stamina,
  CombatStateComp,
  CombatStateComponent,
  AnimationComp,
  meshRegistry,
} from '../components';
import { createCharacterModel } from '../../rendering/CharacterModel';
import { createHitboxes } from '../systems/HitboxSystem';
import type { GameWorld } from '../../core/types';

/**
 * Create a training dummy entity — same mesh as player but no input/stamina.
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
  addComponent(world.ecs, Hitboxes, eid);
  addComponent(world.ecs, Velocity, eid);
  addComponent(world.ecs, Stamina, eid);
  addComponent(world.ecs, CombatStateComp, eid);
  addComponent(world.ecs, CombatStateComponent, eid);
  addComponent(world.ecs, AnimationComp, eid);

  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;
  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;
  CombatStateComponent.state[eid] = 0; // Idle
  CombatStateComponent.ticksRemaining[eid] = 0;
  CombatStateComponent.weaponId[eid] = 0;

  const { group, skeleton, bones } = createCharacterModel(color);
  group.position.set(x, y, z);
  CharacterModel.id[eid] = eid;
  meshRegistry.set(eid, { group, skeleton, bones });

  world.scene.add(group);
  createHitboxes(world, eid, skeleton, bones);

  return eid;
}
