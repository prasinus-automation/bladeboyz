/**
 * Gold persistence — `localStorage`-backed save/load for player gold.
 *
 * Part of the gold-currency persistence layer (#105). See
 * `docs/gold-currency.md` §3, §6, §10 for the full contract.
 *
 * Storage layout:
 *  - `bb_player_id` → the browser's stable player id (managed by
 *    `playerIdentity.ts`).
 *  - `bb_gold_<playerId>` → stringified non-negative integer balance.
 *
 * Write policy: **trailing-edge debounce, 100ms**. Rapid award sequences
 * (`awardGold` called every kill) coalesce into a single `setItem` per
 * 100ms quiet window. The `setItem` itself blocks the main thread, and
 * we don't want a flurry of kills to budget into the render frame.
 *
 * Read policy: synchronous, once per player-entity construction. Parsed
 * value is validated:
 *  - missing key → 0
 *  - NaN / non-integer / negative → 0 + console.warn once per invalid key
 *  - clamped at `Number.MAX_SAFE_INTEGER` defensively
 *
 * Failure semantics: if `localStorage` reads or writes throw (private
 * browsing, quota exceeded, blocked), the game keeps running on the
 * in-memory `Gold.amount`. A single `console.warn` is emitted per
 * failure-class; the in-memory balance is NOT touched, so a transient
 * storage failure doesn't reset the player to 0.
 *
 * Multi-tab is intentionally OUT of scope — see `playerIdentity.ts`
 * docstring. We do not subscribe to the `storage` event.
 *
 * This module is the ONLY place outside `playerIdentity.ts` that reads
 * or writes `localStorage`. Keep it that way (see issue #105 constraints).
 */

/** Trailing-edge debounce window in milliseconds. */
const DEBOUNCE_MS = 100;

/** Storage-key prefix (joined with `playerId`). */
const KEY_PREFIX = 'bb_gold_';

/**
 * Compute the localStorage key for a player's gold balance.
 *
 * Pure helper — useful in tests that want to seed / inspect storage
 * directly without relying on the load/save round-trip.
 */
export function goldStorageKey(playerId: string): string {
  return `${KEY_PREFIX}${playerId}`;
}

// ── Single-warning gates ───────────────────────────────────

let warnedLoadFailure = false;
let warnedSaveFailure = false;
const warnedInvalidValues = new Set<string>();

// ── Pending write state ────────────────────────────────────

/**
 * Map of `playerId → amount-to-write`. Each pending entry coalesces all
 * `saveGold(id, x)` calls that arrived during the current debounce window
 * into a single trailing-edge write. The value is always the LATEST
 * amount supplied (intentional — the most recent value is canonical).
 */
const pendingWrites = new Map<string, number>();

/** Active debounce timer handle. `null` when no write is pending. */
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

// ── Load ───────────────────────────────────────────────────

/**
 * Read the persisted gold balance for a player.
 *
 * Returns 0 on:
 *  - missing storage entry
 *  - parse failure
 *  - negative value
 *  - NaN / non-integer
 *  - localStorage unavailable / throws
 *
 * Clamped to `Number.MAX_SAFE_INTEGER`. (`Gold.amount` is `ui32` so the
 * caller will further clamp at ~4.29B, but we don't reach into the
 * component from here — the load returns a raw number.)
 *
 * Warnings are emitted at most once per invalid key (so reloading a
 * tampered value doesn't spam the console) and once per
 * localStorage-class failure.
 */
export function loadGold(playerId: string): number {
  const key = goldStorageKey(playerId);
  let raw: string | null = null;
  try {
    raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch (err) {
    if (!warnedLoadFailure) {
      warnedLoadFailure = true;
      console.warn(
        `[goldPersistence] localStorage.getItem("${key}") failed; treating as 0.`,
        err,
      );
    }
    return 0;
  }

  if (raw === null) return 0;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    if (!warnedInvalidValues.has(key)) {
      warnedInvalidValues.add(key);
      console.warn(
        `[goldPersistence] Invalid stored gold for ${playerId} ("${raw}"); treating as 0.`,
      );
    }
    return 0;
  }

  // Clamp at MAX_SAFE_INTEGER defensively. ui32 max (4.29B) is reachable
  // only via tampering, but keep arithmetic safe anyway.
  return Math.min(parsed, Number.MAX_SAFE_INTEGER);
}

/**
 * Does a persisted gold entry exist for this player id?
 *
 * Used by `createPlayer` to decide whether to overwrite the
 * Wallet-default balance with the persisted value. `loadGold` returns 0
 * for both "no entry" and "tampered negative", so callers that need to
 * distinguish first-launch (don't overwrite) from "balance is genuinely
 * 0" (do overwrite) must use this helper.
 *
 * Returns `false` if `localStorage` is unavailable or throws — callers
 * should treat that as "no entry" and leave their in-memory balance
 * untouched (a warning will fire from `loadGold` later if it's called).
 */
export function hasPersistedGold(playerId: string): boolean {
  const key = goldStorageKey(playerId);
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

// ── Save (debounced) ───────────────────────────────────────

/**
 * Persist gold for a player. Trailing-edge debounced (100ms) — rapid
 * kill sequences coalesce into a single `setItem` per quiet window.
 *
 * Negative amounts are clamped to 0 before storage. Non-finite / NaN
 * amounts are dropped (no write scheduled, no warning).
 *
 * Storage failures are caught and logged once; the in-memory balance is
 * untouched on failure.
 */
export function saveGold(playerId: string, amount: number): void {
  if (!Number.isFinite(amount)) return;
  const clamped = Math.max(0, Math.floor(amount));

  pendingWrites.set(playerId, clamped);

  if (pendingTimer !== null) {
    // A timer is already running — let it fire normally; the latest
    // pending value is the one that gets written.
    return;
  }

  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    flushGoldWrites();
  }, DEBOUNCE_MS);
}

/**
 * Force-flush any pending debounced writes immediately.
 *
 * Called from:
 *  - The internal debounce timer when it fires (normal path).
 *  - `beforeunload` in `main.ts` so the last write isn't lost on tab
 *    close / refresh.
 *  - Test code that wants to assert on the persisted value without
 *    awaiting a real 100ms timer.
 *
 * Safe to call when no writes are pending — it's a no-op in that case.
 * Storage failures are logged once and DO NOT throw, so a `beforeunload`
 * call can never block the page from unloading.
 */
export function flushGoldWrites(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  if (pendingWrites.size === 0) return;

  // Snapshot + clear FIRST. If `setItem` throws, we don't want the
  // pending map to keep growing — the player's session continues on
  // the in-memory balance regardless.
  const snapshot = Array.from(pendingWrites.entries());
  pendingWrites.clear();

  for (const [playerId, amount] of snapshot) {
    const key = goldStorageKey(playerId);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, String(amount));
      }
    } catch (err) {
      if (!warnedSaveFailure) {
        warnedSaveFailure = true;
        console.warn(
          `[goldPersistence] localStorage.setItem("${key}") failed; in-memory gold is unaffected.`,
          err,
        );
      }
    }
  }
}

// ── Test helper ────────────────────────────────────────────

/**
 * Reset the module's transient state (pending writes, debounce timer,
 * single-warning gates). Intended for `beforeEach` in tests — does NOT
 * touch `localStorage` itself; tests that want a clean storage state
 * should call `localStorage.clear()` separately.
 */
export function resetGoldPersistence(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingWrites.clear();
  warnedLoadFailure = false;
  warnedSaveFailure = false;
  warnedInvalidValues.clear();
}
