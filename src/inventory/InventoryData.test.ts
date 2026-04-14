import { describe, it, expect, beforeEach } from 'vitest';
import {
  initInventory,
  getInventory,
  addWeapon,
  equipWeapon,
  clearAllInventories,
} from './InventoryData';

describe('InventoryData', () => {
  beforeEach(() => {
    clearAllInventories();
  });

  it('initializes inventory with default weapon', () => {
    initInventory(1, 'Longsword');
    const inv = getInventory(1);
    expect(inv).toBeDefined();
    expect(inv!.weapons).toEqual(['Longsword']);
    expect(inv!.equippedWeapon).toBe('Longsword');
  });

  it('returns undefined for uninitialized entity', () => {
    expect(getInventory(999)).toBeUndefined();
  });

  it('returns a copy — mutations do not affect internal state', () => {
    initInventory(1, 'Longsword');
    const inv = getInventory(1)!;
    inv.weapons.push('Hacked');
    expect(getInventory(1)!.weapons).toEqual(['Longsword']);
  });

  it('adds a weapon to inventory', () => {
    initInventory(1, 'Longsword');
    expect(addWeapon(1, 'Mace')).toBe(true);
    expect(getInventory(1)!.weapons).toEqual(['Longsword', 'Mace']);
  });

  it('does not add duplicate weapon', () => {
    initInventory(1, 'Longsword');
    expect(addWeapon(1, 'Longsword')).toBe(false);
    expect(getInventory(1)!.weapons).toEqual(['Longsword']);
  });

  it('returns false when adding to uninitialized entity', () => {
    expect(addWeapon(999, 'Longsword')).toBe(false);
  });

  it('equips an owned weapon', () => {
    initInventory(1, 'Longsword');
    addWeapon(1, 'Mace');
    expect(equipWeapon(1, 'Mace')).toBe(true);
    expect(getInventory(1)!.equippedWeapon).toBe('Mace');
  });

  it('does not equip a weapon not owned', () => {
    initInventory(1, 'Longsword');
    expect(equipWeapon(1, 'Mace')).toBe(false);
    expect(getInventory(1)!.equippedWeapon).toBe('Longsword');
  });

  it('returns false when equipping on uninitialized entity', () => {
    expect(equipWeapon(999, 'Longsword')).toBe(false);
  });

  it('clearAllInventories removes all data', () => {
    initInventory(1, 'Longsword');
    initInventory(2, 'Mace');
    clearAllInventories();
    expect(getInventory(1)).toBeUndefined();
    expect(getInventory(2)).toBeUndefined();
  });
});
