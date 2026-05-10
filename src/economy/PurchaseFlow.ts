/**
 * PurchaseFlow — atomic weapon purchase API.
 *
 * The single function `purchaseWeapon()` is the surface that becomes
 * server-authoritative when networking lands (#92). Validation and mutation
 * MUST stay co-located here so the client→server migration is mechanical.
 *
 * **Atomicity contract**: validate every precondition first, then mutate. On
 * any failure (`{ ok: false }`), nothing changes — gold balance unchanged,
 * inventory unchanged, equip state unchanged. On success (`{ ok: true }`),
 * gold is deducted, the weapon is added to inventory, and it is equipped.
 *
 * This module is pure data + ECS calls. No DOM, no Three.js side-effects
 * directly (equipWeapon does swap a 3D model on the player's weapon_attach
 * bone — that's an existing InventorySystem concern, not a purchase-flow
 * concern).
 *
 * Issue #123. Belongs alongside `Wallet.ts` and `Prices.ts` as the third leg
 * of the economy module.
 */

import { getWeaponPrice } from './Prices';
import { getGold, spendGold } from './Wallet';
import {
  getInventory,
  addWeaponToInventory,
  equipWeapon,
} from '../ecs/systems/InventorySystem';
import { fsmRegistry } from '../combat/CombatFSM';
import { CombatState } from '../combat/states';

/** Why a purchase failed, if it did. */
export type PurchaseFailureReason =
  | 'unknown_weapon' // No price registered for this weapon name
  | 'already_owned' // Weapon is already in the player's inventory
  | 'insufficient_gold' // Player can't afford the price
  | 'fsm_busy' // Player is mid-combat (not Idle); refuse to swap weapons
  | 'no_inventory'; // Player has no inventory data — defensive guard

export type PurchaseResult =
  | { ok: true; weaponName: string; pricePaid: number }
  | { ok: false; reason: PurchaseFailureReason };

/**
 * Attempt to purchase a weapon for the given entity (typically the player).
 *
 * Validates:
 *   1. The weapon has a registered price
 *   2. The entity has an inventory and does not already own the weapon
 *   3. The entity has sufficient gold
 *   4. The entity is in `CombatState.Idle` (so the equip step won't be
 *      rejected mid-swing). We validate UP FRONT — option A in the architect's
 *      note — so we never spend gold and then fail to equip.
 *
 * Mutates (only on success):
 *   5. Deducts gold via `Wallet.spendGold()`
 *   6. Adds the weapon to the inventory via `InventorySystem.addWeaponToInventory()`
 *   7. Equips the weapon via `InventorySystem.equipWeapon()` (swaps the 3D model,
 *      updates FSM config, syncs `CombatStateComponent.weaponId`)
 *
 * @param entityId - The ECS entity ID of the buyer (typically `world.playerEntity`)
 * @param weaponName - Display name from `weaponConfigs` (e.g. `"Mace"`)
 */
export function purchaseWeapon(
  entityId: number,
  weaponName: string,
): PurchaseResult {
  // 1. Price must exist (otherwise weapon is not for sale)
  const price = getWeaponPrice(weaponName);
  if (price === undefined) {
    return { ok: false, reason: 'unknown_weapon' };
  }

  // 2a. Inventory must exist for this entity
  const inventory = getInventory(entityId);
  if (!inventory) {
    return { ok: false, reason: 'no_inventory' };
  }

  // 2b. Block double-purchase
  if (inventory.weapons.includes(weaponName)) {
    return { ok: false, reason: 'already_owned' };
  }

  // 3. Gold must cover the price
  if (getGold() < price) {
    return { ok: false, reason: 'insufficient_gold' };
  }

  // 4. Equip will only succeed if the FSM is Idle. Validate up front so we
  //    don't spend gold and then bail on the equip — gold is the precious
  //    resource, weapons are recoverable.
  //    This mirrors the same gate inside `InventorySystem.equipWeapon`. If
  //    the entity has no FSM yet (e.g. tests or NPCs without combat),
  //    treat that as Idle.
  const fsm = fsmRegistry.get(entityId);
  if (fsm && fsm.state !== CombatState.Idle) {
    return { ok: false, reason: 'fsm_busy' };
  }

  // ── All validations passed; commit the mutation. ───
  // spendGold cannot fail here — we just checked the balance — but assert
  // defensively so a future refactor of the wallet doesn't silently corrupt
  // inventory state.
  const spent = spendGold(price);
  if (!spent) {
    // Should be unreachable; getGold() >= price was true above.
    return { ok: false, reason: 'insufficient_gold' };
  }

  addWeaponToInventory(entityId, weaponName);
  equipWeapon(entityId, weaponName);

  return { ok: true, weaponName, pricePaid: price };
}
