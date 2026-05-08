# 01 — Transport, Topology, Tickrate & Authority

> **Status:** architecture spec, no production code change. This is the
> foundational doc for the multiplayer rebuild (#92). Docs 02 (snapshot format),
> 03 (wire protocol), and 04 (server runtime) take everything below as given.
>
> **Scope:** transport choice, server topology, tickrate, authority split,
> reconciliation, anti-cheat baseline, joining flow, disconnect/reconnect.
>
> **Out of scope for this doc** (covered elsewhere): exact snapshot field
> layout (#126 / doc 02), wire-format byte layout & message-type enum
> (#133 / doc 03), Node.js entry point and Docker layout (#138 / doc 04),
> matchmaking, regions, horizontal scale, statistical anti-cheat.

---

## 1. Transport choice — WebSocket

### Decision

The multiplayer layer uses **binary-frame WebSocket over TLS** as its only
transport. One WebSocket per client; no auxiliary channels.

### Alternatives considered

| Option         | Why rejected                                                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebRTC**     | Requires STUN, almost always TURN for NAT traversal. Operationally heavy for a 2–8-player MVP. Lower protocol overhead than WS but the bandwidth headroom does not currently matter (see §3 — at 30 Hz × ≤8 entities, we are nowhere near saturating TCP). |
| **WebTransport (HTTP/3 / QUIC)** | Better long-term answer (datagrams, multistream, 0-RTT reconnect). Browser support is still gated behind Chromium-only flags as of 2026-Q1. Server-side ecosystem in Node.js is immature. **Documented as future upgrade path — see §1.3.**                |
| **Plain TCP socket** | Not available from the browser. Non-starter.                                                                                                                                                                                                          |
| **HTTP long-poll**   | Latency floor too high for melee combat (a parry window is 8–10 ticks ≈ 130–170 ms; a poll round-trip eats most of that).                                                                                                                              |

### Why WebSocket is enough

- **Lowest infra friction.** No STUN, no TURN, no port range to open on the
  host. The deploy already exposes one TCP port (the deploy workflow at
  `.github/workflows/deploy-staging.yml` maps internal `3000` → external
  `3010`). Single port, single HTTP upgrade, done.
- **Browser-native.** `new WebSocket(url)` works in every supported browser —
  no polyfill, no library *required* (we will use `ws` server-side and the
  built-in browser API client-side).
- **TCP-over-TLS is fine at melee tickrate.** This is the load-bearing claim
  worth scrutinising. At 30 Hz broadcast (see §3), the inter-snapshot interval
  is ~33 ms. Head-of-line blocking on a TCP retransmit only matters when a
  retransmit happens *and* it stalls an in-flight frame past the next snapshot.
  At ≤8 entities × ≤200 bytes per snapshot, frames are small and rarely
  fragmented at the IP layer; a retransmit costs 1 RTT (≈ tens of ms on a
  healthy connection). For a melee game where parry windows are ~130 ms wide,
  this is a perfectly acceptable failure mode. **A twitch-shooter at 64 Hz +
  hitscan would not tolerate this** — for melee with multi-tick swings, it does.
- **Single-port deploy compatible.** WS upgrade goes through the same HTTP
  listener that already serves the static client bundle.

### 1.1 Wire framing

- **Binary frames only.** All messages MUST set `binaryType = 'arraybuffer'`
  client-side (default in `ws` server-side). Text frames MUST be rejected by
  the server on receipt.
- **One game message per WebSocket frame.** No batching multiple game messages
  into one WS frame, no splitting one game message across multiple WS frames.
  This makes parsing trivial (one frame in → one message out) and removes a
  whole class of bugs around partial reads.
- **Per-frame overhead is acknowledged.** Each WS frame has a 2–14-byte header.
  At 30 Hz broadcast × 8 clients receiving × 2 server→client frames per tick,
  that is ≤ 480 frames/s of header overhead per connection direction — under
  ~7 KB/s of pure header. We are not bandwidth-constrained.
- **No compression at the WS layer** (`permessage-deflate` MUST be disabled).
  Snapshots will use a custom binary delta-encoding (defined in doc 02);
  per-message compression on top adds CPU jitter without enough payload to
  matter.

### 1.2 Heartbeats and timeouts

- Server sends a `Ping` control frame every **5 s** of TCP-level idle.
- Client MUST respond with a `Pong` within **2 s**, or the server treats the
  connection as dropped and starts the disconnect grace timer (§8).
- This is independent of any application-level keep-alive; we rely on the WS
  protocol's built-in ping/pong.

### 1.3 Future upgrade path: WebTransport

When WebTransport ships in stable Chrome and Firefox (and the Node.js
ecosystem catches up), the migration is contained: the wire protocol (doc 03)
is transport-agnostic. We replace the WebSocket glue with a WebTransport
session and re-use everything above it. The on-the-wire byte layout does not
change.

---

## 2. Server topology — single process, single arena

### Decision

One Node.js process. One arena. One WebSocket listener. One container, one
port. **N = 8** concurrent connections for MVP (also the max-player number used
in §1's bandwidth math).

### Alternatives considered

| Option                                | Why rejected                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Multiple arenas per process**       | Premature. The simulation cost of one 8-player arena fits easily in one Node.js event loop at 60 Hz. Adding multiple arenas means juggling per-arena tick budgets — solve once we need to. |
| **One process per arena, load balancer in front** | Premature scaling. We have no mechanism for assigning players to arenas yet (no matchmaking — out of scope per #92).                                                            |
| **Authoritative client + relay server** | Trust model is wrong for a competitive PvP game. The whole point of §4 is that the server owns combat state.                                                                              |
| **Listen server (one player hosts)**  | Same trust problem, plus terrible ergonomics (host migration, NAT, host advantage).                                                                                                         |

### Process lifecycle

```
node server.js
   │
   ▼
init Rapier WASM (await RAPIER.init())   ← same as client; the existing async-init constraint in AGENTS.md applies server-side
   │
   ▼
build authoritative GameWorld
   - bitECS world
   - Rapier physics world
   - createArena(world)  ← reuse src/arena/createArena.ts; lights/scene refs are no-ops on server
   │
   ▼
open WS listener on PORT (default 3000)
   │
   ▼
accept up to N=8 connections
   │
   ▼
fixed-timestep loop @ 60 Hz   ← reuse the GameLoop pattern from src/core/GameLoop.ts
   - input drain
   - simulate fixed tick (combat → movement → physics → tracer → damage → health)
   - on every other tick: build snapshot, broadcast to all clients
   │
   ▼
SIGTERM / SIGINT
   │
   ▼
broadcast ServerShutdown { reasonCode } → flush → close WS listener → exit
```

The server is **not** a long-lived multi-arena scheduler. When the process
restarts, in-flight matches end. This is acceptable for MVP per
[`docs/MVP.md`](../MVP.md) ("Session state is ephemeral").

### Concurrency model

- One Node.js event loop. No worker threads. No `cluster`.
- The fixed-timestep loop is driven by `setImmediate` / `setTimeout` (server
  has no `requestAnimationFrame`). Doc 04 nails the exact accumulator pattern;
  the math is the same as `src/core/GameLoop.ts:13`.
- Per-connection WS handlers push received messages onto a per-connection
  inbound queue. The fixed-update tick drains these queues at the start of
  each tick — *no message handler ever mutates ECS state directly*. This
  guarantees all state mutation happens inside the deterministic tick.

---

## 3. Tickrate

### Three independent rates

| Rate                              | Value     | Why this number                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server fixed-update tick**      | **60 Hz** | Required to match `FIXED_TIMESTEP = 1 / 60` in `src/core/types.ts:17`. The combat FSM (`src/combat/CombatFSM.ts:224 — tick()`) decrements `_ticksRemaining` once per fixed update; weapon timing tables (windup/release/recovery) are expressed in these ticks. Changing the tickrate would silently change every weapon's swing speed. |
| **Server snapshot broadcast rate** | **30 Hz** | Every other tick. Halves outbound bandwidth and CPU spent on snapshot construction. Matches the natural client interpolation buffer of ~33 ms (the gap between two consecutive snapshots is what the client interpolates across).                                                                                                       |
| **Client render rate**            | **vsync** | Whatever the display does — typically 60–144 Hz. The client renders interpolated state between the two most recent snapshots. The existing `loop.render(alpha)` callback in `src/core/GameLoop.ts:62` already takes an interpolation alpha; we extend that pattern to snapshot-pair interpolation.                                       |

### Why 60 Hz server, not 30

The simulation MUST tick at 60 Hz internally. Halving simulation rate to match
broadcast would:

1. Break every weapon timing in the existing weapon-config table (windup
   counts in `src/weapons/longsword.ts` etc. are integer ticks at 60 Hz).
2. Halve the temporal resolution of the swept-volume tracer in
   `src/ecs/systems/TracerSystem.ts` — at 30 Hz, a fast swing would teleport
   the blade across enough world distance per tick that the swept volume
   misses small targets.
3. Make the parry window (8–10 ticks) coarse enough to feel laggy.

Snapshot rate is a **broadcast** decision, decoupled from simulation rate.
Server simulates at 60 Hz; broadcasts every second tick.

### Why 30 Hz broadcast, not 60

At 60 Hz broadcast, we'd send twice as many frames for no perceptible win:

- Animation interpolation already smooths render rates above 30 Hz.
- Direction-change reaction time in melee is dominated by the parry window
  (~130–170 ms), not snapshot latency.
- At 60 Hz × 8 clients × ~200 B/snapshot = ~96 KB/s outbound per server.
  At 30 Hz, ~48 KB/s. Both are tiny in absolute terms, but the 30 Hz rate
  leaves headroom for the events channel (kills, pickups, equipment changes)
  to ride alongside without back-pressuring.

### 3.1 Direction-detection window — 100 ms wall-clock

The current single-player code resolves directional attacks/blocks via
`InputManager.getAverageDelta(windowMs = 100)` at `src/input/InputManager.ts:205`.
This window is **wall-clock based**, which makes it non-deterministic in a
networked context: the server cannot reproduce the same 100 ms window from a
buffered stream of input frames unless the client also tells the server *when*
each delta arrived.

Two acceptable resolutions, exactly one MUST be chosen for the implementation:

#### Option A — Client resolves direction, server validates the enum *(recommended)*

- The client runs `getAverageDelta()` exactly as today, picks an
  `AttackDirection` / `BlockDirection`, and sends the resolved enum value as
  part of the `InputFrame`.
- The server validates only that:
  1. The reported direction is one of the legal enum values.
  2. The combat FSM is in a state that accepts that direction at the current
     tick (e.g. you cannot start a Windup while in Recovery).
- Server treats the direction enum as untrusted-but-bounded input.

**Why recommended:** keeps the determinism boundary at the FSM tick, where it
already lives. The server never has to reconstruct mouse motion. Cost: the
client can pick any direction it wants, but it cannot pick a direction the FSM
would reject — and the worst-case "the player picked the most-favourable legal
direction this tick" is functionally indistinguishable from a legitimate fast
mouse flick.

#### Option B — Client streams raw deltas, server reconstructs the window

- Each `InputFrame` carries the most recent N raw mouse delta samples
  (or a windowed moving sum) plus their tick numbers.
- Server runs an equivalent `getAverageDelta(windowTicks)` against its own
  buffer of received samples, **measured in ticks rather than ms**
  (100 ms ≈ 6 ticks at 60 Hz, but use a tick-count constant, not a wall-clock
  conversion at runtime).
- More server work, more bandwidth (every tick ships ~6 deltas), more code.

**Pick A.** This decision is binding for doc 02 (the InputFrame schema goes
there) and doc 03 (the wire encoding). If a future requirement forces B
(e.g. demo replay where we want byte-level reproducibility from raw input),
it can be added behind a protocol version bump.

### 3.2 Tick alignment

The server's tick counter is **monotonic**, starts at `0` on process boot, and
is included in every snapshot. Clients use it as the canonical clock; the
client's local fixed-update tick number is internal and never sent.

> Implementation note: the server's tick number ships as a `uint32`. At 60 Hz
> that wraps in ~828 days. For MVP we accept the wrap; doc 03 may upgrade to
> `uint64` if the server ever needs to run that long.

---

## 4. Authority model

The split below is the contract that all multiplayer code MUST honour. The
columns are: **server-authoritative** (server is sole writer), **client-predicted**
(client simulates locally, server reconciles), **client-only** (never crosses
the wire).

### 4.1 Server-authoritative

The server is the single source of truth for these. Clients render them but
never originate writes; any client message that purports to set them is
ignored.

| State                                                  | Where it lives today                                                               | Why server-authoritative                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `CombatStateComponent` (state, weaponId, direction, ticksRemaining) | `src/ecs/components.ts:92`                                                         | FSM transitions decide who-hit-whom. Letting clients write this is the entire problem.                  |
| `Health.current` / `Health.max`                        | `src/ecs/components.ts:106`                                                        | Trivial cheat target. Server is the only writer.                                                        |
| `Stamina.current` / `Stamina.max`                      | `src/ecs/components.ts:112`                                                        | Same as Health. Stamina drives whether attacks even start (`StaminaSystem.ts`).                         |
| `EquippedWeapon` *(new — see #103)*                    | will replace direct `CombatStateComponent.weaponId` writes                         | Determines hitbox geometry, damage, swing timing — must be authoritative.                               |
| `Gold` *(new — see #103)*                              | server-side ECS component                                                          | Currency is the integrity-critical economy primitive. Client never writes.                              |
| Kill / death events                                    | derived from `Health.current` crossing 0 in `HealthSystem.ts`                      | Drives killfeed, scoreboard, gold awards.                                                               |
| Weapon pickup events                                   | server-side proximity check + ownership transfer                                   | Anti-grief: server validates "you are within range of an existing pickup entity".                       |
| Hitbox collisions                                      | Rapier sensor queries, server-side, in `TracerSystem.ts`                           | The whole tracer pipeline runs server-side; clients receive the resolved damage event, not the raycast. |
| FSM transitions                                        | `src/combat/CombatFSM.ts:340 — _onTimerExpired`                                    | Cascades through every other authoritative system.                                                       |

The existing single-player pipeline is **already structured for this split**:

```
   CombatSystem  →  TracerSystem  →  DamageSystem  →  HealthSystem
   (FSM ticks)     (sensor queries)  (apply damage)    (death, gold,
                                                        kill events)
```

That pipeline runs **server-side, end to end**, in the multiplayer build. No
new systems are needed; existing systems gain a server-only invocation site.
The `_pendingStaminaEvents` queue inside `CombatFSM.ts:57` (drained by
`CombatSystem` each tick) stays server-authoritative — clients never see
stamina events directly, only the resulting `Stamina.current` value in the
next snapshot.

### 4.2 Client-predicted (with server reconciliation)

The client simulates these immediately on input, for responsiveness. The
server runs the same simulation deterministically and includes the canonical
result in each snapshot. If the client's prediction diverges, it reconciles
(see §5).

| State                       | Why predicted                                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Position` (`components.ts:7`)        | WASD must feel instant. A 50 ms RTT is enough to make non-predicted movement feel laggy.                                                                                |
| `Rotation` (`components.ts:21`)       | Mouse-look must be free. Yaw/pitch are owned by the local player at all times; server clamps but does not snap.                                                         |
| `Velocity` (`components.ts:35`)       | Derived state — predicted to keep the integrator consistent with predicted Position.                                                                                    |
| `MovementState` (`components.ts:54`)  | Grounded / jumping / crouched flags drive local movement math; needed to predict gravity/jump correctly.                                                                |

`MovementSystem` (`src/ecs/systems/MovementSystem.ts`) is **the prediction
boundary**. Everything to its left in the tick order (input drain) is local;
everything to its right (combat, tracer, damage) is server-authoritative.

### 4.3 Client-only (never sent over the wire)

The server does not know about any of this and never will. It is purely
rendering / UI state.

- All of `src/rendering/*` — `CameraController`, `CharacterModel`,
  `WeaponModels`, `ViewmodelRenderer`, `ViewmodelAnimationSystem`,
  `DebugRenderer`.
- `AnimationComp` (`components.ts:185`) — derived from
  `CombatStateComp` which is itself a render-side mirror.
- `PreviousPosition` / `PreviousRotation` — computed client-side from
  consecutive snapshots, used for render interpolation. **Never** received
  over the wire; they are a local artifact of the interpolation buffer.
- HUD: `HealthBar`, `StaminaBar`, `DirectionIndicator`, `Killfeed`,
  `Scoreboard`, `GoldCounter`, `DebugOverlay`. All read snapshot values via
  the local ECS world — they never poll the network directly.
- Module-level singletons: `meshRegistry`, `weaponModelFactories`,
  `hitboxColliderRegistry` (server holds its own version of the last one).
- The viewmodel layer (Layer 1, separate camera, FOV 70 in
  `ViewmodelRenderer`) is purely client-side and renders only for the local
  player.

### 4.4 Worked example — what happens when the player swings

To make the split concrete, here is the round trip for one Mordhau-style
overhead attack:

1. **t = 0 ms (client).** Player flicks mouse up, presses LMB. Client's
   `InputManager` resolves direction = `Overhead` (the 100 ms window from §3.1
   is computed locally, per Option A). Client builds an `InputFrame` with
   tick number, sends it.
2. **t = 0 ms (client, same tick).** Client does **not** start the Windup
   locally — combat state is server-authoritative (§4.1). The client waits.
3. **t ≈ 25 ms (server).** Server receives the InputFrame, drains it at the
   start of its next fixed tick. `CombatSystem` validates the direction enum,
   transitions the FSM to `Windup`, sets `_ticksRemaining` from the weapon
   config.
4. **t ≈ 33 ms (server).** Next 30 Hz broadcast tick. Snapshot includes
   `CombatStateComponent.state = Windup`, `direction = Overhead`,
   `ticksRemaining = N`.
5. **t ≈ 50 ms (client).** Client receives snapshot, applies it, the local
   ECS world now reflects `Windup`. Animation system reads it on next
   `update()`, viewmodel begins the windup pose. Crossfade kicks in via the
   existing 80 ms blend in `ViewmodelAnimationSystem`.
6. **t ≈ 50 ms — end of swing (server).** Server keeps ticking the FSM.
   Tracer fires every Release tick, hits resolve in `TracerSystem` →
   `DamageSystem` → `HealthSystem`. Damage events broadcast next 30 Hz tick.

The total perceived latency from input to viewmodel reaction is one-way RTT
(~25 ms) plus a worst-case half snapshot interval (~17 ms) plus animation
crossfade (~80 ms) — call it ~125 ms in good network conditions. For melee
this is within tolerance. The visual *response* (viewmodel arm starts moving)
is what the player notices; that lag is dominated by the animation crossfade,
not the network.

> **Note on movement vs. combat asymmetry.** Movement is predicted, combat is
> not. This is deliberate: misprediction on movement is recoverable (snap or
> smooth-correct, see §5). Misprediction on combat is not — if the client
> showed a swing landing and the server ruled otherwise, undoing the visual
> would be jarring and abusable.

---

## 5. Reconciliation strategy

This applies *only* to client-predicted state (§4.2) — `Position`, `Rotation`,
`Velocity`, `MovementState`.

### 5.1 The problem

The client has been simulating movement locally for some number of ticks since
its last server snapshot. The server has now produced a new snapshot for an
earlier tick than the client's current local tick. The snapshot's
`Position` / `Rotation` may disagree with the client's predicted values for
that same tick. We want:

- The local player's character does **not** rubber-band on every snapshot.
- If the client mispredicted (e.g. server detected a wall the client didn't
  account for), the character ends up at the correct position.
- Other players' characters render smoothly between snapshots without
  prediction (their inputs are not known locally).

### 5.2 Rewind-and-replay (local player only)

```
On InputFrame(tick=T):
  1. Client tags the frame with tick T (monotonic).
  2. Client buffers (T, predicted_position, predicted_rotation) in a ring
     buffer of size 60 (≈ 1 s of ticks).
  3. Client runs MovementSystem locally, updates Position/Rotation/Velocity.
  4. Client sends InputFrame to server.

On Snapshot(server_tick=S, last_processed_input_tick=L):
  5. If L < oldest tick in buffer  →  buffer overflow, see §5.4.
  6. Find buffer entry at tick L.  Compare:
        delta = | snapshot.position - buffer[L].predicted_position |
  7. If delta < 0.05 m   →  no correction needed.  Just discard buffer
                            entries ≤ L.
  8. If delta < 0.5 m    →  smooth-correct (§5.3).
  9. If delta ≥ 0.5 m    →  hard snap.  Set Position to snapshot.position,
                            then re-run MovementSystem for every buffered
                            input frame after L to "replay" inputs the
                            server hasn't acknowledged yet.
```

The ring buffer holds **only** `(tick, position_x, position_y, position_z,
rotation_x, rotation_y, rotation_z)` for the local player. ~28 bytes ×
60 entries = ~1.7 KB. We do **not** rewind the whole ECS world. bitECS does
not support that, and we do not need it: every other component (combat,
health, stamina, gold) is server-authoritative and arrives in the snapshot
already canonical.

### 5.3 Smooth-correct

Instead of snapping, the client applies the difference as a render-only
offset that decays linearly to zero over **100 ms (6 ticks)**. The
authoritative ECS `Position` is set to the server value immediately; the
visual mesh is offset by `(server_pos - client_pos)` at correction-start, and
that offset shrinks to zero across the next 6 fixed ticks. This is the same
mesh-vs-ECS decoupling we already need for render interpolation between
snapshots.

### 5.4 Edge cases

- **Buffer overflow (server snapshot is ancient).** If `L` is older than the
  oldest buffered tick, the network has stalled badly; client treats this as
  a hard snap to `snapshot.position` and clears the buffer. No replay possible.
- **Snapshot from the future.** Discard. Should never happen if `serverTick`
  is monotonic.
- **First snapshot after join.** Client has no buffered history. Take the
  snapshot as ground truth, no reconciliation.

### 5.5 Other players

For non-local entities, no prediction. The client renders them **interpolated
between the two most recent snapshots** (~33 ms behind real-time). Their
animations are driven entirely by the snapshot stream. This is the trade-off:
remote players look slightly stale but never rubber-band.

> Implementation hint for doc 04: the existing `PreviousPosition` /
> `PreviousRotation` components (`components.ts:14`, `:28`) already model
> "previous tick value, current tick value" for animation interpolation in
> single-player. In multiplayer, the same components hold "previous snapshot,
> current snapshot" for remote entities. The render-side
> `lerp(PreviousPosition, Position, alpha)` math is unchanged.

---

## 6. Anti-cheat baseline

This is an overview pointer. The full validation rule set goes in **doc 03 —
message protocol**, where each rule is bound to a specific message type and
error code.

The server enforces, **at minimum**, the following invariants. None of these
require statistical / heuristic cheat detection — they are pure correctness
checks on each incoming `InputFrame` or action message.

1. **Server ignores any client-reported HP, damage, gold, or kills.** Those
   fields, if present in any client→server message, MUST be discarded (not
   logged as errors — silently dropped, since a buggy client could send them
   too).
2. **Max movement speed per tick.** Server validates that the position
   delta between consecutive InputFrames does not exceed
   `SPRINT_SPEED * FIXED_TIMESTEP * tolerance_factor`. Currently
   `6.5 * (1/60) * 1.5 ≈ 0.16 m/tick`. Exceeds → server snaps to its own
   simulated position (not the client's claim).
3. **InputFrame rate limit.** ≤ 60 frames per second per connection
   (matches tick rate). Bursts above this are dropped; sustained bursts
   trigger a kick after 1 s.
4. **Weapon swap validation.** "Switch to weapon X" is rejected unless the
   server-side `Inventory` for that player includes X.
5. **Pickup validation.** "Pick up world weapon Y" is rejected unless
   (a) world entity Y exists, (b) the player is within `PICKUP_RADIUS` of Y
   per the server's authoritative `Position`.
6. **Gold writes are server-only.** No client message can add or set gold.
   Awards come only from `awardGoldOnKill` triggered by the
   `HealthSystem` death detection (already structured this way per memory
   note on #103).
7. **Pointer-lock state is informational.** Server doesn't trust it, doesn't
   need to. Input frames sent while client claims pointer-lock-released are
   accepted; the server's only contract is that the player is alive and
   the FSM is in an input-accepting state.

Out of scope for MVP: speed-hack detection beyond the per-tick check, aimbot
heuristics, wall-hack detection (server already only sends entities you can
see — that's a doc-02 concern, interest management), packet replay attacks
(mitigated by tick-monotonicity), DoS rate-limits beyond rule 3.

---

## 7. Joining flow (high-level)

The full handshake (with byte layouts, error codes, and version negotiation)
is in **doc 03**. This section is the high-level shape only.

```
Client                                              Server
  │                                                   │
  │  WS upgrade request (TLS)                         │
  ├──────────────────────────────────────────────────►│
  │                                                   │  (accept; no app
  │                                                   │   logic yet)
  │                                                   │
  │  Hello { protocolVersion, clientNonce }           │
  ├──────────────────────────────────────────────────►│
  │                                                   │  (validate version,
  │                                                   │   pick spawn point,
  │                                                   │   create ECS entity)
  │                                                   │
  │  Welcome {                                        │
  │    clientEid,            // server-assigned       │
  │    initialSnapshot,      // full world state      │
  │    serverTick,           // current server tick   │
  │    protocolVersion       // echo                  │
  │  }                                                │
  │◄──────────────────────────────────────────────────┤
  │                                                   │
  │ (client builds local ECS from snapshot,           │
  │  starts loop, requests pointer lock)              │
  │                                                   │
  │  InputFrame { tick=0, ... }                       │
  ├──────────────────────────────────────────────────►│
  │                                                   │
  │            ... steady-state simulation ...        │
  │                                                   │
```

### Protocol versioning

A constant `PROTOCOL_VERSION` lives at `src/shared/protocol/version.ts`
(directory does not exist yet — it gets created in the first multiplayer
implementation PR). Bump on **any** breaking wire-format change. The server's
`Hello` handler MUST reject mismatching versions with a structured error
(`PROTOCOL_VERSION_MISMATCH`, code in doc 03), not a silent disconnect, so
the client can show "Update your client" instead of "Disconnected".

### Spawn-point selection on join

Reuse `selectSpawnPoint` from `src/world/SpawnPoints.ts` (per the
spawn/death/respawn design doc). Server picks the spawn at the moment of
`Welcome`; the chosen `Position` is part of the initial snapshot.

---

## 8. Disconnect / reconnect

```
WS close (TCP RST, ping timeout, or graceful Bye)
   │
   ▼
Server marks entity {Disconnected = true}
   - FSM tick is skipped for this entity (treated like DeadTag)
   - Physics tick is skipped for this entity (frozen in place)
   - Snapshot still includes this entity, with the Disconnected flag set —
     so OTHER clients can render the player as inactive (e.g. translucent
     mesh, name greyed)
   │
   ▼
Start 5-second grace timer
   │
   ├─── reconnect within 5 s ───►   Server matches by clientEid + clientNonce
   │                                from the original Hello.  Sends a fresh
   │                                Welcome { reused clientEid, current snapshot,
   │                                current serverTick }.  Clears Disconnected.
   │                                Resume from server-side state.
   │
   └─── grace expires ───────────►  Drop weapon: spawn world-weapon entity at
                                    last server-side Position with the player's
                                    held weapon (per #94 design — out of scope
                                    here).  Despawn the player entity.
                                    Broadcast PlayerLeft { eid }.
```

Notes:

- The **5-second** grace is wall-clock, not ticks. It survives a server
  doing slow ticks because of GC, etc.
- During grace, the entity is visible to other players but inert. This is
  deliberate: it makes "rage-quit" indistinguishable from "Wi-Fi dropped"
  from the perspective of the other players for the first 5 seconds. After
  5 s, the weapon-drop signals "they're gone for good".
- **Reconnect identifies the player by `clientNonce` + `clientEid`**, not
  IP or any browser-side identity. The nonce is generated client-side at
  Hello time and stored in `sessionStorage` for the duration of the tab.
  Closing the tab → lose nonce → cannot reconnect (intended; the entity will
  drop weapons and despawn at grace expiry).
- **No matchmaking, no rejoin queue.** If reconnect arrives after grace
  expires or a different client connects with the same nonce, the server
  treats it as a new join (rule 6 of §6 still applies — the new player has
  zero gold).

---

## Appendix A — Authority cheatsheet

Pin this on the wall when implementing.

```
                   ┌──────────────────────┬──────────────────────┐
                   │      Server          │       Client         │
                   │ (sole writer, then   │ (renders snapshots,  │
                   │  broadcasts)         │  predicts movement)  │
┌──────────────────┼──────────────────────┼──────────────────────┤
│ CombatState      │  WRITE               │  READ-ONLY           │
│ Health, Stamina  │  WRITE               │  READ-ONLY           │
│ Equipped, Gold   │  WRITE               │  READ-ONLY           │
│ Hitbox / Tracer  │  WRITE               │  (does not run)      │
│ FSM transitions  │  WRITE               │  (does not run)      │
├──────────────────┼──────────────────────┼──────────────────────┤
│ Position         │  WRITE (canonical)   │  PREDICT, reconcile  │
│ Rotation         │  WRITE (canonical)   │  PREDICT, reconcile  │
│ Velocity         │  WRITE (canonical)   │  PREDICT, reconcile  │
│ MovementState    │  WRITE (canonical)   │  PREDICT, reconcile  │
├──────────────────┼──────────────────────┼──────────────────────┤
│ AnimationComp    │  (does not run)      │  WRITE (local)       │
│ PreviousPos/Rot  │  (does not run)      │  WRITE (from snaps)  │
│ Camera           │  (does not run)      │  WRITE (local)       │
│ Viewmodel        │  (does not run)      │  WRITE (local)       │
│ HUD              │  (does not run)      │  WRITE (local)       │
└──────────────────┴──────────────────────┴──────────────────────┘
```

## Appendix B — Source-file pin map

Every architectural claim above pins to specific code. When refactoring any of
these files, check that this doc still describes them correctly (and update
both in the same PR if not).

| Claim                                                  | File / line                                                |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| Server fixed-update tick MUST be 60 Hz                 | `src/core/types.ts:17` (`FIXED_TIMESTEP = 1 / 60`)         |
| Fixed-timestep accumulator pattern reused server-side  | `src/core/GameLoop.ts:13` (class `GameLoop`)               |
| FSM is the FSM-transition authority                    | `src/combat/CombatFSM.ts:224` (`tick()`)                   |
| FSM auto-transitions on timer expiry                   | `src/combat/CombatFSM.ts:340` (`_onTimerExpired`)          |
| Stamina events drained per tick by CombatSystem        | `src/combat/CombatFSM.ts:57` (`_pendingStaminaEvents`)     |
| Authoritative chain — combat → tracer → damage → health | `src/main.ts:248-270` (system wiring)                     |
| Movement is the prediction boundary                    | `src/ecs/systems/MovementSystem.ts`                        |
| Tracer math expects 60 Hz                              | `src/ecs/systems/TracerSystem.ts` (swept-volume)           |
| 100 ms direction-detection window (must be tick-bounded for net) | `src/input/InputManager.ts:205` (`getAverageDelta`) |
| Components list (full authoritative-vs-predicted split) | `src/ecs/components.ts`                                   |
| Spawn-point selection                                  | `src/world/SpawnPoints.ts` (per spawn/death/respawn doc)   |
| Single-port deploy                                     | `.github/workflows/deploy-staging.yml` (3000 → 3010)       |
