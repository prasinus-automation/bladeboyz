import { describe, it, expect } from 'vitest';
import { weaponIdToName } from '../systems/CombatSystem';
import { weaponModelFactories } from '../../rendering/WeaponModels';

/**
 * Tests for createPlayer configuration.
 *
 * Note: createPlayer itself requires Rapier WASM + Three.js scene, so we test
 * the weapon default and lookup logic used by createPlayer separately.
 */

describe('createPlayer defaults', () => {
  it('Dagger is at index 2 in weaponIdToName', () => {
    expect(weaponIdToName.indexOf('Dagger')).toBe(2);
  });

  it('weaponIdToName contains all 4 weapons', () => {
    expect(weaponIdToName).toEqual(['Longsword', 'Mace', 'Dagger', 'Battleaxe']);
  });

  it('all weapons have model factories registered in WeaponModels', () => {
    for (const name of weaponIdToName) {
      expect(weaponModelFactories[name]).toBeDefined();
      expect(typeof weaponModelFactories[name]).toBe('function');
    }
  });

  it('Dagger factory produces a model with group and tracerPoints', () => {
    const model = weaponModelFactories['Dagger']();
    expect(model.group).toBeDefined();
    expect(model.tracerPoints).toBeDefined();
    expect(model.tracerPoints.length).toBeGreaterThan(0);
  });
});
