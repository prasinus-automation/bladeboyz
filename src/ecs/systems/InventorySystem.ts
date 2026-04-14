/**
 * InventorySystem — manages per-entity weapon inventory and equipment.
 *
 * Uses the side-table pattern (Map<entityId, InventoryData>) since bitECS
 * components only support numeric values.
 *
 * equipWeapon() is the central function — it validates, swaps the 3D model
 * on weapon_attach bone, updates FSM config, and syncs the ECS component.
 */

import { CombatState } from '../../combat/states';
import { fsmRegistry } from '../../combat/CombatFSM';
import { weaponConfigs } from '../../weapons/WeaponConfig';
import { CombatStateComponent, meshRegistry } from '../components';
import { weaponIdToName } from './CombatSystem';

// ── Types ───────────────────────────────────────────────

export interface InventoryData {
  /** Weapon names available in this entity's inventory */
  weapons: string[];
  /** Currently equipped weapon name, or null if unarmed */
  equippedWeapon: string | null;
}

/** Event emitted when a weapon is equipped */
export interface EquipEvent {
  entityId: number;
  weaponName: string;
  previousWeapon: string | null;
}

// ── Weapon model factory registry ───────────────────────

/**
 * Registry of weapon model factory functions.
 * Each factory returns a Three.js Group (the weapon mesh).
 * Register factories via registerWeaponModelFactory().
 */
export const weaponModelFactories: Record<string, () => { group: import('three').Group }> = {};

/** Register a weapon model factory */
export function registerWeaponModelFactory(
  name: string,
  factory: () => { group: import('three').Group },
): void {
  weaponModelFactories[name] = factory;
}

// ── Inventory Registry (side-table) ─────────────────────

/** Map<entityId, InventoryData> — per-entity inventory data */
export const inventoryRegistry = new Map<number, InventoryData>();

// ── Equip event listeners ───────────────────────────────

type EquipListener = (event: EquipEvent) => void;
const equipListeners: EquipListener[] = [];

/** Subscribe to equip events (for HUD notifications, etc.) */
export function onEquip(listener: EquipListener): void {
  equipListeners.push(listener);
}

/** Remove an equip listener */
export function offEquip(listener: EquipListener): void {
  const idx = equipListeners.indexOf(listener);
  if (idx >= 0) equipListeners.splice(idx, 1);
}

/** Emit an equip event to all listeners */
function emitEquipEvent(event: EquipEvent): void {
  for (const listener of equipListeners) {
    listener(event);
  }
}

// ── Core functions ──────────────────────────────────────

/**
 * Initialize inventory for an entity.
 * @param entityId - The ECS entity ID
 * @param weapons - Array of weapon names available
 * @param equippedWeapon - Initially equipped weapon name (or null)
 */
export function initInventory(
  entityId: number,
  weapons: string[],
  equippedWeapon: string | null = null,
): void {
  inventoryRegistry.set(entityId, {
    weapons: [...weapons],
    equippedWeapon,
  });
}

/**
 * Get a read-only copy of an entity's inventory.
 * Returns null if entity has no inventory.
 */
export function getInventory(entityId: number): InventoryData | null {
  const data = inventoryRegistry.get(entityId);
  if (!data) return null;
  return {
    weapons: [...data.weapons],
    equippedWeapon: data.equippedWeapon,
  };
}

/**
 * Equip a weapon on an entity.
 *
 * Validates the weapon is in inventory, entity is in Idle state,
 * then swaps the 3D model on weapon_attach bone, updates FSM config,
 * and syncs CombatStateComponent.weaponId.
 *
 * @returns true if weapon was equipped, false if rejected
 */
export function equipWeapon(entityId: number, weaponName: string): boolean {
  // 1. Validate weapon exists in registry
  const config = weaponConfigs[weaponName];
  if (!config) {
    console.warn(`equipWeapon: unknown weapon "${weaponName}"`);
    return false;
  }

  // 2. Validate weapon is in entity's inventory
  const inventory = inventoryRegistry.get(entityId);
  if (!inventory) {
    console.warn(`equipWeapon: entity ${entityId} has no inventory`);
    return false;
  }
  if (!inventory.weapons.includes(weaponName)) {
    console.warn(`equipWeapon: weapon "${weaponName}" not in entity ${entityId}'s inventory`);
    return false;
  }

  // 3. Check FSM is in Idle state (reject equip during combat)
  const fsm = fsmRegistry.get(entityId);
  if (fsm && fsm.state !== CombatState.Idle) {
    console.warn(`equipWeapon: entity ${entityId} is not idle (state=${fsm.state}), cannot equip`);
    return false;
  }

  // 4. Skip if already equipped
  if (inventory.equippedWeapon === weaponName) {
    return true;
  }

  const previousWeapon = inventory.equippedWeapon;

  // 5. Swap 3D model on weapon_attach bone
  const meshData = meshRegistry.get(entityId);
  if (meshData) {
    const weaponBone = meshData.bones['weapon_attach'];
    if (weaponBone) {
      // Remove old weapon children
      while (weaponBone.children.length > 0) {
        weaponBone.remove(weaponBone.children[0]);
      }

      // Attach new weapon model
      const factory = weaponModelFactories[weaponName];
      if (factory) {
        const { group } = factory();
        weaponBone.add(group);
      }
    }
  }

  // 6. Update FSM config
  if (fsm) {
    fsm.setWeaponConfig(config);
  }

  // 7. Update CombatStateComponent.weaponId
  const weaponIndex = weaponIdToName.indexOf(weaponName);
  if (weaponIndex >= 0) {
    CombatStateComponent.weaponId[entityId] = weaponIndex;
  }

  // 8. Update inventory state
  inventory.equippedWeapon = weaponName;

  // 9. Emit equip event
  emitEquipEvent({
    entityId,
    weaponName,
    previousWeapon,
  });

  return true;
}

/**
 * Add a weapon to an entity's inventory.
 * @returns true if added, false if already present or no inventory
 */
export function addWeaponToInventory(entityId: number, weaponName: string): boolean {
  const inventory = inventoryRegistry.get(entityId);
  if (!inventory) return false;
  if (inventory.weapons.includes(weaponName)) return false;
  inventory.weapons.push(weaponName);
  return true;
}

/**
 * Remove a weapon from an entity's inventory.
 * If the weapon is currently equipped, it will be unequipped first.
 * @returns true if removed, false if not found
 */
export function removeWeaponFromInventory(entityId: number, weaponName: string): boolean {
  const inventory = inventoryRegistry.get(entityId);
  if (!inventory) return false;
  const idx = inventory.weapons.indexOf(weaponName);
  if (idx < 0) return false;
  inventory.weapons.splice(idx, 1);
  if (inventory.equippedWeapon === weaponName) {
    inventory.equippedWeapon = null;
  }
  return true;
}

/**
 * Reset all inventory state (for testing).
 */
export function resetInventorySystem(): void {
  inventoryRegistry.clear();
  equipListeners.length = 0;
}
