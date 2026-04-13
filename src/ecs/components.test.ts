import { describe, it, expect } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import {
  Position,
  Rotation,
  Velocity,
  CharacterModel,
  Hitboxes,
  Health,
  Stamina,
  IsPlayer,
  BodyRegion,
  meshRegistry,
  hitboxColliderRegistry,
} from './components';

describe('ECS Components', () => {
  it('can create Position component on entity', () => {
    const world = createWorld();
    const eid = addEntity(world);
    addComponent(world, Position, eid);
    Position.x[eid] = 1.5;
    Position.y[eid] = 2.0;
    Position.z[eid] = -3.0;
    expect(Position.x[eid]).toBeCloseTo(1.5);
    expect(Position.y[eid]).toBeCloseTo(2.0);
    expect(Position.z[eid]).toBeCloseTo(-3.0);
  });

  it('can create Hitboxes component with region handles', () => {
    const world = createWorld();
    const eid = addEntity(world);
    addComponent(world, Hitboxes, eid);
    Hitboxes.head[eid] = 42;
    Hitboxes.torso[eid] = 43;
    expect(Hitboxes.head[eid]).toBe(42);
    expect(Hitboxes.torso[eid]).toBe(43);
  });

  it('BodyRegion enum has correct values', () => {
    expect(BodyRegion.Head).toBe(0);
    expect(BodyRegion.Torso).toBe(1);
    expect(BodyRegion.ArmLeft).toBe(2);
    expect(BodyRegion.ArmRight).toBe(3);
    expect(BodyRegion.LegLeft).toBe(4);
    expect(BodyRegion.LegRight).toBe(5);
  });

  it('registries are Maps', () => {
    expect(meshRegistry).toBeInstanceOf(Map);
    expect(hitboxColliderRegistry).toBeInstanceOf(Map);
  });

  it('Health and Stamina components store current and max', () => {
    const world = createWorld();
    const eid = addEntity(world);
    addComponent(world, Health, eid);
    addComponent(world, Stamina, eid);
    Health.current[eid] = 80;
    Health.max[eid] = 100;
    Stamina.current[eid] = 50;
    Stamina.max[eid] = 100;
    expect(Health.current[eid]).toBeCloseTo(80);
    expect(Stamina.current[eid]).toBeCloseTo(50);
  });
});
