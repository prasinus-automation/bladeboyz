# 02 — Replication Model & Protocol Message Catalog

> **Status:** architecture spec, no production code change. This is sub-issue
> 2 of 4 under #92. Doc 01 (transport, topology, tickrate, authority) is
> taken as given throughout — every reference to "the server tick", "30 Hz
> broadcast", "server-authoritative", or "client-predicted" is defined there.
>
> **Scope:** which ECS components cross the wire, snapshot vs. delta encoding,
> the full client↔server message catalog, the binary encoding format,
> endianness, schema evolution.
>
> **Out of scope for this doc** (covered elsewhere): transport choice and
> reconciliation math (#116 / doc 01), the joining handshake byte layout —
> only the *high-level* `Welcome` payload is here, the raw byte-by-byte frame
> layout and error-code enum are in **doc 03** (#133), Node.js entry point
> and Docker layout (#138 / doc 04), matchmaking, regions, statistical
> anti-cheat.

---

## 0. Reading order

This doc is structured to be read top-to-bottom on a first pass:

1. §1 names every ECS component that gets replicated (and explicitly the ones
   that do not, with reasons).
2. §1.4 then introduces two **new** ECS components — `EquippedWeapon` and
   `Gold` — that doc 01 already promised would exist (see doc 01 §4.1).
   Those components do not exist in code today; this section is the contract
   for the implementation PRs.
3. §2 covers the snapshot wire shape — initial full snapshot on join, then
   30 Hz deltas, with a per-entity changed-mask byte.
4. §3 lists every message type in both directions, fully typed.
5. §4 picks the encoding library (`msgpackr`) and justifies it.
6. §5 nails endianness and float precision.
7. §6 specifies how the schema evolves without breaking old clients.

Acronyms used: **C→S** = client to server, **S→C** = server to client,
**RPC** = a message that expects a corresponding reply.

---

## 1. Replicated state — which components cross the wire

The components below are partitioned into three groups: **replicated** (server
broadcasts in snapshots), **derived client-side** (the client computes them
from replicated state), and **server-only** / **client-only** (never on the
wire). The split here MUST match the authority cheatsheet in
[doc 01 Appendix A](./01-transport-and-authority.md#appendix-a--authority-cheatsheet);
if the two ever drift, doc 01 wins and this doc is updated.

### 1.1 Replicated components (server → client snapshots)

Every entry includes the byte cost of one entity's worth of that component
on the wire. These costs feed the bandwidth budget in §4.

| Component                  | Where defined                       | Wire fields                                                                                            | Bytes / entity | Notes                                                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`Position`**             | `src/ecs/components.ts:7`           | `x: f32, y: f32, z: f32`                                                                               |             12 | Per the feet-origin convention (`AGENTS.md` → "Spatial Conventions"), this is the entity's foot point — the same value the client uses for `meshGroup.position`. No offset is applied on either side.                                       |
| **`Rotation`**             | `src/ecs/components.ts:21`          | `x: f32, y: f32, z: f32` (Euler XYZ radians, pitch / yaw / roll)                                       |             12 | Euler is fine because it matches the existing component. Quaternion compression is not worth the conversion cost at melee tickrate. f32 gives ≈ 0.0000000596 rad resolution — well below visible precision.                                  |
| **`MovementState`**        | `src/ecs/components.ts:54`          | `flags: u8` (bit 0 grounded, 1 sprinting, 2 crouching, bits 3–7 reserved), `speedFactor: f32`           |              5 | `verticalVelocity` and `lastJumpTick` are **NOT** replicated — they are client-prediction bookkeeping (doc 01 §4.2). Server canonical values are not interesting to remote clients.                                                          |
| **`CombatStateComponent`** | `src/ecs/components.ts:122`         | `state: u8, attackDirection: u8, blockDirection: u8, ticksRemaining: u16, weaponId: u8`                |              6 | `state` and `direction` enums use the same numeric values everywhere (server, client, wire) — see §1.6.                                                                                                                                     |
| **`Health`**               | `src/ecs/components.ts:136`         | `current: f32`                                                                                          |              4 | `max` is sent only in `Welcome` and on stat-change events — see §1.5.                                                                                                                                                                       |
| **`Stamina`**              | `src/ecs/components.ts:142`         | `current: f32`                                                                                          |              4 | Same `max`-omission policy as Health.                                                                                                                                                                                                        |
| **`EquippedWeapon` (new)** | will live at `src/ecs/components.ts` | `weaponId: u8`                                                                                          |              1 | Migration plan in §1.4. Today the equipped slot lives in `inventoryRegistry` at `src/ecs/systems/InventorySystem.ts:60`; that does not flow through a snapshot dirty-bit pipe.                                                              |
| **`Gold` (new)**           | will live at `src/ecs/components.ts` | `amount: u32`                                                                                           |              4 | Player-only component (no NPC has it). `u32` covers the lifetime gold of a single match comfortably — at the design rate (#95) of ≤ 100 gold per kill, `u32` overflow takes ~43 million kills.                                              |
| **`HitReactComp`**         | `src/ecs/components.ts:243`         | `dirX: f32, dirY: f32, dirZ: f32, magnitude: f32, spawnedAtTick: u32, durationTicks: u16, active: u8` |             23 | Replicated **only** in the snapshot in which `active` flips from 0→1, and again when it flips 1→0. In between, the client decays it locally. This avoids re-sending a static stamp 12 times during its 12-tick lifetime.                  |

**Per-entity worst case** (every component sent at once, no packing):
12 + 12 + 5 + 6 + 4 + 4 + 1 + 4 + 23 = **71 bytes**, plus a 2-byte entity ID
and a 1-byte changed-mask = **74 bytes** per fully-dirty entity. At MVP scale
(N = 8 entities all dirty, 30 Hz) that is `8 × 74 × 30` ≈ **17.8 KB/s**
downstream per client — comfortably under the 12–96 KB/s envelope in doc 01
§3 even when every entity changes every tick (which it never does).

> **Why HitReactComp is replicated and `CombatStateComp` / `AnimationComp`
> are not.** `HitReactComp` is the *one* render-side component that is
> server-authoritative — the server decides whether a hit landed and what
> direction it came from. Animation itself is purely a client-side rendering
> concern that derives from `CombatStateComponent` (see §1.2).

### 1.2 Derived client-side (NOT replicated, computed locally from replicated state)

The client maintains these without ever receiving them over the wire. They
are bandwidth-free.

| Component                                 | Source on the client                                                                                          | Why not replicated                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PreviousPosition` (`components.ts:14`)   | Set to the previous snapshot's `Position` when the next snapshot arrives.                                     | A pure interpolation artifact. Sending it doubles the position bandwidth for zero new information.                                                                                                                                                                                                  |
| `PreviousRotation` (`components.ts:28`)   | Same as `PreviousPosition`, for `Rotation`.                                                                   | Same reason.                                                                                                                                                                                                                                                                                        |
| `Velocity` (`components.ts:35`)           | `(currentPos − previousPos) / dt` per fixed tick on the client.                                               | The server has its own canonical `Velocity` it never trusts the client about (per doc 01 §4.2 it is server-authoritative for prediction-reconciliation purposes). For *rendering* — the only reason a client cares — derived velocity is good enough and saves 12 bytes per entity per snapshot. |
| `MovementIntent` (`components.ts:87`)     | Local: written by `InputSystem` from raw input every fixed tick. Remote: zero-filled (we do not see remote intent). | The whole point of the AI/network seam (`AGENTS.md` → "Character Controller") is that `MovementIntent` is the *input* that produces server-side state. The output is `Position`/`Rotation`/`MovementState`, which **are** replicated. Sending intent too is double-counting.                          |
| `CombatStateComp` (`components.ts:219`)   | Mirrored from the replicated `CombatStateComponent` each tick (existing pattern in `CombatSystem.ts`).        | Render-side mirror. The phase-progress fields (`phaseElapsed`, `phaseTotal`, `phaseT`) are pure functions of `CombatStateComponent.ticksRemaining` plus the weapon config, both of which the client already has.                                                                                  |
| `AnimationComp` (`components.ts:263`)     | Written by the client's animation system from `CombatStateComp` and `MovementState`.                          | 100 % render-side. Doc 01 §4.3 already classifies this as client-only.                                                                                                                                                                                                                              |

### 1.3 Server-only or client-only (never crosses the wire in either direction)

| Component / table                                     | Lives on  | Why                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PhysicsBody` (`components.ts:48`)                    | Server    | Holds Rapier handles (`bodyHandle`, `colliderHandle`). The client has its own Rapier world for prediction (movement only); it allocates its own handles and maintains its own server-eid → client-rapier-handle map. The numeric values would be meaningless on the other side.                                                                            |
| `Hitboxes` (`components.ts:109`) / `Hitbox` (`:152`)  | Server    | Same reason — Rapier collider handles are server-internal. Clients reconstruct hitboxes only if they ever need to render them (the existing `DebugRenderer` pattern). For combat the client never raycasts; it just receives `DamageEvent` messages (§3.2).                                                                                                |
| `TracerTag` (`components.ts:166`)                     | Server    | The tracer pipeline is server-authoritative end-to-end (doc 01 §4.1). Client never knows which entities are tracer-eligible.                                                                                                                                                                                                                              |
| `DamageEvent` (`components.ts:193`)                   | Server    | A transient ECS component used by `DamageSystem` to queue work within a single tick. Crossing the wire would mean re-sending the resolved hit; we already have a dedicated `DamageEvent` *message* in §3.2 that carries the player-visible fields with no Rapier internals.                                                                              |
| `Player` / `IsPlayer` tag (`components.ts:42`)        | Both, **implicit** | This tag is implicit from the connection mapping: every entity that owns a connection is a player. Server doesn't need to send it; client tags every entity that appears in `EntitySpawned { type = Player }`.                                                                                                                                          |
| `meshRegistry` / `weaponModelFactories` / `pickupRegistry` | Client | Three.js / DOM refs. By construction not numeric, and per `AGENTS.md` → "Side-table pattern" they would not fit a bitECS component anyway.                                                                                                                                                                                                                |
| `meshRegistry` (server's own copy)                    | Server    | The server has no Three.js. It maintains a parallel side-table only if it needs entity-name strings for logging — see §1.7 for the player-display-name policy.                                                                                                                                                                                            |
| `hitboxColliderRegistry` (`components.ts:284`)        | Server    | Server-side Rapier reference table. The client builds its own version only for the local player's prediction colliders, if at all (movement uses the kinematic character controller; per-region hitboxes are not needed client-side).                                                                                                                  |
| `pickupRegistry` (`src/inventory/PickupRegistry.ts`)  | Both, **separate** | Server holds the authoritative `{ weaponName, group? }` for each pickup eid. Client builds its own copy from `EntitySpawned { type = WeaponPickup, weaponId }` events. Three.js Group refs never cross the wire.                                                                                                                                          |
| `shopkeepRegistry` (#113)                             | Server only for now | Shopkeep instances are static arena scenery. Doc 01 §4.1 does not list them as authoritative because they do not move; server still owns the canonical list and ships it as `EntitySpawned { type = Shopkeep }` once at join. Client renders the nameplate locally.                                                                                  |
| `npcRegistry` / future bot brains                     | Server    | All AI runs server-side; only the bot's resulting `Position` / `CombatStateComponent` / etc. is replicated, indistinguishable from a player on the wire (they share the `EntitySpawned { type = NPC }` shape).                                                                                                                                            |

### 1.4 New ECS components: `EquippedWeapon` and `Gold`

Both components are introduced **as part of the multiplayer rebuild**. They
do not exist in `src/ecs/components.ts` today. The implementation lands in
the first multiplayer PR; this section is the contract.

#### 1.4.1 `EquippedWeapon`

Today the equipped slot lives in `InventoryData.equippedWeapon` inside the
`inventoryRegistry` side-table (`src/ecs/systems/InventorySystem.ts:60`). The
single-player code reads it via `getInventory(eid)` and writes it via
`equipWeapon(eid, weaponName)`. Both are fine for single-player; neither
flows through bitECS's component-write tracking, so neither participates in
the snapshot dirty-bit pipe described in §2.

For multiplayer, the **equipped slot must be a real ECS component** so:

1. The snapshot delta encoder can detect "weapon changed for eid X this
   tick" via the existing per-component dirty-bit (or hash-of-last-snapshot,
   per §2.3) without special-casing the inventory side-table.
2. `CombatSystem` and `TracerSystem` can read it from the same authority
   surface they read every other combat input — no side-table reach-throughs
   from inside a hot system.
3. Any future "force unequip" / "disarm" affordance is a single-component
   write, not a side-table mutation.

```ts
// src/ecs/components.ts (new, slot to be added near Hitboxes / CombatStateComponent)
/**
 * Currently-equipped weapon (replicated). String name lives in the
 * weaponIdToName registry (`src/ecs/systems/CombatSystem.ts:29`); a value
 * of 0xFF means "unarmed".
 *
 * NOTE: this replaces the `equippedWeapon: string | null` field that
 * currently lives in `InventoryData` (`src/ecs/systems/InventorySystem.ts`).
 * The owned-weapons LIST stays in the side-table — only the equipped
 * slot is promoted to an ECS component.
 */
export const EquippedWeapon = defineComponent({
  weaponId: Types.ui8,
});
```

The migration is a three-step refactor in the implementation PR:

1. Add the `EquippedWeapon` component to `components.ts`.
2. In `equipWeapon()` (`src/ecs/systems/InventorySystem.ts:136`):
   - Continue to validate `weapons.includes(weaponName)` against
     `inventoryRegistry`. Owned-list logic is unchanged.
   - Write `EquippedWeapon.weaponId[entityId] = weaponIdToName.indexOf(weaponName)`
     instead of (or in addition to, during the migration window)
     `inventoryRegistry.get(eid).equippedWeapon = weaponName`.
3. In `CombatSystem`, replace any read of
   `inventoryRegistry.get(eid)?.equippedWeapon` with
   `weaponIdToName[EquippedWeapon.weaponId[eid]]`.

The owned-weapons list stays a server-side side-table because it is **not
tick-replicated** — clients learn about additions/removals via discrete
events:

- `WeaponPickupEvent` (S→C, §3.2) — server adds the weapon to the
  player's owned list and announces it.
- `WeaponDropEvent` (S→C, §3.2, used by drop-on-death and disconnect-grace
  per #94) — server removes the weapon from the owned list and announces it.
- The initial owned list at join is part of the `Welcome` payload (§3.2).

> **Why not replicate the owned list every snapshot?** It changes once or
> twice per match per player. Streaming it at 30 Hz wastes 4–32 bytes per
> player per snapshot for zero new information. Discrete events are the
> right shape.

#### 1.4.2 `Gold`

Currency does not exist anywhere in the codebase today (`AGENTS.md` calls
this out — `src/economy/Wallet.ts` is module-level state, not ECS). The
multiplayer rebuild needs it as a real ECS component for the same dirty-bit
reason as `EquippedWeapon`.

```ts
// src/ecs/components.ts (new)
/**
 * Player gold balance (replicated, server-authoritative).
 *
 * Wallet (`src/economy/Wallet.ts`) becomes a thin reader on the *client*
 * that mirrors `Gold.amount[localEid]` into the existing
 * `onGoldChange` pubsub for HUD subscribers (`GoldCounter.ts`).
 *
 * On the *server*, `Gold` is the source of truth — `awardGoldOnKill`
 * (per #103) writes directly to `Gold.amount[victorEid]`, and the next
 * 30 Hz snapshot delivers the new value.
 */
export const Gold = defineComponent({
  amount: Types.ui32,
});
```

`Gold` is a **player-only** component (`createPlayer` adds it; NPCs and
shopkeeps do not). The snapshot encoder (§2) MUST omit the `Gold` bit from
the changed-mask byte for entities that do not have the component, not
emit a zero. This is enforced by checking
`hasComponent(world, Gold, eid)` on the server when building the per-entity
mask.

> **Privacy note.** A player's gold balance is broadcast to *all* clients
> (it is part of every player's snapshot, not just their own). This is
> deliberate: scoreboards already display gold, so hiding it would be
> security-by-obscurity. If a future shopkeep-side feature wants to keep
> a buyer's balance private, it can be relayed via a private S→C event
> rather than replicated; this is out of scope for MVP.

### 1.5 `Health.max` and `Stamina.max` are sent rarely, not per snapshot

Both `Health` and `Stamina` carry `current` and `max`. `max` changes on:

- Spawn (set to the player's stat default).
- Permanent stat upgrades (out of scope for MVP — but the protocol is built
  for it).
- Buff/debuff effects (also out of scope).

It does not change between two consecutive 30 Hz snapshots in 99.9 % of
ticks. Sending 4 bytes of unchanged data 30 times per second per entity
adds up across players.

**Decision.** `max` ships in:

1. The `EntitySpawned` message for the entity (§3.2). Mandatory.
2. A new dedicated event `StatMaxChanged { eid, kind, newMax }` (§3.2)
   when `max` changes mid-match. Currently never sent for MVP; reserved.

The 30 Hz snapshot includes only `current` for both. Bytes saved per
8-player snapshot: `8 × 2 components × 4 bytes = 64 bytes/snapshot ×
30 Hz = 1.9 KB/s` downstream. Modest but free.

### 1.6 Numeric enum identity across server / client / wire

Several `u8` fields carry enum values. The wire encoding MUST use the same
numeric values the existing single-player code already uses, so client and
server read each other's bytes without translation.

| Enum                | Lives at                                       | Wire field source                                                                                                |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CombatState`       | `src/combat/states.ts`                         | `CombatStateComponent.state`                                                                                      |
| `AttackDirection`   | `src/combat/directions.ts`                     | `CombatStateComponent.attackDirection`, `InputFrame.attack_direction_hint`, `DamageEvent.attackDirection`         |
| `BlockDirection`    | `src/combat/directions.ts`                     | `CombatStateComponent.blockDirection`                                                                             |
| `BodyRegion`        | `src/ecs/components.ts:291`                    | `DamageEvent.bodyRegion`                                                                                           |
| `weaponId`          | `weaponIdToName` array at `src/ecs/systems/CombatSystem.ts:29` | every `weaponId: u8` field on the wire                                                                            |
| `EntityType`        | (new) — defined in §3.3                        | `EntitySpawned.type`                                                                                              |
| `DisconnectReason`  | (new) — defined in doc 03                      | `Disconnect.reason`, `PlayerLeft.reason`                                                                          |
| `PlayerLeftReason`  | (new) — defined in doc 03                      | `PlayerLeft.reason`                                                                                               |
| `GoldDeltaReason`   | (new) — defined in §3.2                        | `GoldDelta.reason`                                                                                                |

The `weaponIdToName` array is the **single source of truth** for the
`weaponId` byte. AGENTS.md already flags this as a footgun
(`src/ecs/systems/CombatSystem.ts:29` — hardcoded
`['Longsword','Mace','Dagger','Battleaxe']`). Doc 03 will move it to a
proper shared module under `src/shared/protocol/` so server and client
import the same constant; until then both halves of the build MUST treat
the array as immutable and append-only (never re-order, never insert in
the middle).

### 1.7 String state and bitECS

bitECS components are TypedArray-backed and only support numeric fields
(see `AGENTS.md` → "Gotchas"). This forces a small set of design choices:

- **Player display name.** Lives on the server in a side-table
  `Map<eid, string>`, **never** in an ECS component. It is sent to clients
  in two specific places only: `Welcome.fullSnapshot.players[i].displayName`
  and the broadcast `PlayerJoined { eid, displayName }`. Clients keep their
  own `Map<eid, displayName>` for the killfeed and nameplate. Display
  names are **not** in the per-tick snapshot.
- **Weapon name.** Goes through `weaponId: u8` end-to-end. The string is
  resolved via `weaponIdToName[id]` on each side independently.
- **Pickup item identity.** Pickups are referenced by their server eid
  (`u16`), with the underlying weapon carried as a `weaponId: u8`. The
  string `weaponName` in `pickupRegistry` is client-local cosmetic state
  and never crosses the wire.
- **Chat text.** Stays a string in the protocol message — bitECS
  components don't see it, the UI does. See `ChatMessage` in §3.1.

---

## 2. Snapshot vs. delta encoding

### 2.1 The two snapshot kinds

There are two snapshot shapes on the wire:

1. **Initial full snapshot** — sent exactly once per connection, inside the
   `Welcome` payload. Contains every replicated component for every entity
   currently in the arena. After a connection-grace reconnect (doc 01 §8),
   the server sends a fresh `Welcome` with a fresh full snapshot — there is
   no "resume from delta" path.
2. **Delta snapshot** — sent every server snapshot tick (30 Hz, doc 01 §3),
   inside the `Snapshot` message (§3.2). Contains only the components that
   changed since the recipient client's last *acknowledged* snapshot.

Both share the **per-entity entry encoding** described in §2.2. The
difference is only in how the changed-mask is computed:

- Full snapshot → mask = "every component this entity has".
- Delta snapshot → mask = "every component this entity has *and* whose
  bytes changed since the recipient's last acked snapshot".

### 2.2 Per-entity entry encoding

A snapshot is a sequence of per-entity entries. One entry looks like:

```
┌─────────────────────────────────────────────────────────────────────┐
│ entity_id:    u16        // server-assigned, monotonic, never reused │
│ changed_mask: u8         // bit index → which component is present   │
│ [for each set bit, in mask-order, the component's wire bytes]        │
└─────────────────────────────────────────────────────────────────────┘
```

The `changed_mask` byte is the contract between encoder and decoder. **Bit
indices are fixed forever once assigned.** New components claim the next
free bit; existing bits never move. (See §6 — Schema evolution.)

| Bit | Component                  | Bytes when present                                      |
| --: | -------------------------- | ------------------------------------------------------- |
| 0   | `Position`                 | 12 (`x: f32, y: f32, z: f32`)                           |
| 1   | `Rotation`                 | 12 (`x: f32, y: f32, z: f32`)                           |
| 2   | `MovementState`            | 5  (`flags: u8, speedFactor: f32`)                      |
| 3   | `CombatStateComponent`     | 6  (`state, attackDir, blockDir, ticksRem, weaponId`)   |
| 4   | `Health.current`           | 4  (`f32`) — `max` is in `EntitySpawned`, not here      |
| 5   | `Stamina.current`          | 4  (`f32`) — `max` is in `EntitySpawned`, not here      |
| 6   | `EquippedWeapon`           | 1  (`weaponId: u8`)                                     |
| 7   | `Gold`                     | 4  (`amount: u32`)                                      |

When **all 8 bits are set** an entity entry is `2 + 1 + 12 + 12 + 5 + 6 +
4 + 4 + 1 + 4 = 51 bytes`. The 71-byte worst case in §1.1 comes from
adding the optional `HitReactComp` (23 bytes) — see §2.6.

> **Why exactly 8 bits?** A `u8` mask is the cheapest unit a
> binary-encoded language exposes (no bit-twiddling on `u4` halves), and it
> happens to fit MVP exactly. When component count exceeds 8, we extend the
> mask to `u16` behind a protocol-version bump (§6). We do **not**
> pre-allocate a `u16` today — that's 1 wasted byte per entity per
> snapshot, ≈ 240 B/s saved by keeping it `u8`.

#### 2.2.1 Component encoding details

For each component, the on-the-wire bytes are written **in the field
declaration order from `src/ecs/components.ts`**, little-endian (§5).

- **`Position`** — `Position.x[eid]` then `.y[eid]` then `.z[eid]` as f32.
- **`Rotation`** — `.x[eid]` then `.y[eid]` then `.z[eid]` as f32 (XYZ
  Euler radians).
- **`MovementState`** — packed `flags: u8` first, where
  `flags = grounded | (sprinting << 1) | (crouching << 2)`,
  then `speedFactor: f32`. `verticalVelocity` and `lastJumpTick` are
  client-prediction-only and not written.
- **`CombatStateComponent`** — `state: u8`, `attackDirection: u8`,
  `blockDirection: u8`, `ticksRemaining: u16`, `weaponId: u8`.
- **`Health` / `Stamina`** — `current: f32` only; `max` is omitted (§1.5).
- **`EquippedWeapon`** — `weaponId: u8`.
- **`Gold`** — `amount: u32`.

### 2.3 What "changed" means — dirty tracking

The server needs a way to compute "did component X change for entity E
between server tick T₀ and T₁?" without scanning every TypedArray byte.
Two viable strategies:

1. **Hash-of-last-snapshot per entity-component cell.** After encoding
   each snapshot, store the bytes that were written. Next tick, re-encode
   into a scratch buffer and `memcmp` against the previous cell; if
   different, set the bit and update the cache. Simple, no extra
   instrumentation, O(replicated-bytes) per tick. Memory cost: ≈ 50
   bytes/entity × 8 entities × 30 buffered ticks (for ack rewind, §2.4)
   = ~12 KB. Acceptable.
2. **Explicit dirty bits set by writers.** Every system that writes a
   replicated component also sets a dirty flag. Faster (no comparison)
   but invasive — every `MovementSystem` write site, every
   `HealthSystem.applyDamage()`, every `equipWeapon()` would need to
   touch a parallel structure. AGENTS.md flags exactly this kind of
   reach-through as a maintainability footgun.

**Pick 1 — hash-of-last-snapshot** for MVP. The CPU cost at 8 entities
is negligible (one `memcmp` per cell, ≤ 50 bytes/entity at 60 Hz
encoder rate ≪ 30 Hz broadcast). Re-evaluate if entity count goes up
(20+).

> **Note for the implementer.** "Hash" here does not mean a
> cryptographic hash. It is just "are these bytes byte-for-byte equal to
> the last bytes I sent?" using `Buffer.compare` / `Uint8Array` equality.

### 2.4 Acks and the per-client baseline

The naive plan would be "send a delta against the previous snapshot the
server emitted". That breaks if **a snapshot is lost** (TCP retransmits,
but the client may have closed the connection mid-flight, or the
server's send buffer dropped — we are on TCP-over-WS so packet loss is
rare but not zero, see doc 01 §1).

**Concrete protocol.** Every `InputFrame` carries
`last_received_snapshot_tick: u32` (defined in §3.1). The server keeps,
for each connected client, a ring of the last **30 snapshots** (= 1 s
at 30 Hz). On the next snapshot tick, the server:

1. Looks up the client's most recent acked tick `A`.
2. Builds the delta as `entity_state[T] − entity_state[A]` per the
   hash-cache (§2.3), but uses the **acked-tick** cell, not the
   most-recently-encoded cell. (Implementation: the cache keeps last 30
   ticks per replicated cell.)
3. Sends `Snapshot { tick = T, last_processed_input_tick = ... }` (§3.2).

If `A` is older than the oldest buffered snapshot, the delta would be
unbounded. The server falls back to a **fresh full snapshot for that
client** — same on-the-wire shape as `Welcome.fullSnapshot`, sent inside
a `Snapshot` message with the changed-mask byte saying "every bit set
on every entity". This keeps recovery in-band; no separate
"resync" message type is needed.

> **Memory cost.** 30 snapshots × ≤ 50 B/entity × 8 entities = 12 KB
> per client. With 8 clients = 96 KB. Trivial.

> **What happens if a client never acks?** The server's
> last-acknowledged tick stays at `0`, every "delta" is effectively a
> full snapshot. Client behaviour is correct but bandwidth doubles. The
> heartbeat in doc 01 §1.2 will catch a truly-silent client and start
> the disconnect grace timer.

### 2.5 Per-entity relevancy — out of scope

For MVP, every snapshot includes every entity in the arena, broadcast to
every connected client. Doc 01 §2 limits N to 8 and one arena, so this
is fine.

When relevancy becomes a real concern (open world, large player counts,
spectator mode), the hook point is **inside the per-client snapshot
construction loop**: after computing the per-entity changed-mask, ask
`isRelevantTo(clientEid, entityEid)` and skip the entry on `false`. The
per-entity entry shape (§2.2) does not need to change — a relevancy
filter just shortens the entries list.

Document this as the **single relevancy seam** so future work doesn't
need to restructure encoding.

### 2.6 `HitReactComp` — edge-triggered, not in changed-mask

`HitReactComp` deliberately is **not** a bit in the 8-bit changed-mask.
It is a transient effect — populated on a hit, decayed locally to
zero — and we explicitly do not want to send the same 23 bytes for 12
ticks (~400 ms) just because the mask says "this changed".

Encoding instead:

- A separate **`HitReact` event field** on the per-entity entry, ridden
  in alongside the normal mask. Specifically, the entry gains an
  optional **9th bit** (bit 8 of a `u16` extension mask) that is set
  **only on the rising edge** (`active` flips 0 → 1) or **falling
  edge** (`active` flips 1 → 0). Between edges the client decays the
  effect with the magnitude / duration / spawnedAtTick it received.

This is the one place where we lift the mask to `u16`, but only for
entities that have a `HitReactComp` change *this tick*. For all other
entities the mask stays `u8` — the encoder writes a `0xFF` placeholder
to indicate "extension byte follows" *only when needed*.

**Decision.** To keep the wire shape simple at MVP, ship `HitReactComp`
as a separate `HitReactEvent` S→C message in §3.2 instead — same edge
semantics, but lives outside the snapshot. Revisit this if eventing
adds noticeable latency, but at 1–2 hits/s/player it is well within
budget.

### 2.7 Worked snapshot example

8 players, mid-match. In the last tick:

- Players 1, 3, 5 are running — their `Position` and `MovementState`
  changed.
- Player 2 just started a Windup → `CombatStateComponent` and
  `Stamina.current` changed.
- Player 4 took damage → `Health.current` changed; a `HitReactEvent`
  rides separately.
- Players 6, 7, 8 stood still and their FSM is idle — nothing changed.

Snapshot wire bytes (header + entries):

```
header: tick: u32 (4) + last_processed_input_tick: u32 (4) + entry_count: u16 (2) = 10 B
entries:
  P1: id(2) + mask=0b00000101 (1) + Position(12) + MovementState(5) = 20 B
  P2: id(2) + mask=0b00100100 (1) + CombatStateComponent(6) + Stamina(4) = 13 B
  P3: same shape as P1                                                   = 20 B
  P4: id(2) + mask=0b00010000 (1) + Health(4)                            =  7 B
  P5: same shape as P1                                                   = 20 B
  // P6, P7, P8 not included (mask would be 0 — empty entries are skipped)
total: 10 + 20 + 13 + 20 + 7 + 20 = 90 bytes
```

Plus the leading `message_type: u8` (1 byte, see §3) = **91 bytes** for
this `Snapshot` message. At 30 Hz that's **2.7 KB/s downstream per
client** in this representative-ish state, well under the 12 KB/s
worst case from doc 01.

---

## 3. Message catalog

Every message has a `u8 message_type` discriminator (§4) followed by its
payload fields in declaration order. **Strings** are encoded as
`length: u16 + utf8_bytes`. **Variable-length blobs** (snapshot entries,
input frames inside a batch) are framed by an explicit `count: u16`.

The reserved `message_type` namespace is allocated below; doc 03 may
refine error codes / disconnect reasons but MUST NOT change message-type
bytes once assigned.

| Byte | Direction | Name                | Sent when                                                       |
| ---: | :-------: | ------------------- | --------------------------------------------------------------- |
| 0x01 | C→S       | `ClientHello`       | First message after WS open                                     |
| 0x02 | S→C       | `Welcome`           | Server accepts join                                             |
| 0x03 | S→C       | `Disconnect`        | Server closes connection with a reason                           |
| 0x10 | C→S       | `InputFrame`        | Every client tick (60 Hz)                                        |
| 0x11 | S→C       | `Snapshot`          | Every server snapshot tick (30 Hz)                               |
| 0x12 | S→C       | `EntitySpawned`     | New player joins, weapon drops, NPC spawns                       |
| 0x13 | S→C       | `EntityDespawned`   | Player leaves grace expires, pickup claimed/expired              |
| 0x14 | S→C       | `PlayerJoined`      | Broadcast when a new client is admitted                          |
| 0x15 | S→C       | `PlayerLeft`        | Broadcast after grace expiry / kick                              |
| 0x20 | C→S       | `WeaponSwapRequest` | Player invokes weapon-swap (1/2/3/4 keys, shop)                  |
| 0x21 | C→S       | `PickupRequest`     | Player presses pickup key near a dropped weapon                  |
| 0x22 | S→C       | `WeaponPickupEvent` | Server confirms a validated pickup                               |
| 0x23 | S→C       | `WeaponDropEvent`   | Server announces a drop (death, disconnect, manual drop)         |
| 0x30 | S→C       | `DamageEvent`       | Server applied damage in this tick                               |
| 0x31 | S→C       | `DeathEvent`        | Server detected a death                                          |
| 0x32 | S→C       | `HitReactEvent`     | Server populated `HitReactComp` (§2.6)                           |
| 0x40 | S→C       | `GoldDelta`         | Player gold balance changed                                      |
| 0x41 | S→C       | `StatMaxChanged`    | `Health.max` or `Stamina.max` changed (reserved for MVP)         |
| 0x50 | C→S       | `ChatMessage`       | Player sent chat (deferred — see §3.4)                           |
| 0x51 | S→C       | `ChatBroadcast`     | Server fans out a chat message (deferred)                        |
| 0xF0 | S→C       | `Ping`              | Server initiates RTT measurement                                 |
| 0xF1 | C→S       | `Pong`              | Client replies to `Ping`                                         |

Reserved for future docs: 0x60–0x6F (admin/spectator), 0x70–0x7F
(reconnect), 0xE0–0xEF (debug).

### 3.1 Client → Server messages

```ts
// 0x01
ClientHello {
  protocolVersion: u16,           // see §6
  displayName:     string<32>,    // utf-8, max 32 bytes (NOT 32 chars)
  clientNonce:     u128,          // 16 random bytes from sessionStorage
                                  // (per doc 01 §8 reconnect identity)
}
```
First message after WS upgrade. If `protocolVersion` doesn't match the
server's, the server replies with `Disconnect { reason =
PROTOCOL_VERSION_MISMATCH }` (doc 03 enumerates the reason codes) and
closes. `displayName` is sanitised server-side: trimmed, length-clamped,
control-char-stripped. `clientNonce` is opaque; only used for reconnect
matching (doc 01 §8).

```ts
// 0x10
InputFrame {
  client_tick:                    u32,    // monotonic per-client; for ack/replay
  last_received_snapshot_tick:    u32,    // server uses this as delta baseline (§2.4)

  // packed input — 1 byte total
  keys_bitfield:                  u8,     // bit 0 W, 1 A, 2 S, 3 D, 4 Space (jump),
                                          // 5 Shift (sprint), 6 Ctrl (crouch),
                                          // 7 reserved
  mouse_buttons:                  u8,     // bit 0 LMB, 1 RMB, 2 MMB, 3-7 reserved

  // mouse motion (resolved direction is sent separately below; see §3.1.1)
  mouse_dx_packed:                i16,    // accumulated x-delta this tick (pixels)
  mouse_dy_packed:                i16,    // accumulated y-delta this tick (pixels)

  // camera (yaw/pitch from CameraController)
  camera_yaw:                     f32,    // radians, accumulated absolute
  camera_pitch:                   f32,    // radians, clamped client-side to ±π/2

  // resolved direction enums (per doc 01 §3.1 Option A)
  attack_direction_hint:          u8,     // AttackDirection enum, 0xFF = "none"
  block_direction_hint:           u8,     // BlockDirection enum,  0xFF = "none"

  // E-key edge-triggered actions (consumed by server; client clears next tick)
  interact_pressed:               u8,     // 0/1 (KeyE rising edge this tick)
  pickup_pressed:                 u8,     // 0/1 — distinct from interact;
                                          // see §3.1.2
}
// Wire size: 4+4+1+1+2+2+4+4+1+1+1+1 = 26 bytes per InputFrame
```

At 60 Hz this is **1.56 KB/s upstream per client** — comfortably under the
1.5 KB/s estimate in the issue spec, before WS framing.

> **Why is `attack_direction_hint` only a hint?** Per doc 01 §3.1 Option
> A, the server validates the enum value but trusts the client to have
> resolved it from a 100 ms mouse-delta window. The hint is the client's
> proposed direction; the server keeps or rejects it based on FSM state.

#### 3.1.1 Why `mouse_dx`/`dy` even though direction is resolved?

The raw deltas are kept on the wire for two reasons:

1. **Anti-cheat sanity-check.** Server can spot-check that the resolved
   direction is within plausible distance of the raw deltas without
   replaying the full window (doc 01 §3.1 Option B math, but only run
   if a player gets flagged by other heuristics). This is opt-in
   server-side; the protocol carries the data either way.
2. **Demo replay** (post-MVP). Saving the InputFrame stream is a poor
   man's replay system; raw deltas are needed for high-fidelity
   replay.

Total cost of carrying them: 4 bytes/frame = 240 B/s/client. Cheap.

#### 3.1.2 Pickup vs. interact — same key, different intent

KeyE today does both "open shop" (when a shopkeep is in range) and is
the planned binding for "pick up dropped weapon" (#94 / #121 / #A2).
Client resolves which one applies based on local proximity state and
sends the single edge-triggered byte that matches:
`interact_pressed = 1` for shopkeep interactions (server resolves the
nearest shopkeep), `pickup_pressed = 1` for dropped weapons (server
resolves via `PickupRequest`, see below). The byte the server validates
is the **raw player intent** — if both flags are set in the same tick
(extremely unlikely outside a buggy client), the server prefers
`pickup_pressed` and ignores `interact_pressed`.

```ts
// 0x20
WeaponSwapRequest {
  weaponId: u8,    // index into weaponIdToName (§1.6)
}
```
Sent when the player presses 1/2/3/4 or selects from the inventory
panel. Server validates against the player's owned-list side-table
(§1.4.1) and that the FSM is in `Idle` (mirrors the existing
`equipWeapon` rejection at `src/ecs/systems/InventorySystem.ts:157`).
On success, `EquippedWeapon.weaponId[playerEid]` is updated, and the
next 30 Hz snapshot includes the change with bit 6 of the changed-mask
set. No dedicated S→C ack is needed — the snapshot **is** the ack.
Rejection is silent (`return false` server-side, optionally an
`ErrorEvent` in doc 03).

```ts
// 0x21
PickupRequest {
  targetItemEid: u16,    // server-assigned eid of the WeaponPickup entity
}
```
Sent when the client decides the player wants to pick up a specific
ground weapon (proximity + KeyE). Server validates per doc 01 §6 rule
5: pickup eid exists, distance check against authoritative `Position`,
not despawned, FSM in `Idle`. On success, broadcasts `WeaponPickupEvent`
(§3.2) and `EntityDespawned { eid = targetItemEid }`.

```ts
// 0x50  (DEFERRED — not implemented in MVP)
ChatMessage {
  text: string<128>,    // utf-8 bytes, server clamps + sanitises
}
// 0xF1
Pong {
  serverTime: f64,      // echoed from preceding Ping
}
```
`ChatMessage` is reserved for post-MVP. Server MUST drop the message
silently if the chat feature is disabled in this build (no error reply,
no log spam). `Pong` is sent only in response to `Ping` (§3.2); a
`Pong` without a preceding `Ping` MUST be dropped silently.

### 3.2 Server → Client messages

```ts
// 0x02
Welcome {
  protocolVersion: u16,         // echo of ClientHello.protocolVersion
  clientEid:       u16,         // ECS eid this client is "playing as"
  serverTick:      u32,         // tick the snapshot below corresponds to
  tickRate:        u8,          // 60 (informational; doc 01 §3 fixes this)
  snapshotRate:    u8,          // 30 (same)

  // initial owned-list and other side-table state for the local player only:
  ownedWeapons: {
    count:  u16,
    items:  Array<{ weaponId: u8 }>,
  },
  starterWeaponId: u8,          // see #109 InventoryData.starterWeapon

  // every entity currently in the arena:
  fullSnapshot: {
    entityCount: u16,
    entities: Array<{
      eid:            u16,
      type:           u8,           // EntityType enum (§3.3)
      maxHealth:      f32,          // see §1.5 (per-entity stat tables — 0 if N/A)
      maxStamina:     f32,
      // followed by a per-entity changed-mask + components (full mask;
      // every replicated component the entity has):
      changedMask:    u8,
      // components in mask-order, encoded per §2.2.1
    }>,
  },

  // every connected player's display name (see §1.7):
  playerCount: u16,
  players: Array<{ eid: u16, displayName: string<32> }>,
}
```
Sent exactly once per accepted connection. After this the client is in
the **steady-state**: it builds its local ECS world from the
`fullSnapshot`, applies `MovementSystem` predictively, and processes
incoming `Snapshot` messages.

```ts
// 0x03
Disconnect {
  reason:  u8,            // DisconnectReason enum (doc 03)
  message: string<128>,   // human-readable detail; client may surface in UI
}
```
Server-initiated close. Clients MUST treat any `Disconnect` as terminal
for that connection — no resume, no retry on the same `clientNonce`
(reconnect uses a fresh `ClientHello` per doc 01 §8).

```ts
// 0x11
Snapshot {
  tick:                       u32,
  last_processed_input_tick:  u32,    // highest InputFrame.client_tick the
                                      // server applied; client uses this in
                                      // §2.4 ack flow + reconciliation
                                      // (doc 01 §5)
  entryCount:                 u16,
  entries: Array<{
    eid:           u16,
    changedMask:   u8,
    // components in mask-order, encoded per §2.2.1 (delta semantics — only
    // changed components are present)
  }>,
}
```

```ts
// 0x12
EntitySpawned {
  eid:        u16,
  type:       u8,             // EntityType enum (§3.3)
  maxHealth:  f32,            // 0 if N/A for this type
  maxStamina: f32,
  changedMask: u8,
  // initial values for every replicated component this entity has,
  // in mask-order
}
// 0x13
EntityDespawned {
  eid:    u16,
  reason: u8,    // 0 = generic, 1 = picked up (item), 2 = grace expired (player),
                 // 3 = killed (player → respawning), 4 = despawn timer (item)
}
```
`EntitySpawned` is the *only* path by which a client learns about a new
eid. The client MUST allocate local state (Three.js mesh, Rapier
prediction body if it's the local player, name in the killfeed table if
a player) on receipt and never on first appearance in a `Snapshot`. A
snapshot that mentions an unknown eid is a bug — the client MUST log
and ignore the entry.

```ts
// 0x14
PlayerJoined {
  eid:         u16,
  displayName: string<32>,
}
// 0x15
PlayerLeft {
  eid:    u16,
  reason: u8,    // PlayerLeftReason enum (doc 03 — covers grace expiry, kick,
                 // protocol error, server shutdown)
}
```
Broadcast to all clients. `PlayerLeft` arrives **after** the
`EntityDespawned { eid, reason = 2 }` for that player's entity.

```ts
// 0x22
WeaponPickupEvent {
  pickerEid:     u16,    // who picked it up
  weaponId:      u8,     // what they picked up
  pickupItemEid: u16,    // the (now-despawned) ground item eid
}
// 0x23
WeaponDropEvent {
  dropperEid:        u16,    // who dropped it (or 0xFFFF for "no one" /
                             // arena-spawned starter pickups, if those exist)
  weaponId:          u8,
  newPickupItemEid:  u16,    // eid of the WeaponPickup entity that was just
                             // spawned at the drop location; clients use this
                             // to correlate with the matching EntitySpawned
                             // (sent in the same broadcast batch)
  reason:            u8,     // 0 = death, 1 = disconnect grace, 2 = manual,
                             // 3 = inventory swap (#94)
}
```
The pair `WeaponDropEvent` + `EntitySpawned { type = WeaponPickup }`
arrives together; their order in the WS frame stream is:
`EntitySpawned` first (so the client knows the item exists), then
`WeaponDropEvent` (so the client knows *why* and from *whom*). Same
discipline for `WeaponPickupEvent` + `EntityDespawned`.

```ts
// 0x30
DamageEvent {
  attackerEid:     u16,
  targetEid:       u16,
  damage:          f32,
  bodyRegion:      u8,    // BodyRegion enum (§1.6)
  attackDirection: u8,    // AttackDirection enum (§1.6)
  blocked:         u8,    // 0 = unblocked hit, 1 = parry, 2 = block (chip)
}
```
Drives the client-side floating-damage HUD. Sent **immediately** —
clients do NOT wait for the next `Snapshot`. The damage is also
reflected in the same tick's snapshot via the `Health.current` change,
but the event is what makes the floater fly.

```ts
// 0x31
DeathEvent {
  victimEid:       u16,
  killerEid:       u16,    // 0xFFFF if no killer (env, suicide, fall)
  weaponId:        u8,     // 0xFF if N/A
  goldAwarded:     u32,    // gold the killer got from this kill (0 if none)
}
```
Drives the killfeed. The killfeed entry text is built client-side from
`displayName(victim)` + `weaponName[weaponId]` + `displayName(killer)`.

```ts
// 0x32
HitReactEvent {
  targetEid:     u16,
  dirX:          f32,    // body-local space (per components.ts:243 docs)
  dirY:          f32,
  dirZ:          f32,
  magnitude:     f32,    // [0, 1]
  spawnedAtTick: u32,
  durationTicks: u16,
}
```
See §2.6. Animation system on the client populates `HitReactComp` from
this event; `HitReactSystem` decays it locally with no further server
involvement until the next hit.

```ts
// 0x40
GoldDelta {
  eid:       u16,
  newAmount: u32,    // server-authoritative; client REPLACES local Gold.amount
                     // with this value, never diff-applies
  reason:    u8,     // GoldDeltaReason enum:
                     //   0 = kill_award,
                     //   1 = shop_purchase,
                     //   2 = pickup_award (reserved for #95),
                     //   3 = admin_adjust (reserved),
                     //   4 = match_reset (server resets to starting balance)
  delta:     i32,    // signed convenience field (newAmount - previousAmount on
                     // the server). Client may use it for the "+10 gold" floater
                     // without keeping its own previousAmount.
}
```
The `newAmount` field is the contract. `delta` is a derived hint. The
client snapshot will *also* include the new gold value via bit 7 of the
changed-mask; sending the dedicated event is what gives the HUD a
discrete "ka-ching" trigger and a reason code for the floater text.

```ts
// 0x41 (RESERVED — not used in MVP)
StatMaxChanged {
  eid:    u16,
  kind:   u8,    // 0 = healthMax, 1 = staminaMax
  newMax: f32,
}
// 0xF0
Ping {
  serverTime: f64,    // server epoch ms; client echoes in next Pong
}
// 0x51 (DEFERRED — not implemented in MVP)
ChatBroadcast {
  fromEid: u16,
  text:    string<128>,
}
```

### 3.3 `EntityType` enum

Used in `EntitySpawned.type` and (implicitly) in the per-entity entry
shape decisions. Reserved values are plenty — we expect new entity
types as the game expands.

| Value | Name           | What it represents                                                          |
| ----: | -------------- | --------------------------------------------------------------------------- |
|     0 | `Player`       | Human-controlled combatant (the local one or a remote one)                  |
|     1 | `WarmupBot`    | Server-side AI bot (#119)                                                   |
|     2 | `TrainingDummy`| Static-ish target (#114)                                                    |
|     3 | `Shopkeep`     | Non-combatant NPC (#113)                                                    |
|     4 | `WeaponPickup` | Dropped weapon entity (#94/#109)                                            |
|  5-31 |  *(reserved)*  | Future NPC types, environment props, spawnable arena features               |

### 3.4 Deferred messages

The following are **named in the catalog** so the byte assignments don't
move when implemented, but are not part of MVP:

- `ChatMessage` (0x50) and `ChatBroadcast` (0x51). Server MUST drop a
  received `ChatMessage` silently for MVP.
- `StatMaxChanged` (0x41). Sent never; reserved for the post-MVP buff
  system.

### 3.5 Message ordering guarantees

WebSocket gives in-order delivery per connection. For each client:

- `Welcome` is the **first** S→C message, full stop.
- All event messages that semantically belong to "tick T" (snapshot,
  damage events, death events, hit-reacts, gold deltas, spawn/despawn)
  are flushed in this order: `EntitySpawned*` → `EntityDespawned*` →
  `Snapshot` → `DamageEvent*` → `DeathEvent*` → `HitReactEvent*` →
  `WeaponPickupEvent* / WeaponDropEvent*` → `GoldDelta*`. The order
  matters for client-side HUD logic (e.g., a killfeed entry must be
  shown only *after* the death has been recognised in the snapshot, so
  `displayName` lookups for despawned eids still work).
- `PlayerJoined` arrives **before** the first `Snapshot` that contains
  the new player.
- `PlayerLeft` arrives **after** the `EntityDespawned` for that
  player's eid.
- `Ping` may arrive at any time; `Pong` is the next message of that
  type the client sends.

---

## 4. Binary encoding

### 4.1 Choice — `msgpackr`

The encoding library used by both halves of the build is
**[`msgpackr`](https://www.npmjs.com/package/msgpackr)** (~25 KB minified,
written by the same team as `dpack`, schema-free, supports browser +
Node). All messages are serialized as msgpack with a top-level
`message_type: u8` discriminator (per §3 catalog) + the typed payload.

**Why msgpackr (and not a hand-rolled `DataView`):**

| Criterion                   | msgpackr                                                                    | Hand-rolled `DataView`                                                                              |
| --------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Wire size                   | ~5–15 % overhead vs. packed binary (msgpack format tags)                    | Optimal — no per-field tags                                                                          |
| Implementation effort       | Trivial — one `import`, two function calls per message                      | High — hand-write encoders + decoders for ~20 message types, then keep them in sync as schema evolves |
| Schema evolution            | Tagged format absorbs added fields gracefully                               | Manual versioning per encoder; one mistake = corrupt deserialization                                 |
| CPU cost on hot path        | Snapshot encoding: ~50 µs for an 8-player snapshot (msgpackr's native loops) | Negligible difference at our scale                                                                   |
| Bundle size on client       | +25 KB minified                                                             | 0                                                                                                    |
| Determinism                 | Deterministic (same input → same bytes)                                      | Deterministic                                                                                        |
| Built-in compression        | Optional record-extension (msgpackr "structures") — saves bytes after warm-up | None — would have to layer something else                                                          |

For an MVP-scale game where (per §1.1) a fully-dirty 8-player snapshot
is ~74 bytes/entity and we have **17.8 KB/s** worst-case downstream,
the 5–15 % msgpack overhead amounts to **at most 2.7 KB/s** extra per
client. Negligible. The **library wins on velocity**: every message
type in §3 is a one-liner, schema-evolution is built in, and the bundle
hit is irrelevant for a Three.js game (the renderer alone is ~600 KB).

Concretely:

```ts
// shared/protocol/codec.ts (lives next to version.ts in the new directory)
import { Packr, Unpackr } from 'msgpackr';

const packr   = new Packr({ useRecords: true, structures: protocolStructures });
const unpackr = new Unpackr({ useRecords: true, structures: protocolStructures });

export function encode(msg: ProtocolMessage): Uint8Array { return packr.pack(msg); }
export function decode(bytes: Uint8Array): ProtocolMessage { return unpackr.unpack(bytes); }
```

`useRecords: true` is what makes msgpackr competitive on size — instead
of repeating field names per message, the structures table is
established once at handshake. We pre-load it from a TypeScript
`protocolStructures` array that mirrors the message catalog exactly.
**The structures table is part of the wire contract and bumps
`PROTOCOL_VERSION` on every change (§6).**

> **What we are NOT doing.** No `permessage-deflate` (doc 01 §1.1). No
> custom DataView codec for snapshots (msgpackr is fast enough at our
> scale; revisit only if profiler shows >5 % loop time spent in the
> encoder). No protobuf — it's bigger, slower-to-iterate, and the
> codegen step is overkill.

### 4.2 Frame layout

Every WebSocket binary frame is exactly one msgpack-encoded message:

```
┌──────────────────────────────────────────────────────────────┐
│ msgpack array of 2 elements:                                 │
│   [0] message_type: u8                                       │
│   [1] payload:      msgpack object (per message type schema) │
└──────────────────────────────────────────────────────────────┘
```

This layout is enforced by:

- `binaryType = 'arraybuffer'` (per doc 01 §1.1).
- **One game message per WS frame** (per doc 01 §1.1).
- Server rejects text frames on receipt.

`message_type` is a `u8` because msgpack encodes 0–127 as a single byte
("positive fixint"); we never run out at 256 message types (doc 03 will
manage the namespace if we ever do).

### 4.3 Bandwidth budget — final numbers

| Direction | Rate     | Per-message size                                            | Total per client                  |
| --------- | -------: | ----------------------------------------------------------- | --------------------------------- |
| C→S       | 60 Hz    | `InputFrame` ≈ 26 B + msgpack overhead ≈ ~40 B              | **~2.4 KB/s upstream**            |
| S→C       | 30 Hz    | `Snapshot` realistic (§2.7) ≈ 90 B + msgpack overhead ≈ ~110 B | **~3.3 KB/s downstream baseline** |
| S→C       | event-driven | `DamageEvent`, `DeathEvent`, etc. — typically <10 events/s | **<1 KB/s downstream peak**       |
| S→C       | 30 Hz, worst case | Fully-dirty snapshot at 8 entities × 74 B               | **~22 KB/s downstream peak**      |

These match (and slightly exceed, due to msgpack overhead) the rough
estimates in the issue spec. All comfortably under WS's effective
ceiling of "tens of KB/s on a healthy connection".

### 4.4 Versioning hook

Every message goes through `encode()` / `decode()` in
`src/shared/protocol/codec.ts`. The `PROTOCOL_VERSION` constant
(`src/shared/protocol/version.ts`, per doc 01 §7) is the only thing
both sides advertise in `ClientHello` / `Welcome`. On mismatch, the
server replies with `Disconnect { reason = PROTOCOL_VERSION_MISMATCH }`
*before* attempting to decode any further message. The handshake byte
order in doc 03 makes this concrete.

---

## 5. Endianness, float precision, cross-platform

### 5.1 Little-endian everywhere

All multi-byte integer and float fields are encoded **little-endian**
on the wire. Browsers (V8/SpiderMonkey/JSC), Node.js (V8), x86, x86-64,
and ARM (in the configurations targeted) all default to LE; encoding
LE-on-the-wire avoids any byte-swap on either end.

`msgpackr` defaults to msgpack's spec encoding, which is BE for some
multi-byte ints. This is not actually a problem because msgpackr handles
it internally; we never hand-encode an integer. The "little-endian
everywhere" rule applies to:

- The structures-table field-order encoding (deterministic by
  `protocolStructures` array order).
- Any place where we *do* hand-encode bytes — only `clientNonce: u128`
  in §3.1 and the snapshot delta entries in §2.2 (which use a
  `DataView` inside the msgpackr binary blob field; `setFloat32(off,
  val, true)` for LE). That `true` flag is mandatory.

This MUST NOT be exposed as a configuration knob. There is no way to
"opt into" big-endian and there never will be.

### 5.2 IEEE 754 single precision (`f32`) for replicated state

Replicated `Position`, `Rotation`, `Health`, `Stamina`, `speedFactor`
etc. all use `f32`, not `f64`:

- bitECS stores them as `Types.f32` already; the wire encoding matches
  the storage layout 1:1. No precision loss in the round-trip.
- f32 = 4 bytes vs. f64 = 8 bytes. At 8 entities × ~30 floats per
  snapshot × 30 Hz, going to f64 would be **+28 KB/s** for no
  perceptible quality gain.
- f32 has ≈ 7 significant decimal digits — at our arena scale (50 m
  radius), positional resolution is ~6 µm, well below "see this
  twitch a pixel".

The exceptions where `f64` is used:

- `Ping.serverTime` and `Pong.serverTime` (§3.2). Wall-clock-ms epoch
  doesn't fit f32 cleanly.
- `clientNonce: u128`. Carried as 16 raw bytes inside a msgpack
  binary value, not a float.

### 5.3 Tick number wrap

`serverTick: u32` wraps at 2^32 ≈ 4.29 × 10^9. At 60 Hz that's about
**828 days** of continuous uptime. Doc 01 §3.2 already accepts this as
MVP. The protocol doesn't paper over a wrap; doc 03 may add a
`TickEpoch { epoch: u8, tick: u32 }` extension when this matters, behind
a version bump.

---

## 6. Schema evolution

The protocol must evolve without breaking running clients. Three rules
keep us honest.

### 6.1 Component additions

A new replicated ECS component:

1. Goes in the **next free `changedMask` bit** (currently bit 8 — see
   below for what happens when we run out of `u8`).
2. Goes at the **end** of any per-entity entry encoding — bytes for
   higher-numbered bits come after bytes for lower-numbered bits, so an
   old client reading a new snapshot can stop at the bits it knows.
3. Bumps `PROTOCOL_VERSION` (§6.4).

> **Important: bit indices are immutable.** A bit assigned to
> `Position` on day 0 is still `Position` on day 1000. Do not "compact"
> the mask by re-using bits of removed components — instead retire the
> bit (mark it reserved in this doc) and assign new components to fresh
> bits.

### 6.2 Mask expansion (when `u8` runs out)

When we hit 9 replicated components, the per-entity changed-mask
expands to `u16`. This is a **breaking change** that bumps
`PROTOCOL_VERSION`. The signal that the wire mask is now `u16` is the
new protocol version — there is no in-band "fallback" or "backward
compat" mode. This is fine because:

- Doc 01 §7 already commits the server to rejecting old clients with a
  `PROTOCOL_VERSION_MISMATCH` disconnect.
- Mask expansion is a once-every-several-cycles event, not a frequent
  concern.

### 6.3 Message-type additions

A new C→S or S→C message:

1. Claims the **next free `message_type` byte** in §3 (with a PR that
   updates this doc).
2. Old servers / clients receiving an unknown `message_type` MUST log a
   single warning per message-type-per-connection (rate-limited so a
   buggy peer doesn't spam) and drop the message. They MUST NOT close
   the connection — the rest of the stream is still valid.
3. If the new message is **required** for correctness (not just a new
   feature flag), the introducing PR also bumps `PROTOCOL_VERSION` so
   old clients are rejected at handshake instead of silently missing
   gameplay.
4. If the new message is **optional** (a nice-to-have like
   `StatMaxChanged`), `PROTOCOL_VERSION` does not bump.

### 6.4 The `PROTOCOL_VERSION` constant

Lives at `src/shared/protocol/version.ts` (per doc 01 §7 — that file
does not exist yet; the first multiplayer implementation PR creates
it). Strictly monotonic `u16`. **Never decrements.** The server's
`ClientHello` handler MUST reject any mismatch with
`Disconnect { reason: PROTOCOL_VERSION_MISMATCH, message: "..." }` so
the client can show "Update your client" rather than a generic
"Disconnected".

Versions bump on:

- New `changedMask` bit (§6.1) — this is breaking because old clients
  would silently mis-read the trailing bytes.
- Mask `u8 → u16` expansion (§6.2).
- Any **change** to an existing field's type or bit layout — never
  shrink a field, never re-order. (Adding a new field at the *end* of
  an existing message is allowed and does NOT bump version.)
- `protocolStructures` reorder (§4.1) — msgpackr's record table is
  positional.

Versions do NOT bump on:

- Adding a new optional message type that old clients can ignore.
- Adding a new `EntityType` enum value (the entry shape is unchanged;
  old clients just see "an entity type they don't recognise" and can
  render it as a generic placeholder mesh).
- Adding a new `DisconnectReason` enum value (clients fall back to a
  generic "Disconnected: <message>" UI).

### 6.5 Backward compatibility — what we do **not** promise

- Multiple supported versions concurrently. The server runs exactly
  one version. There is no `min_supported_version` / `max_supported_version`
  range.
- Read-old-clients-with-new-server tolerance. If a client's version is
  older than the server's, the server disconnects them. (The old
  client should detect this and prompt the player to refresh; doc 03
  details that flow.)
- Long-term schema stability of unimplemented messages. The 0x50/0x51
  (chat) and 0x41 (StatMaxChanged) byte assignments are reserved but
  the field layouts may evolve before they ship.

---

## Appendix A — Replicated-state quick reference

Pin this on the wall when implementing.

```
┌──────────────────────────────┬───────────────────────────────────────────────┐
│ Replicated (server snapshot) │ Position, Rotation, MovementState,            │
│                              │ CombatStateComponent, Health.current,         │
│                              │ Stamina.current, EquippedWeapon, Gold         │
├──────────────────────────────┼───────────────────────────────────────────────┤
│ Edge-triggered events        │ HitReactEvent, DamageEvent, DeathEvent,       │
│                              │ WeaponPickupEvent, WeaponDropEvent, GoldDelta │
├──────────────────────────────┼───────────────────────────────────────────────┤
│ Sent in EntitySpawned only   │ Health.max, Stamina.max, EntityType,          │
│                              │ initial owned-list (Welcome only),            │
│                              │ player displayName (Welcome / PlayerJoined)   │
├──────────────────────────────┼───────────────────────────────────────────────┤
│ Derived client-side          │ PreviousPosition, PreviousRotation,           │
│                              │ Velocity, MovementIntent (remote 0-fill),     │
│                              │ CombatStateComp, AnimationComp                │
├──────────────────────────────┼───────────────────────────────────────────────┤
│ Server-only or client-only   │ PhysicsBody, Hitboxes, Hitbox, TracerTag,     │
│                              │ DamageEvent (the ECS component),              │
│                              │ Player tag (implicit from connection),        │
│                              │ meshRegistry / weaponModelFactories /         │
│                              │ pickupRegistry (Three.js refs)                │
└──────────────────────────────┴───────────────────────────────────────────────┘
```

## Appendix B — Source-file pin map

Every architectural claim above pins to specific code or to a sibling
doc. When refactoring any of these files, check that this doc still
describes them correctly (and update both in the same PR if not).

| Claim                                                              | File / line                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Replicated component schemas (numeric only)                        | `src/ecs/components.ts:7-251`                                    |
| Equipped weapon currently lives in inventory side-table            | `src/ecs/systems/InventorySystem.ts:60` (`inventoryRegistry`)    |
| Equipped slot mutation site                                        | `src/ecs/systems/InventorySystem.ts:136` (`equipWeapon`)         |
| `weaponIdToName` array — single source of truth for `weaponId: u8` | `src/ecs/systems/CombatSystem.ts:29`                             |
| Fixed-tick rate that the server matches                            | `src/core/types.ts:38` (`FIXED_TIMESTEP = 1 / 60`)                |
| Authority split (server vs. predicted vs. client-only)             | `docs/networking/01-transport-and-authority.md` §4 + Appendix A  |
| Snapshot broadcast rate                                            | `docs/networking/01-transport-and-authority.md` §3 (30 Hz)       |
| Reconciliation math for predicted state                            | `docs/networking/01-transport-and-authority.md` §5               |
| Reconnect-by-clientNonce identity                                  | `docs/networking/01-transport-and-authority.md` §8               |
| `HitReactComp` component contract                                  | `src/ecs/components.ts:243` (component) + `HitReactSystem`       |
| `WeaponPickup` component (foundation already in place)             | `src/ecs/components.ts:183` (#109 / PR #151)                     |
| Gold component (does NOT exist yet)                                | new — added in first multiplayer impl PR (§1.4.2)                |
| `EquippedWeapon` component (does NOT exist yet)                    | new — added in first multiplayer impl PR (§1.4.1)                |
| `protocolVersion` location                                         | future `src/shared/protocol/version.ts` (doc 01 §7)              |
| Codec module                                                       | future `src/shared/protocol/codec.ts` (§4.1)                     |
| Doc 03 — wire byte layout, error codes, joining flow               | planned, see #133                                                |
| Doc 04 — headless server packaging, deploy                         | [`docs/networking/04-server-packaging.md`](./04-server-packaging.md) |
