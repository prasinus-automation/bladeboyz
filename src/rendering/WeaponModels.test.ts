import { describe, it, expect } from 'vitest';
import {
  createMaceModel,
  createDaggerModel,
  createBattleaxeModel,
  weaponModelFactories,
} from './WeaponModels';

describe('createMaceModel', () => {
  it('returns group and tracer points', () => {
    const result = createMaceModel();
    expect(result.group).toBeDefined();
    expect(result.tracerPoints).toBeDefined();
  });

  it('has 3 tracer points', () => {
    const { tracerPoints } = createMaceModel();
    expect(tracerPoints).toHaveLength(3);
  });

  it('tracer points are ordered base to tip (increasing Y)', () => {
    const { tracerPoints } = createMaceModel();
    for (let i = 1; i < tracerPoints.length; i++) {
      expect(tracerPoints[i].y).toBeGreaterThan(tracerPoints[i - 1].y);
    }
  });

  it('group has 2 children (handle, head)', () => {
    const { group } = createMaceModel();
    expect(group.children.length).toBe(2);
  });
});

describe('createDaggerModel', () => {
  it('returns group and tracer points', () => {
    const result = createDaggerModel();
    expect(result.group).toBeDefined();
    expect(result.tracerPoints).toBeDefined();
  });

  it('has 2 tracer points', () => {
    const { tracerPoints } = createDaggerModel();
    expect(tracerPoints).toHaveLength(2);
  });

  it('tracer points are ordered base to tip (increasing Y)', () => {
    const { tracerPoints } = createDaggerModel();
    for (let i = 1; i < tracerPoints.length; i++) {
      expect(tracerPoints[i].y).toBeGreaterThan(tracerPoints[i - 1].y);
    }
  });

  it('group has 2 children (grip, blade)', () => {
    const { group } = createDaggerModel();
    expect(group.children.length).toBe(2);
  });
});

describe('createBattleaxeModel', () => {
  it('returns group and tracer points', () => {
    const result = createBattleaxeModel();
    expect(result.group).toBeDefined();
    expect(result.tracerPoints).toBeDefined();
  });

  it('has 4 tracer points', () => {
    const { tracerPoints } = createBattleaxeModel();
    expect(tracerPoints).toHaveLength(4);
  });

  it('tracer points are ordered base to tip (increasing Y)', () => {
    const { tracerPoints } = createBattleaxeModel();
    for (let i = 1; i < tracerPoints.length; i++) {
      expect(tracerPoints[i].y).toBeGreaterThan(tracerPoints[i - 1].y);
    }
  });

  it('group has 2 children (handle, head)', () => {
    const { group } = createBattleaxeModel();
    expect(group.children.length).toBe(2);
  });
});

describe('weaponModelFactories', () => {
  it('contains all 4 weapons', () => {
    expect(Object.keys(weaponModelFactories)).toEqual(
      expect.arrayContaining(['Longsword', 'Mace', 'Dagger', 'Battleaxe']),
    );
  });

  it('has exactly 4 entries', () => {
    expect(Object.keys(weaponModelFactories)).toHaveLength(4);
  });

  it('all factories return valid WeaponModelResult', () => {
    for (const [name, factory] of Object.entries(weaponModelFactories)) {
      const result = factory();
      expect(result.group).toBeDefined();
      expect(result.tracerPoints).toBeDefined();
      expect(result.tracerPoints.length).toBeGreaterThan(0);
    }
  });
});
