/**
 * Gold economy — single chokepoint for all gold mutations.
 *
 * All gold writes go through `awardGold` / `spendGold` so that the future
 * server-authoritative path (Phase 2, post #92) can be swapped in by replacing
 * this file. See `docs/gold-currency.md` §1, §2, §7 for the full contract.
 *
 * MVP scope:
 * - Award 25 gold per attribution-confirmed kill.
 * - Skip self-kills, environmental deaths, non-player attackers, posthumous hits.
 * - No streak bonuses, no assists.
 *
 * Persistence (#105) and HUD (#108) are wired on top of this module.
 */

import { hasComponent, type IWorld } from 'bitecs';
import { Gold, Player } from '../ecs/components';
import { addGold as walletAddGold } from './Wallet';
import { getPlayerId } from './playerIdentity';
import { saveGold } from './goldPersistence';

/** Flat gold reward per kill — exported so other modules / tests don't hard-code. */
export const GOLD_PER_KILL = 25;

/** Reasons an `awardGold` call may carry. Loose string — extend as new sources land. */
export type AwardReason = 'kill' | 'admin';

/** Listener payload for `onGoldAwarded`. Fires AFTER the balance is updated. */
export interface GoldAwardedEvent {
  playerEid: number;
  amount: number;
  newBalance: number;
  reason: AwardReason;
}

type GoldAwardedListener = (event: GoldAwardedEvent) => void;

const listeners: GoldAwardedListener[] = [];

/** Subscribe to gold-award events (HUD, persistence layer). */
export function onGoldAwarded(fn: GoldAwardedListener): void {
  listeners.push(fn);
}

/** Unsubscribe (mostly for tests). */
export function offGoldAwarded(fn: GoldAwardedListener): void {
  const idx = listeners.indexOf(fn);
  if (idx >= 0) listeners.splice(idx, 1);
}

/** Reset listeners (test helper). */
export function resetGoldEconomyListeners(): void {
  listeners.length = 0;
}

/**
 * Award gold to a player. Returns the new balance.
 *
 * Caller is responsible for ensuring `playerEid` actually has the `Gold`
 * component and the `Player` tag — `awardGoldOnKill` enforces this for the
 * kill path. Direct callers (e.g. admin commands, tests) should validate
 * upstream.
 *
 * Negative or zero amounts are no-ops (return current balance unchanged) so
 * that future heuristics that compute their own amounts can opt into a clean
 * "no reward" outcome without conditionals at the call site.
 */
export function awardGold(playerEid: number, amount: number, reason: AwardReason): number {
  const current = Gold.amount[playerEid] ?? 0;
  if (amount <= 0) return current;

  const newBalance = current + amount;
  Gold.amount[playerEid] = newBalance;

  // Migration bridge: also write to the legacy `Wallet` module
  // (`src/economy/Wallet.ts`). Wallet is currently the source of truth for the
  // HUD's GoldCounter (#107), ShopPanel display, and PurchaseFlow spend path.
  // The `Gold` ECS component is the migration target per
  // docs/networking/04-server-packaging.md §3. Double-writing here keeps the
  // HUD/shop in sync with kill rewards until #105 (persistence) and #108 (HUD)
  // finish migrating their reads to `Gold.amount[eid]`, at which point this
  // call and `Wallet.ts` itself can be deleted.
  //
  // Wallet is a module-level singleton ("the player's wallet"), so it implicitly
  // tracks whatever eid is currently the player. `awardGoldOnKill` enforces
  // `Player` on the kill path, and admin/test callers are responsible for not
  // mixing this with a future per-bot wallet.
  walletAddGold(amount);

  // Persistence (#105). `playerIdentity` attaches a stable browser id in
  // `createPlayer`; if this `playerEid` has one, debounce-write the new
  // balance to localStorage. Entities without an attached identity (e.g.
  // future bots awarded gold via admin tools, or tests that skip
  // `attachPlayerIdentity`) are silently skipped — the persistence layer
  // is per-player-id, not per-entity. `saveGold` itself debounces, so
  // rapid kill sequences coalesce into a single `setItem`.
  const playerId = getPlayerId(playerEid);
  if (playerId !== undefined) {
    saveGold(playerId, newBalance);
  }

  // Notify subscribers AFTER balance is updated so listeners (HUD, persistence)
  // see the new amount immediately.
  const event: GoldAwardedEvent = {
    playerEid,
    amount,
    newBalance,
    reason,
  };
  for (let i = 0; i < listeners.length; i++) {
    listeners[i](event);
  }
  return newBalance;
}

/**
 * Award gold for a kill, applying all attribution rules.
 *
 * Returns the attacker's new balance, or `null` if no gold was awarded
 * (rule-violation, not an error).
 *
 * Rules (per `docs/gold-currency.md` §2):
 * 1. Skip if there is no attacker (environmental death) — `attackerEid === undefined`.
 * 2. Skip self-kills (`attackerEid === victimEid`).
 * 3. Skip if attacker is not a `Player` — only player kills earn gold.
 * 4. Skip if attacker doesn't have a `Gold` component (defensive — shouldn't
 *    happen since players are spawned with one, but cheap to check).
 *
 * The "already-dead" guard lives upstream in the `DamageSystem` →
 * `processDeaths` pipeline (#130): attribution is stamped per-hit into
 * `attributionByVictim` with a 5 s (300 tick) window, and `processDeaths`
 * resolves the killer from that map when emitting `DeathEvent`. Posthumous
 * damage past the window resolves to `killerEid = 0` (the env-death sentinel)
 * and is mapped to `attackerEid === undefined` at the EventBus subscription.
 */
export function awardGoldOnKill(
  world: IWorld,
  victimEid: number,
  attackerEid: number | undefined,
): number | null {
  // Rule 1: environmental death — no attacker
  if (attackerEid === undefined) return null;

  // Rule 2: self-kill
  if (attackerEid === victimEid) return null;

  // Rule 3: only Player attackers earn gold
  if (!hasComponent(world, Player, attackerEid)) return null;

  // Rule 4: defensive — attacker must have Gold component
  if (!hasComponent(world, Gold, attackerEid)) return null;

  return awardGold(attackerEid, GOLD_PER_KILL, 'kill');
}
