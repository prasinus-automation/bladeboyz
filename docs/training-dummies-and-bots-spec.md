# Training Dummies and Solo Warmup Bots — Architect Spec

**Status:** Architect deliverable for issue #99. Implementation blocked on #86 (character controller), #88 (combat FSM v2), #93 (spawn/death/respawn).

**Audience:** Frontend/backend dev agents who will implement this once the foundation issues land.

---

## 1. Goals

- Single-player remains valuable for testing and warmup even after multiplayer ships.
- Replace the current broken stationary dummy (`src/ecs/entities/createDummy.ts`) with a clean training dummy that:
  - Stands on the ground (currently hovers — symptom of #86).
  - Takes damage with floating numbers (already works via `DummyDamageObserver`).
  - Resets on `K`.
- Optional stretch: a single warmup bot that walks toward you and swings — toggle with `B`.
- The same code path must work in multiplayer: dummies and bots are server-spawned NPC entities that replicate to clients exactly like remote players.

## 2. Non-goals (MVP)

- No navmesh / pathfinding / steering behaviors.
- No squads, formations, or multiple bot personalities.
- No difficulty levels or bot tuning UI.
- No bot-vs-bot, no bot-vs-dummy.
- No K reset in multiplayer (single-player only or admin-only).

---

## 3. Training dummy spec

### Behavior
- Pinned to spawn position. Does not translate. Does not turn (faces a fixed yaw set at spawn).
- Has full HP/Stamina (100/100). Takes damage via the existing tracer → DamageSystem → HealthSystem pipeline.
- Floating damage numbers spawn over the dummy on hit (existing `FloatingDamage` HUD module).
- Auto-regen to full HP after 3 seconds of no incoming damage (current behavior — preserve).
- `K` key resets ALL training dummies in the arena: HP/Stamina to max, FSM to `Idle`, damage cooldown reset.
- Optional debug controls (preserve from current `createDummy.ts`):
  - `T` — toggle dummy block on/off (for testing block animations).
  - `Y` — cycle dummy block direction.
  - `J` — spawn next dummy at next position in cycle.

### Visual
- Reuses `createCharacterModel(color)` — same skeleton/mesh as the player.
- Default color `0xcc4444` (current red). Spawn cycler uses 8 distinct colors (preserve current `DUMMY_SPAWN_POSITIONS`).
- Equipped weapon model rendered at `weapon_attach` bone (currently the dummy has the bone but no weapon — should hold the same starter weapon as the player so it looks like a sparring partner).

### Physics (changes for #86 compliance)
- **Currently broken:** dummy has no `PhysicsBody`. Floats at `SPAWN_HEIGHT` because nothing grounds it.
- **After #86:** dummy gets a `PhysicsBody` (Rapier kinematic capsule) with the same dimensions and ground convention as the player. Spawn raycast snaps feet to ground. Velocity is held at zero — kinematic body is moved only when explicitly teleported by `K` reset.
- Hitbox sensor colliders unchanged from current implementation (`createHitboxes`).

### ECS components (post-#88)
- `Position`, `Rotation`, `Velocity` (zero), `CharacterModel`, `Health`, `Stamina`, `Hitboxes`, `CombatStateComp`, `CombatStateComponent`, `AnimationComp`, `TracerTag`, `PhysicsBody`, **`IsNPC` (new tag)**, **`IsTrainingDummy` (new tag)**.
- `TracerTag` is kept so the dummy can swing during block-test poses (the `T`/`Y` debug paths exercise block-on-incoming-swing).

### Reset semantics (`K` key)
- Iterates a generic `npcRegistry: Map<eid, NpcMeta>` filtered by `IsTrainingDummy`. The current `activeDummies: number[]` array goes away — see §6.

---

## 4. Warmup bot spec (stretch)

### Off by default
- Spawn only when the player presses `B` (free key — confirmed unbound).
- One bot at a time. `B` toggles spawn/despawn.
- Bot despawns automatically if the player disconnects in multiplayer or leaves single-player.

### Behavior (intentionally minimal)
- Three modes in a tiny FSM driven by a `BotBrain` component:
  - `Approach` — outside `meleeRange` (default 2.5 m). Walks toward target's current position.
    - No pathfinding. Direct `(targetPos - botPos).normalize() * walkSpeed`.
    - If a flat-ground arena (per #91), this is sufficient. Step-up handled by character controller (#86).
  - `Engage` — inside `meleeRange`. Picks a random attack direction (Top/Left/Right/Stab) every `decisionCooldownTicks` (default 60 = 1s). Issues a swing through the same Combat FSM v2 path the player uses (#88). No feinting, no chaining, no parry attempts for MVP.
  - `Reposition` — entered briefly after a swing's recovery. Backs up 0.5 m, then re-evaluates.
- Bot does NOT block. Bot does NOT parry. Bot does NOT dodge.
- Bot uses default starter weapon from #93. No weapon switching.

### Decision tick
- Bot AI runs in a new `BotAISystem` at fixed-update rate (60 Hz), but only re-decides every `decisionCooldownTicks` ticks. Between decisions, the bot just keeps executing its current intent.
- Bot writes movement intent into the same `MovementState` component the player uses — `MovementSystem` (#86) does the actual physics step. This guarantees bots move identically to players.

### Components
- `IsNPC` (tag, shared with dummies).
- `IsBot` (tag).
- `BotBrain { targetEid: u32, mode: u8 (0=Approach, 1=Engage, 2=Reposition), lastDecisionTick: i32, lastSwingTick: i32 }`.
- `MovementState` (reused — same as player).
- All combat/render components a player has (Health, Stamina, CombatStateComp/Component, etc.).

### Combat FSM integration
- Bot transitions through `Idle → Windup → Release → Recovery` exactly like a player. The new `BotAISystem` enqueues the swing intent during the `Idle` state — the FSM handles the rest.
- Stamina is consumed by the FSM the same way it is for players. If stamina is too low, the bot's swing is rejected and it idles until it recovers — natural difficulty scaling for free.

---

## 5. Multiplayer integration (`#92`)

NPCs are **server-authoritative entities** that replicate to clients with the same protocol as remote players, with one extra component flag (`IsNPC`).

### Spawning
- Server spawns training dummies as part of arena boot (same as static props).
- Server spawns warmup bots in response to a client request: client sends `{ type: 'TOGGLE_WARMUP_BOT' }`; server gates on a per-arena policy (e.g., dev/staging arenas allow it, prod competitive arenas reject it).

### Replication
- NPCs replicate the same component set as players: `Position`, `Rotation`, `Velocity`, `CombatStateComp`, `CombatStateComponent`, `Health`, `Stamina`, `EquippedWeapon`.
- Plus `IsNPC` (tag) so the client can render them with NPC-specific HUD chrome (e.g., "DUMMY" nameplate instead of a player name).
- Bot AI runs **only on the server**. Clients never simulate bot decisions — they just render the replicated state.

### Single-player mode
- Single-player runs the server tick loop in-process (no WebSocket). Same `BotAISystem`, same `tickDummyHealthReset`. From the game systems' perspective there is no difference between SP and MP.
- This is the recommended pattern from #92 (server-authoritative for hits and gold) — single-player is just "server tick loop in the same JS context."

### Authority
- `K` reset and `B` toggle are client → server requests. Server validates against arena policy. Client never directly mutates HP.
- Damage to NPCs flows through the server-side DamageSystem the same way damage to players does.

### Killfeed / score
- Killing a bot does NOT count toward score (it's a warmup tool). Killing a dummy does NOT count either. Per #93's score model, only player kills produce killfeed entries and gold.
- Optionally: track bot kills in a debug overlay for tuning.

---

## 6. Refactor: replace `activeDummies` with a generic NPC registry

The current code couples the damage observer to dummies via a hardcoded `activeDummies: number[]` array. This breaks the moment we add bots, server-spawned NPCs, or any other non-player entity.

### New side-table
```ts
// src/ecs/npcRegistry.ts
export interface NpcMeta {
  kind: 'training-dummy' | 'warmup-bot';
  spawnPos: { x: number; y: number; z: number };
  spawnYaw: number;
  spawnTick: number;
}
export const npcRegistry: Map<number, NpcMeta> = new Map();
```

### Migration of `DummyDamageObserver`
- Rename to `NpcDamageObserver`.
- Fires floating damage numbers for any entity in `npcRegistry` (or with `IsNPC` tag — pick one and stick to it; recommend `IsNPC` since bitECS queries are faster than Map lookups).
- Records hit-tick for any NPC with auto-regen (training dummies). Bots do not regen.

### Migration of dummy reset
- `resetAllTrainingDummies(world)` queries `defineQuery([IsTrainingDummy])` instead of iterating `activeDummies`.
- `recordDummyHit` becomes `recordNpcHit` — no behavioral change, just naming.

---

## 7. Entity factory signatures

These are the contracts dev agents implement against. Place factories in `src/ecs/entities/`.

```ts
// src/ecs/entities/createTrainingDummy.ts
export interface CreateTrainingDummyOpts {
  spawnPos: { x: number; y: number; z: number };
  /** Y-rotation in radians. Default Math.PI (faces +Z toward player spawn). */
  facing?: number;
  /** Hex color for the procedural mesh. Default 0xcc4444 (red). */
  color?: number;
  /**
   * Weapon name from weaponConfigs registry. Default: same as player starter
   * weapon (Longsword per #93). Pass `null` to spawn unarmed.
   */
  startingWeapon?: string | null;
}

export function createTrainingDummy(
  world: GameWorld,
  opts: CreateTrainingDummyOpts,
): { eid: number; mesh: THREE.Group };

/** Reset all entities tagged IsTrainingDummy: HP, stamina, FSM, damage cooldown. */
export function resetAllTrainingDummies(world: GameWorld): void;

/** Despawn one dummy, dispose meshes, remove from registries. */
export function removeTrainingDummy(world: GameWorld, eid: number): void;
```

```ts
// src/ecs/entities/createWarmupBot.ts
export interface CreateWarmupBotOpts {
  spawnPos: { x: number; y: number; z: number };
  /** Entity to chase. Required — usually the local player eid. */
  targetEid: number;
  /** Default 0x444488 (blue, distinguishes from red dummies). */
  color?: number;
  /** Default: same as player starter weapon. */
  startingWeapon?: string;
  /** Distance (m) at which bot transitions Approach → Engage. Default 2.5. */
  meleeRange?: number;
  /** Walk speed (m/s). Default = player walk speed from #86. */
  walkSpeed?: number;
  /** How often (ticks) the bot re-decides its action. Default 60 (1s). */
  decisionCooldownTicks?: number;
}

export function createWarmupBot(
  world: GameWorld,
  opts: CreateWarmupBotOpts,
): { eid: number; mesh: THREE.Group };

export function removeWarmupBot(world: GameWorld, eid: number): void;

/**
 * Single-player convenience: if a bot exists, despawn it; otherwise spawn one
 * targeting the local player. Returns the new active state.
 */
export function toggleWarmupBot(
  world: GameWorld,
  localPlayerEid: number,
): boolean;
```

```ts
// src/ecs/systems/BotAISystem.ts
/**
 * Fixed-update system. Iterates entities with [IsBot, BotBrain].
 * Updates BotBrain.mode, writes movement intent into MovementState, and
 * issues swing intents into the Combat FSM.
 */
export function createBotAISystem(world: GameWorld): (tickDt: number) => void;
```

---

## 8. Component additions to `src/ecs/components.ts`

```ts
// Tag: any non-player NPC (training dummies, bots, future shopkeeps).
export const IsNPC = defineComponent();

// Tag: training dummy specifically (subset of IsNPC).
export const IsTrainingDummy = defineComponent();

// Tag: warmup bot specifically (subset of IsNPC).
export const IsBot = defineComponent();

// Per-bot AI state. Only attached to entities with IsBot.
export const BotBrain = defineComponent({
  targetEid: Types.ui32,
  mode: Types.ui8,            // 0=Approach, 1=Engage, 2=Reposition
  lastDecisionTick: Types.i32,
  lastSwingTick: Types.i32,
});
```

The shopkeep in #96 will reuse `IsNPC` + a new `IsShopkeep` tag — design accommodates that.

---

## 9. Acceptance tests (informal — no test issue blocks this spec)

- Spawn a training dummy. Hit it with the player. HP drops, floating numbers appear, dummy reverts to full HP after 3 s no-hit.
- Press `K`. All dummies reset to full HP regardless of prior state.
- Press `B`. A blue bot spawns near the player and walks toward them. Within `meleeRange`, the bot starts swinging at random directions. Player can damage and kill the bot using the same combat as PvP.
- After bot's HP hits 0, bot despawns. Pressing `B` again spawns a fresh one.
- In multiplayer (post-#92), all clients see the same dummies and the same bot in sync. Only the host/server's `K` and `B` press has effect (or per-arena policy).
- Removing the `IsTrainingDummy` tag is enough to stop a dummy from being included in `K` reset (proves the tag-based filter, not a hardcoded list).

---

## 10. Open questions for the developer

These are intentionally left for the implementing dev to call out in PR review — not pre-decided here:

- **Bot animation:** does the bot need any AI-specific animation states (e.g., "approaching" walk-cycle), or does the existing locomotion + combat animation pipeline cover it? Likely the latter.
- **Bot facing during Approach:** should we cap turn rate, or let bots snap-rotate? Recommend honoring the same turncap as players (#78) for consistency, but the implementing dev should sanity-check this feels right.
- **Multiple bots:** the spec says "one bot at a time," but the registry/AI system handles N bots fine. If this is trivially extensible at PR time, expose `B` (1 bot) and a hidden debug `Shift+B` (10 bots) — but only if it costs ~5 lines.
