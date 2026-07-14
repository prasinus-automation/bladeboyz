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
import { attachThirdPersonWeapon } from '../../rendering/WeaponModels';
import { CombatStateComponent, meshRegistry, Position } from '../components';
import { weaponIdToName } from './CombatSystem';
import { createWeaponPickup } from '../entities/createWeaponPickup';
import { getCurrentFixedTick } from '../../core/tickCounter';
import { DESPAWN_TICKS } from './WeaponPickupSystem';
import { EventBus } from '../../events/EventBus';
import type { GameWorld } from '../../core/types';

// ── Types ───────────────────────────────────────────────

export interface InventoryData {
  /** Weapon names available in this entity's inventory */
  weapons: string[];
  /** Currently equipped weapon name, or null if unarmed */
  equippedWeapon: string | null;
  /**
   * The "permanent" starter weapon that should NOT be dropped on death (#94 / #A2).
   * Defaults to the initially-equipped weapon when not specified at init time —
   * keeps existing callsites backward-compatible. Null means "drop everything"
   * (no protected starter).
   */
  starterWeapon: string | null;
}

/** Event emitted when a weapon is equipped */
export interface EquipEvent {
  entityId: number;
  weaponName: string;
  previousWeapon: string | null;
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
 * @param starterWeapon - The permanent starter weapon (won't be dropped on
 *   death, see #94). Defaults to `equippedWeapon` when omitted, which
 *   preserves the legacy behavior of "the first weapon you spawn with is
 *   yours forever". Pass `null` explicitly for "no protected starter".
 */
export function initInventory(
  entityId: number,
  weapons: string[],
  equippedWeapon: string | null = null,
  starterWeapon?: string | null,
): void {
  inventoryRegistry.set(entityId, {
    weapons: [...weapons],
    equippedWeapon,
    // `starterWeapon` is intentionally `string | null | undefined` at the
    // call boundary so we can distinguish "omitted" (default to
    // equippedWeapon) from "explicit null" (no protected starter).
    starterWeapon: starterWeapon === undefined ? equippedWeapon : starterWeapon,
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
    starterWeapon: data.starterWeapon,
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

  // 5. Swap 3D model on weapon_attach bone.
  //    Route through the SINGLE third-person attach helper so the bone's rest
  //    transform is reset and the per-weapon grip (THIRD_PERSON_GRIPS) is
  //    composed on every swap — otherwise a live weapon change (pickup, shop
  //    purchase, respawn, UI-equip) would leave the bone carrying the PREVIOUS
  //    weapon's grip rotation (#220 blocker). `attachThirdPersonWeapon` also
  //    clears the old model children internally, so this is the exact same path
  //    createPlayer / createWarmupBot / createTrainingDummy / RemotePlayers use.
  const meshData = meshRegistry.get(entityId);
  if (meshData) {
    const weaponBone = meshData.bones['weapon_attach'];
    if (weaponBone) {
      attachThirdPersonWeapon(weaponBone, weaponName);
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

/**
 * Default starter weapon name. Centralizes the "what does a freshly-spawned
 * combatant equip" decision so it's not duplicated across `createPlayer`
 * (initial spawn) and `processRespawns` (every subsequent life).
 *
 * Issue #130 made this `'Longsword'` per the spawn/death/respawn design doc.
 * Changing this is a balance / starter-loadout tweak, NOT a refactor —
 * touch one line, both spawn paths follow.
 */
export const DEFAULT_STARTER_WEAPON = 'Longsword';

/**
 * Equip the default starter weapon on `eid`. Wraps `equipWeapon` so callers
 * (currently `processRespawns` and any future spawn code) don't have to
 * repeat the literal weapon name.
 *
 * Adds the starter weapon to inventory if it's missing — a respawning
 * entity should always be able to start its life with a weapon, even
 * after a future PR (#94 / drop-on-death) clears their last living weapon.
 * The protected `starterWeapon` field on `InventoryData` is the source of
 * truth that #94's drop logic consults; this function only handles the
 * "make sure they have it equipped right now" half.
 *
 * @returns true on successful equip, false if the entity has no inventory
 *   or `equipWeapon` rejected (e.g. FSM not Idle — which shouldn't happen
 *   on respawn since processDeaths reset the FSM to Idle).
 */
export function equipDefaultStarter(entityId: number): boolean {
  const inventory = inventoryRegistry.get(entityId);
  if (!inventory) return false;
  if (!inventory.weapons.includes(DEFAULT_STARTER_WEAPON)) {
    inventory.weapons.push(DEFAULT_STARTER_WEAPON);
  }
  return equipWeapon(entityId, DEFAULT_STARTER_WEAPON);
}

/**
 * Drop the entity's currently-equipped weapon at its feet.
 *
 * Called from `processDeaths` (`processDeaths.ts:133`) for every dying
 * Player/Bot entity. The death pipeline (HealthSystem → processDeaths →
 * dropEquippedWeapon) is the canonical "an entity died" path — this
 * function is the drop-on-death hook the rest of the pipeline depends on.
 *
 * Behavior:
 *   - No-op if the entity has no inventory or nothing equipped.
 *   - No-op if the equipped weapon IS the protected `starterWeapon` —
 *     starters are tied to the player identity and never drop.
 *   - Otherwise: spawn a `WeaponPickup` at the entity's current Position
 *     (feet), remove the dropped weapon from inventory, re-equip the
 *     starter if it's still in inventory (so the dying entity isn't left
 *     unarmed mid-respawn-countdown; cosmetic but matches the design),
 *     emit a `WeaponDrop` event on the EventBus.
 *
 * Spawn-tick of the dropped pickup is `currentTick` (no claim cooldown —
 * the corpse is unconscious for `RESPAWN_DELAY_TICKS` and the killer can
 * walk over immediately). Despawn tick is `currentTick + DESPAWN_TICKS`
 * (#121 — 30s lifetime). Both constants live in `WeaponPickupSystem.ts`
 * so the timeline is single-sourced.
 *
 * @param entityId  the dying entity (Player or Bot — caller filters)
 * @param world     the GameWorld — needed to spawn the pickup entity
 */
export function dropEquippedWeapon(entityId: number, world: GameWorld): void {
  const inv = inventoryRegistry.get(entityId);
  if (!inv) return;
  if (inv.equippedWeapon === null) return;
  // Starter is protected — never dropped. (`starterWeapon` can be null
  // for entities created without a protected starter, in which case
  // anything equipped is fair game.)
  if (inv.starterWeapon !== null && inv.equippedWeapon === inv.starterWeapon) {
    return;
  }

  const droppedName = inv.equippedWeapon;
  const tick = getCurrentFixedTick();
  const position: [number, number, number] = [
    Position.x[entityId],
    Position.y[entityId],
    Position.z[entityId],
  ];

  // 1. Spawn the ground pickup at the corpse's feet. spawnTick = currentTick
  // means no claim-cooldown — the pickup is immediately claimable.
  createWeaponPickup(world, {
    weaponName: droppedName,
    position: { x: position[0], y: position[1], z: position[2] },
    spawnTick: tick,
    despawnTick: tick + DESPAWN_TICKS,
  });

  // 2. Strip the dropped weapon out of inventory. `removeWeaponFromInventory`
  // also nulls `equippedWeapon` if it matched.
  removeWeaponFromInventory(entityId, droppedName);

  // 3. Re-equip the starter weapon if it's still in inventory and the
  // entity's FSM allows it. processDeaths reset the FSM to Idle just
  // before calling us, so `equipWeapon`'s Idle gate passes. If the
  // starter isn't in inventory (rare — a future PR might let a player
  // discard their starter intentionally) we leave equippedWeapon = null;
  // `processRespawns` will re-equip on respawn via `equipDefaultStarter`.
  if (
    inv.starterWeapon !== null &&
    inv.weapons.includes(inv.starterWeapon)
  ) {
    equipWeapon(entityId, inv.starterWeapon);
  }

  // 4. Emit the drop event. Killfeed, scoreboard, analytics, networking
  // (#92) consume this declaratively rather than walking the pickup
  // registry for new entries.
  EventBus.emit('WeaponDrop', {
    sourceEid: entityId,
    weaponName: droppedName,
    position,
    tick,
  });
}
