import { describe, it, expect } from 'vitest';
import { createWorld, addEntity, addComponent, defineQuery } from 'bitecs';
import { CombatStateComponent, TracerTag, Hitboxes } from '../components';

/**
 * Tests verifying damage pipeline wiring prerequisites:
 * - TracerTag + CombatStateComponent query returns entities (was empty before fix)
 * - Hitboxes component can be added to entities
 */

describe('Damage pipeline wiring', () => {
  it('tracerQuery finds entities with both CombatStateComponent and TracerTag', () => {
    const world = createWorld();
    const eid = addEntity(world);
    addComponent(world, CombatStateComponent, eid);
    addComponent(world, TracerTag, eid);

    const query = defineQuery([CombatStateComponent, TracerTag]);
    const results = query(world);
    expect(results).toContain(eid);
  });

  it('entity without TracerTag is NOT found by tracer query', () => {
    const world = createWorld();
    const eid = addEntity(world);
    addComponent(world, CombatStateComponent, eid);
    // No TracerTag added

    const query = defineQuery([CombatStateComponent, TracerTag]);
    const results = query(world);
    expect(results).not.toContain(eid);
  });

  it('Hitboxes component can be added to an entity', () => {
    const world = createWorld();
    const eid = addEntity(world);
    addComponent(world, Hitboxes, eid);

    // Verify the component fields exist and default to 0
    expect(Hitboxes.head[eid]).toBe(0);
    expect(Hitboxes.torso[eid]).toBe(0);
  });

  it('player-like entity has all damage pipeline components', () => {
    const world = createWorld();
    const eid = addEntity(world);
    addComponent(world, CombatStateComponent, eid);
    addComponent(world, TracerTag, eid);
    addComponent(world, Hitboxes, eid);

    // Should be found by tracer query
    const query = defineQuery([CombatStateComponent, TracerTag]);
    expect(query(world)).toContain(eid);
  });
});
