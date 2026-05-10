/**
 * Player identity — browser-scoped stable id for the local player.
 *
 * Part of the gold-currency persistence layer (#105). See
 * `docs/gold-currency.md` §3, §6, §10 for the full contract.
 *
 * Responsibilities:
 *  - Generate a one-time UUID on first launch (via `crypto.randomUUID`).
 *  - Persist it under `bb_player_id` so subsequent launches re-use it.
 *  - Map that string id onto an ECS entity id via the side-table pattern
 *    (`playerIdentityRegistry`), matching `meshRegistry` / `fsmRegistry` /
 *    `inventoryRegistry`.
 *
 * Edge cases (per §10):
 *  - `localStorage` unavailable / disabled / throws → fall back to an
 *    in-memory id and log a SINGLE warning. The game keeps working; gold
 *    just won't persist across reloads.
 *  - `crypto.randomUUID` unavailable (very old browsers / unusual test
 *    runners) → fall back to a `Math.random`-based id with a single warning.
 *    AGENTS.md targets modern browsers where this is always present, but
 *    a single-line fallback costs nothing.
 *
 * Multi-tab is **out of scope** — last-tab-wins is intentional MVP
 * behavior (per `docs/gold-currency.md` §10). We do not listen to the
 * `storage` event.
 *
 * This module is the ONLY place outside `goldPersistence.ts` that reads
 * or writes `localStorage`. Keep it that way (see issue #105 constraints).
 */

/** localStorage key for the persisted player id. */
const PLAYER_ID_KEY = 'bb_player_id';

/**
 * Side-table mapping ECS entity id → stable browser-scoped player id string.
 *
 * Matches the existing side-table pattern (`meshRegistry`, `fsmRegistry`,
 * `inventoryRegistry`) — bitECS components are TypedArray-backed and can't
 * hold strings. Cleared on teardown via `clearPlayerIdentityRegistry()`.
 */
export const playerIdentityRegistry = new Map<number /* eid */, string /* playerId */>();

/**
 * Cached in-process player id. Populated lazily by the first
 * `getOrCreatePlayerId()` call so we read `localStorage` at most once.
 */
let cachedPlayerId: string | null = null;

/**
 * Have we already warned about localStorage being unavailable? Prevents
 * a console-spam loop when every `getOrCreatePlayerId` call would otherwise
 * re-trigger the same try/catch warning.
 */
let warnedAboutStorage = false;

/**
 * Have we already warned about `crypto.randomUUID` being unavailable?
 * Same single-warning policy.
 */
let warnedAboutRandomUUID = false;

/** Generate a fresh UUID, with a defensive fallback for very old envs. */
function generatePlayerId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to manual fallback
  }
  if (!warnedAboutRandomUUID) {
    warnedAboutRandomUUID = true;
    console.warn(
      '[playerIdentity] crypto.randomUUID() unavailable; using Math.random fallback. ' +
        'IDs in this session are not cryptographically random.',
    );
  }
  // RFC4122-shape but non-cryptographic. Good enough for an MVP local id.
  return (
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    })
  );
}

/**
 * Read the browser's player id from localStorage, or generate + store
 * one on first call.
 *
 * Subsequent calls return the cached value — no repeat localStorage reads.
 *
 * On localStorage failure (private browsing, quota exceeded, blocked) the
 * id is generated and held in-memory only; a single warning is logged.
 */
export function getOrCreatePlayerId(): string {
  if (cachedPlayerId !== null) return cachedPlayerId;

  let stored: string | null = null;
  try {
    stored = typeof localStorage !== 'undefined' ? localStorage.getItem(PLAYER_ID_KEY) : null;
  } catch (err) {
    if (!warnedAboutStorage) {
      warnedAboutStorage = true;
      console.warn(
        '[playerIdentity] localStorage.getItem failed; using in-memory player id only.',
        err,
      );
    }
  }

  if (stored && stored.length > 0) {
    cachedPlayerId = stored;
    return cachedPlayerId;
  }

  const fresh = generatePlayerId();
  cachedPlayerId = fresh;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PLAYER_ID_KEY, fresh);
    }
  } catch (err) {
    if (!warnedAboutStorage) {
      warnedAboutStorage = true;
      console.warn(
        '[playerIdentity] localStorage.setItem failed; player id will not persist across reloads.',
        err,
      );
    }
  }
  return fresh;
}

/**
 * Attach a player id to an entity. Generates / loads the id via
 * `getOrCreatePlayerId` and registers it in `playerIdentityRegistry`.
 *
 * Returns the player id string (also stored in the registry under `eid`).
 *
 * Called from `createPlayer` AFTER the `Gold` component is attached, so
 * `goldPersistence.loadGold(playerId)` can then populate `Gold.amount[eid]`.
 */
export function attachPlayerIdentity(eid: number): string {
  const playerId = getOrCreatePlayerId();
  playerIdentityRegistry.set(eid, playerId);
  return playerId;
}

/**
 * Look up the player id attached to an entity. Returns `undefined` if no
 * identity has been attached (e.g. dummies, NPCs, or a player entity that
 * was created via a test path that skipped `attachPlayerIdentity`).
 */
export function getPlayerId(eid: number): string | undefined {
  return playerIdentityRegistry.get(eid);
}

/**
 * Test helper — clears the side-table AND the cached in-process id so the
 * next test sees a fresh `getOrCreatePlayerId` call. Also resets the
 * one-shot warning flags so a test that asserts on the warning can run
 * after a previous one that already tripped it.
 */
export function clearPlayerIdentityRegistry(): void {
  playerIdentityRegistry.clear();
  cachedPlayerId = null;
  warnedAboutStorage = false;
  warnedAboutRandomUUID = false;
}
