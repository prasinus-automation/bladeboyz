/**
 * InventoryData — minimal inventory data API for the inventory UI.
 *
 * Provides per-entity weapon ownership and equipment tracking.
 * Uses the side-table pattern (Map<eid, data>) since bitECS components
 * can only store numbers.
 *
 * This is a lightweight stand-in until the full InventorySystem (#33) lands.
 */

export interface InventoryState {
  /** Weapon names the entity owns */
  weapons: string[];
  /** Currently equipped weapon name */
  equippedWeapon: string;
}

/** Per-entity inventory side-table */
const inventoryMap = new Map<number, InventoryState>();

/**
 * Initialize inventory for an entity with a default weapon.
 */
export function initInventory(eid: number, defaultWeapon: string): void {
  inventoryMap.set(eid, {
    weapons: [defaultWeapon],
    equippedWeapon: defaultWeapon,
  });
}

/**
 * Get inventory state for an entity.
 * Returns a copy to avoid external mutation.
 */
export function getInventory(eid: number): InventoryState | undefined {
  const inv = inventoryMap.get(eid);
  if (!inv) return undefined;
  return { weapons: [...inv.weapons], equippedWeapon: inv.equippedWeapon };
}

/**
 * Add a weapon to an entity's inventory (if not already owned).
 */
export function addWeapon(eid: number, weaponName: string): boolean {
  const inv = inventoryMap.get(eid);
  if (!inv) return false;
  if (inv.weapons.includes(weaponName)) return false;
  inv.weapons.push(weaponName);
  return true;
}

/**
 * Equip a weapon the entity owns.
 * Returns true if successfully equipped, false if not owned.
 */
export function equipWeapon(eid: number, weaponName: string): boolean {
  const inv = inventoryMap.get(eid);
  if (!inv) return false;
  if (!inv.weapons.includes(weaponName)) return false;
  inv.equippedWeapon = weaponName;
  return true;
}

/**
 * Clear all inventory data (useful for tests).
 */
export function clearAllInventories(): void {
  inventoryMap.clear();
}
