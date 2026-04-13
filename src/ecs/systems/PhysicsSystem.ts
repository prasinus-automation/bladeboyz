import { defineQuery } from 'bitecs';
import { Position, Rotation, Velocity } from '../components';
import type { World } from '../../core/World';

/**
 * Query for entities that have physics-relevant components.
 * In future this will sync Rapier rigid bodies ↔ ECS components.
 */
const physicsQuery = defineQuery([Position, Rotation, Velocity]);

/**
 * PhysicsSystem — steps the Rapier world and syncs body positions
 * to/from ECS components.
 *
 * Stub implementation for scaffolding phase.
 */
export function PhysicsSystem(world: World, dt: number): void {
  // Step the physics simulation
  world.rapierWorld.step();

  // TODO: Sync Rapier rigid body positions → ECS Position/Rotation components
  // TODO: Sync ECS Velocity → Rapier rigid body velocities (for player-controlled entities)
  const entities = physicsQuery(world.ecs);
  for (let i = 0; i < entities.length; i++) {
    const _eid = entities[i];
    // Will be implemented when entities have associated Rapier bodies
    // For now, this is a no-op placeholder
  }

  void dt; // Will be used for interpolation in future
}
