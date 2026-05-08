# Gold Currency — Architect Doc

**Status:** Approved for MVP implementation. Server-authoritative parts deferred until #92 (multiplayer networking) ships.
**Issue:** #95
**Owner:** Architect

## 1. Goals & Scope

Players earn **gold** for kills. Gold persists across page reloads in the same browser, displays in the HUD, and will eventually be spent at a shopkeep (out of scope for this round — no shop exists yet).

**MVP (this round, single-player + future-proof for net):**
- Flat **25 gold per kill** awarded on attribution-confirmed deaths.
- Gold lives in a `Gold` ECS component on the player.
- Gold is persisted to `localStorage`, keyed by a generated player id, so a single browser remembers gold across reloads.
- HUD shows a gold counter (top-right area).
- All gold mutations go through a single function (`awardGold` / `spendGold`) so swapping to a server-authoritative source in Phase 2 is one-line per call site.

**Phase 2 (after #92 networking):**
- Server tracks the authoritative gold balance per connected player.
- Server emits `GoldUpdated` messages on kill / spend / sync.
- Client treats local `Gold.amount` as a presentation cache; `localStorage` becomes a hint only.
- Server validates spend events; client never decrements optimistically without a pending-spend reconciliation.

This doc is the contract. Implementation issues #A/#B/#C reference it.

## 2. Reward Model

- **MVP:** flat **25 gold per kill**. No streak multiplier. Configured as a single constant `GOLD_PER_KILL = 25` in `src/economy/goldConfig.ts`.
- A "kill" = a death where (a) the dying entity has `Health.max > 0`, (b) the death's attributing attacker is a `Player`, (c) the attacker entity is not the same as the victim entity (no self-kill rewards).
- Environmental deaths (no attacker) and self-kills award **0 gold**.
- Suicide / disconnect-on-low-hp does **not** award gold to anyone.
- Streak bonuses, kill assists, and class-specific multipliers are explicitly **out of scope** for MVP. Designed-in seam: `awardGold(playerEid, amount, reason)` accepts an arbitrary amount, so future systems can compute their own number and call the same function.

## 3. Persistence

- **Scope:** per-browser, per-player-id. Survives reloads. Does **not** survive `localStorage.clear()` or "private browsing" sessions, by design.
- **Player id:** generated once on first launch via `crypto.randomUUID()`, stored under `bb_player_id`. Re-used on every subsequent launch.
- **Gold key:** `bb_gold_<playerId>`. Value is a stringified non-negative integer.
- **Write policy:** debounced. Write on every change, but coalesce writes into one `localStorage.setItem` per fixed-tick batch (or trailing-edge debounce of 100ms) to avoid hammering main-thread storage.
- **Read policy:** loaded once at player-entity construction time. If parse fails or value is negative/NaN, fall back to 0 and log a warning.
- **Player id is browser-local.** It is **not** a stable cross-device identity. Phase 2 networking can either accept the localStorage id as a session token or issue server-assigned ids and migrate.

## 4. Server Authority (Phase 2 — DEFERRED)

Not implemented this round. Documented here so MVP code can be shaped to accept it.

- Server is authoritative on `Gold.amount` once #92 ships.
- Client awards on kill = **prediction only**. Reconciled by next `GoldUpdated` from server.
- Spend events: client sends `SpendGold {amount, itemId}` request. Server validates balance, deducts, broadcasts `GoldUpdated`. Client must not allow purchase confirmation until server ack.
- On disconnect: server retains the player's balance for `RECONNECT_GRACE_SECONDS` (recommend 60s). On reconnect within grace, server replays last balance. After grace, balance survives only via the client's `localStorage` (which is treated as a hint and re-validated next session against any server records that may exist).

## 5. ECS Component Shape

Add to `src/ecs/components.ts`:

```ts
/** Gold currency held by a player entity. */
export const Gold = defineComponent({
  amount: Types.ui32,
});
```

Notes:
- `ui32` (max ~4.29B) is overkill but matches existing convention (`Types.ui32` for handle-style ints) and gives headroom for future inflation. No need to worry about overflow for MVP.
- Only player entities receive this component. Dummies and NPCs do not.
- bitECS is numeric-only; everything non-numeric (player id string, persistence handle) lives in a side-table.

## 6. Side-Table: Player Identity

Following the existing pattern (`fsmRegistry`, `meshRegistry`, `inventoryRegistry`):

```ts
// src/economy/playerIdentity.ts
export const playerIdentityRegistry = new Map<number /* eid */, string /* playerId */>();
export function getOrCreatePlayerId(): string { /* localStorage read or crypto.randomUUID */ }
export function attachPlayerIdentity(eid: number): string { /* sets registry, returns id */ }
```

The map maps player entity id → stable browser-scoped player id. Cleared on `dispose`/teardown.

## 7. Event List

These are the events that producers emit and consumers react to. Implementations may inline these as direct function calls in MVP and promote to typed event queues later.

| Event | Producer | Consumer | Payload | Notes |
|---|---|---|---|---|
| `KillEvent` | death pipeline (HealthSystem death detection, joined with last-attacker) | gold-award handler | `{ victimEid, attackerEid, weaponId }` | Skip if `attackerEid === victimEid` or no attacker. |
| `GoldAwarded` | gold-award handler | HUD, persistence layer, (future: server-replication) | `{ playerEid, amount, newBalance, reason: 'kill' \| 'admin' }` | Fired AFTER `Gold.amount` is updated. |
| `GoldSpent` | shop / spend system (future) | HUD, persistence, server | `{ playerEid, amount, newBalance, itemId }` | Out of scope for MVP. |
| `GoldPersisted` | persistence layer | nothing (debug only) | `{ playerId, amount }` | Useful in tests. |
| `GoldLoaded` | persistence layer (boot) | gold-award handler / HUD | `{ playerId, amount }` | Fires once on player-entity creation. |

For MVP, `KillEvent` and `GoldAwarded` may be implemented as plain function calls (`awardGoldOnKill(victim, attacker)`) without a queue. The doc's contract is the function signature, not the event-bus implementation.

## 8. Death-Pipeline Bridge (CRITICAL)

The repo currently has a known gap: `DamageSystem.ts` knows the attacker (`DamageEvent.attackerEid`), but `HealthSystem.ts`'s `DamageEvent` interface only carries `{ target, amount }` and detects death without attacker context. Gold attribution requires bridging this.

**Recommended approach (cheapest, smallest surface area):**

1. Extend `HealthSystem.DamageEvent` to optionally carry `attackerEid?: number`.
2. `DamageSystem.handleHit` already has the attacker — it calls `queueDamage` (or whatever lands HP). Pass `attackerEid` through.
3. In `healthSystemTick`'s death-detection branch, when `Health.current[eid] <= 0` for the first time, look up the **last attacker** (from a `Map<eid, attackerEid>` populated by the damage queue this tick) and emit `KillEvent { victimEid: eid, attackerEid }`.
4. Gold-award handler subscribes to `died` events (or the existing `died: number[]` return list, joined with the last-attacker map).

**Alternative considered, rejected:** add a `LastAttacker` ECS component. Rejected because it's persistent state for a transient fact; a tick-scoped Map is cleaner.

## 9. HUD: Gold Counter

- New file `src/hud/GoldCounter.ts` mirroring the `HealthBar` pattern: self-mounting `<div>`, `update(amount: number)`, `dispose()`.
- Position: **top-right**. The existing FPS counter is at `top: 24px; right: 8px;`. Place gold counter at `top: 24px; right: 8px;` and **move FPS counter** to `top: 44px; right: 8px;` (stack: gold above FPS) — or invert the stack. Implementer's choice; the constraint is no overlap and gold is visually prominent.
- Style: 16-20px monospace, color `#ffd700` (gold), text-shadow for legibility against any background. Format: `Gold: 25` or `25 G` — pick one and stick with it.
- Wired into `HUD` class as a private field, instantiated in constructor, updated in `update(dt, playerEntity)` from `Gold.amount[playerEntity]`, disposed in `dispose()`.

## 10. Edge Cases

- **No Gold component on entity yet:** `Gold.amount[eid]` returns `undefined` from a TypedArray read in bitECS — actually it returns `0` because the backing arrays are zero-initialized. Treat 0 as "no gold" for HUD; treat the absence of the component as "not a player" and skip.
- **Gold overflow:** `ui32` max is 4,294,967,295. MVP does not protect against overflow because reaching that gold count is impossible. Phase 2 server caps at 1M (config).
- **Gold underflow on spend:** spending more than current balance must reject. Spend system enforces; in MVP, only the (future) shopkeep calls spendGold, so this is gated at the call site.
- **localStorage disabled / quota exceeded:** wrap reads/writes in try/catch. On failure, keep the in-memory `Gold.amount` and log a single warning — game continues functioning, just doesn't persist.
- **Multiple tabs:** `storage` event fires across tabs sharing the same origin. MVP **ignores** this — last-tab-to-write wins. Phase 2 server resolves.
- **Player id collision:** `crypto.randomUUID()` is collision-free for practical purposes.
- **Disconnect (Phase 2):** see §4. Per the issue: "kept in localStorage so a brief disconnect doesn't wipe it" — explicitly recommended approach.

## 11. Phased Rollout

| Phase | Depends on | Scope |
|---|---|---|
| **MVP (now)** | nothing in repo | Gold component, kill→award pipeline, localStorage persistence, HUD counter. Single-player. Issues #A/#B/#C below. |
| **Phase 2** | #92, #93 merged | Server-authoritative balance, `GoldUpdated` replication, validated spend events. New issue, post-#92. |
| **Phase 3** | shop system issue (not yet filed) | Spend events on shopkeep purchases, item economy. New issue. |

## 12. Implementation Issues

This doc is realized by three sub-issues (created with this plan):

- **#A — Gold ECS component + kill-attribution event pipeline** (backend-dev)
- **#B — Player identity + localStorage gold persistence** (backend-dev)
- **#C — Gold counter HUD widget + README/AGENTS update** (frontend-dev)

#A must land first (defines the `Gold` component). #B and #C can run in parallel after #A.
