import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { pickupRegistry, resetPickupRegistry, type PickupData } from './PickupRegistry';

describe('PickupRegistry', () => {
  beforeEach(() => {
    resetPickupRegistry();
  });

  it('starts empty (after reset)', () => {
    expect(pickupRegistry.size).toBe(0);
  });

  it('stores PickupData by entity id', () => {
    const data: PickupData = {
      weaponName: 'Mace',
      group: new THREE.Group(),
      materials: [new THREE.MeshStandardMaterial()],
    };
    pickupRegistry.set(42, data);
    expect(pickupRegistry.get(42)).toBe(data);
    expect(pickupRegistry.has(42)).toBe(true);
  });

  it('resetPickupRegistry clears all entries', () => {
    pickupRegistry.set(1, {
      weaponName: 'Dagger',
      group: new THREE.Group(),
      materials: [],
    });
    pickupRegistry.set(2, {
      weaponName: 'Longsword',
      group: new THREE.Group(),
      materials: [],
    });
    expect(pickupRegistry.size).toBe(2);
    resetPickupRegistry();
    expect(pickupRegistry.size).toBe(0);
  });
});
