/**
 * Wallet — minimal in-memory player gold balance.
 *
 * Scaffolding module for the shop feature (issue #107). The full Gold
 * currency design (#95, see docs/gold-currency.md) is still architect-only;
 * this module provides just enough API for the shop to read/write a balance.
 *
 * When #95 ships in full (earning from kills, persistence, networking),
 * it should extend or replace this module — keep the API small and focused
 * so that swap is mechanical.
 *
 * Pure data + pubsub. No DOM, no Three.js, no ECS dependency.
 *
 * Subscriber pattern matches `InventorySystem.onEquip`, but `onGoldChange`
 * additionally returns an unsubscribe function for ergonomic cleanup
 * (e.g. inside HUD `dispose()`).
 */

/** Default starting balance — enough for a meaningful first purchase choice. */
const DEFAULT_GOLD = 200;

/** Module-level player gold balance. */
let goldBalance: number = DEFAULT_GOLD;

// ── Subscribers ───────────────────────────────────────────

type GoldChangeListener = (newBalance: number) => void;
const listeners: GoldChangeListener[] = [];

function emit(): void {
  for (const listener of listeners) {
    listener(goldBalance);
  }
}

// ── Public API ────────────────────────────────────────────

/** Get the current gold balance. */
export function getGold(): number {
  return goldBalance;
}

/**
 * Add gold to the balance. Negative amounts are ignored (use spendGold for
 * deductions so insufficient-funds checks apply).
 */
export function addGold(amount: number): void {
  if (amount <= 0) return;
  goldBalance += amount;
  emit();
}

/**
 * Attempt to spend gold.
 *
 * @returns true if the balance was deducted; false if there were
 *   insufficient funds (in which case the balance is unchanged and no
 *   subscribers are notified).
 */
export function spendGold(amount: number): boolean {
  if (amount <= 0) return true; // no-op succeeds without notify
  if (goldBalance < amount) return false;
  goldBalance -= amount;
  emit();
  return true;
}

/**
 * Set the gold balance directly. Intended for tests and future hooks
 * (e.g. server reconciliation). Negative values are clamped to 0.
 */
export function setGold(amount: number): void {
  goldBalance = Math.max(0, amount);
  emit();
}

/**
 * Subscribe to balance changes.
 *
 * The callback fires after `addGold` / `spendGold` (success only) /
 * `setGold` mutate the balance.
 *
 * @returns an unsubscribe function — call to stop receiving notifications.
 */
export function onGoldChange(cb: GoldChangeListener): () => void {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/** Reset the wallet (test helper). Clears balance and all subscribers. */
export function resetWallet(): void {
  goldBalance = DEFAULT_GOLD;
  listeners.length = 0;
}
