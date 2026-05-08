import { describe, it, expect } from 'vitest';
import { weaponPrices, getWeaponPrice } from './Prices';

describe('Prices', () => {
  it('exposes the expected starter price table', () => {
    expect(weaponPrices.Dagger).toBe(0);
    expect(weaponPrices.Mace).toBe(100);
    expect(weaponPrices.Longsword).toBe(150);
    expect(weaponPrices.Battleaxe).toBe(200);
  });

  it('getWeaponPrice returns the price for known weapons', () => {
    expect(getWeaponPrice('Dagger')).toBe(0);
    expect(getWeaponPrice('Mace')).toBe(100);
    expect(getWeaponPrice('Longsword')).toBe(150);
    expect(getWeaponPrice('Battleaxe')).toBe(200);
  });

  it('getWeaponPrice returns undefined for unknown weapons', () => {
    expect(getWeaponPrice('FlamingTrebuchet')).toBeUndefined();
    expect(getWeaponPrice('')).toBeUndefined();
  });
});
