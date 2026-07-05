/**
 * Prices — economy side-table mapping weapon names to gold cost.
 *
 * Why a side-table (not a `cost` field on `WeaponConfig`):
 *   - Keeps weapon configs pure-combat data (damage, timing, tracer geometry).
 *   - Economy concerns live in `src/economy/` and stay swappable when the full
 *     gold currency design (#95) lands.
 *
 * Adding a new weapon? Add an entry here too — `getWeaponPrice` returns
 * `undefined` for any weapon without a price (treat as not-for-sale).
 */

/** Gold cost per weapon. Dagger is the free starter weapon. */
export const weaponPrices: Record<string, number> = {
  Dagger: 0,
  Mace: 100,
  Longsword: 150,
  Battleaxe: 200,
  Spear: 250,
  Katana: 275,
  Rapier: 275,
  Zweihander: 300,
  Scythe: 325,
  Warhammer: 350,
  Halberd: 400,
  // Premium pricing for premium physics.
  Yeeter: 500,
};

/**
 * Look up a weapon's price by name.
 * @returns the gold cost, or `undefined` if the weapon is not for sale.
 */
export function getWeaponPrice(name: string): number | undefined {
  return weaponPrices[name];
}
