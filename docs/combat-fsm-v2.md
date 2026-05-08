# Combat FSM v2 — Architecture

**Status**: Architect spec, ready for implementation
**Tracks**: Issue #88
**Depends on**: #85 (Foundation MVP scope) — keep/rewrite/delete decisions land first

---

## 1. Goals

A clean, **data-driven** combat FSM that produces simple but rewarding directional melee combat. Mouse direction picks attack direction; LMB swings; RMB blocks (hold) and parries (well-timed press during incoming swing). Stamina gates spam. Every timing value lives in `WeaponConfig` — no system-side magic numbers.

Today's FSM has 11 states, two parallel state components (`CombatStateComponent` and `CombatStateComp`), parry detection scattered between `CombatFSM` and `DamageSystem`, and at least three places that write the state component directly bypassing the FSM (`DamageSystem.ts:109,128,146`, `StaminaSystem.ts:99-100`). v2 cuts the state count, unifies the components, and routes every state change through the FSM.

---

## 2. State list

**7 states**, down from 11. Numeric values matter — they're written into `CombatState.state` (ui8) and read by `DirectionIndicator` and the animation systems.

| Id | Name        | Has fixed duration? | Turncap source                  |
|----|-------------|--------------------|----------------------------------|
| 0  | `Idle`      | No                 | `Infinity`                       |
| 1  | `Windup`    | Yes — `windup[dir]`     | `weapon.turncap.windup`     |
| 2  | `Release`   | Yes — `release[dir]`    | `weapon.turncap.release`    |
| 3  | `Recovery`  | Yes — `recovery[dir]` (or `comboRecovery[dir]`) | `weapon.turncap.recovery` |
| 4  | `Blocking`  | No                 | `Infinity`                       |
| 5  | `Parry`     | Yes — `parryRecovery`   | `weapon.turncap.recovery`   |
| 6  | `HitStun`   | Yes — `hitStunTicks` or `parryStunTicks` | `weapon.turncap.hitStun` (NEW; default `0.005 rad/tick`) |

**Dropped from v1**:

- `Feint` — nice-to-have feint mechanic. Cut for MVP. Re-add post-MVP behind a weapon config flag (`canFeint: boolean`). The current code already feints in 3 ticks with no anim support, which is worse than nothing.
- `Riposte` — Mortal-Online-style "free swing after parry". MVP collapses post-parry into normal `Recovery`/`Blocking` flow. Re-add post-MVP as a separate state.
- `Clash` — never reachable in current code (no input transitions to it). Drop.
- `Stunned` — separate from `HitStun` only because of block-break stagger. Collapse: block-break also routes to `HitStun`. One vulnerability state is enough.
- `ParryWindow` (separate state) — replaced by a *time window* inside `Blocking`. The first `weapon.parryWindow` ticks of `Blocking` (where `Blocking` was entered by an RMB *just-press*, not held-from-before) count as parryable. This matches Mordhau more closely than a separate state and eliminates one transition rule.

---

## 3. Transition diagram

```
                       LMB(just-press) + stamina ≥ attack
        ┌────────────────────────────────────────────────────┐
        │                                                    ▼
   ┌─────────┐  RMB(just-press)        ┌──────────┐
   │  Idle   │ ──────────────────────► │ Blocking │ ◄──┐
   └─────────┘                         └──────────┘    │ RMB held; tracer
        ▲                                  │           │ hit while elapsed
        │ phaseElapsed >= phaseTotal       │           │ > parryWindow
        │ AND no LMB queued                │           │ → BlockedHit
        │                                  │           │ (target stays Blocking,
   ┌──────────┐                            │ RMB up    │  attacker → Recovery,
   │ Recovery │                            ▼           │  target loses stamina)
   └──────────┘                         ┌──────────┐   │
        ▲                               │   Idle   │   │
        │ phase ends                    └──────────┘   │
        │                                              │
   ┌──────────┐  phase ends                            │
   │ Release  │ ─────────────────────► fires tracer ───┤
   └──────────┘  every tick during this state          │
        ▲                                              │
        │ phase ends                                   │
        │                                              │
   ┌──────────┐                                        │
   │  Windup  │ ◄── Idle                               │
   │          │     (LMB)                              │
   │          │                                        │
   │          │ ── morph (LMB-press during Windup,     │
   │          │     same FSM, swaps direction,         │
   │          │     restarts windup timer; no          │
   │          │     stamina cost)                      │
   └──────────┘                                        │
                                                       │
   Tracer hits target in Blocking                      │
   AND target's Blocking elapsed ≤ weapon.parryWindow ─┘
   AND that Blocking entry was an RMB just-press
        │
        │ → ParryTriggered
        ▼
   ┌─────────┐
   │  Parry  │ (target) — pose locked for parryRecovery ticks → returns to Blocking
   └─────────┘
        ║
        ╚═► attacker forced into HitStun for parryStunTicks

   Tracer hits target NOT in Blocking
        │
        │ → HitLanded
        ▼
   ┌──────────┐
   │ HitStun  │ (target) — locked for hitStunTicks → Recovery → Idle
   └──────────┘

   Stamina ≤ 0 while in Blocking
        │ → BlockBreak
        ▼
   ┌──────────┐
   │ HitStun  │ (target) — same path as taking a hit
   └──────────┘
```

### Transition rules (canonical)

All transitions go through `FSM.transition(input)`. **No external code writes `state` directly.**

| From       | Input                                  | To         | Side effects                                             |
|------------|----------------------------------------|------------|----------------------------------------------------------|
| Idle       | `Attack(dir)` (gated: stamina ≥ attack) | Windup     | charge `staminaCost.attack`; record direction            |
| Idle       | `Block(dir)`                            | Blocking   | record direction; mark `blockingEntryTick = now`         |
| Windup     | `Attack(newDir)` (morph)                | Windup     | swap direction; restart windup timer; no stamina cost    |
| Windup     | phase end                               | Release    | —                                                        |
| Windup     | `HitReceived` / `BlockBreak`            | HitStun    | apply damage if any; clear pending swing                 |
| Release    | phase end                               | Recovery   | —                                                        |
| Release    | `WasParried`                            | HitStun    | duration = `parryStunTicks`; canceled swing              |
| Release    | `BlockedHit`                            | Recovery   | drain attacker no stamina; defender stamina drains       |
| Release    | `HitReceived`                           | HitStun    | (rare; can be hit during own release)                    |
| Recovery   | phase end                               | Idle       | optional: comboRecovery if LMB pressed during recovery — see §6 |
| Recovery   | `Block(dir)` (after `comboRecovery` ends) | Blocking | record direction                                         |
| Recovery   | `HitReceived`                           | HitStun    | —                                                        |
| Blocking   | `ReleaseBlock`                          | Idle       | —                                                        |
| Blocking   | `HitReceived` (= incoming attack lands AND not in parry window) | Blocking | drain `staminaCost.block` + apply `blockStaminaDrain` to defender; attacker forced to Recovery |
| Blocking   | `ParryTriggered` (= incoming attack lands AND parry window open) | Parry | drain `staminaCost.parry`; attacker → HitStun for `parryStunTicks` |
| Blocking   | `BlockBreak` (stamina ≤ 0)              | HitStun    | —                                                        |
| Parry      | phase end                               | Blocking   | (RMB still held — common case) OR `Idle` (RMB released during Parry) |
| HitStun    | phase end                               | Recovery   | small cooldown so animations land cleanly                |

### State entry/exit invariants

- **Entering `Windup`** zeroes `phaseElapsed`, sets `phaseTotal = weapon.windup[dir]`, charges stamina, records `attackDirection`.
- **Entering `Release`** zeroes `phaseElapsed`, sets `phaseTotal = weapon.release[dir]`, **arms the tracer** (sets `TracerTag`-driven `tracerState.armed = true`).
- **Exiting `Release`** disarms the tracer.
- **Entering `Recovery`** sets `phaseTotal = weapon.recovery[dir]` OR `weapon.comboRecovery[dir]` if `_isComboRecovery` flag is set. **The FSM exposes `_isComboRecovery` as a public getter** so `computePhaseTotal()` no longer has to reverse-engineer it.
- **Entering `Blocking`** sets `blockingEntryTick = currentTick` (used by parry-window check) and records `blockDirection`.
- **Entering `Parry`** sets `phaseTotal = weapon.parryRecovery` (NEW field, default 12 ticks).
- **Entering `HitStun`** sets `phaseTotal = weapon.hitStunTicks` for normal hits, `weapon.parryStunTicks` for parry, or a special `weapon.blockBreakStunTicks` (NEW; default = `hitStunTicks`) for block break.

---

## 4. Direction model

**4 directions**, single unified enum:

```ts
const enum Direction {
  Overhead = 0,
  Left     = 1,   // slash from attacker's right→left across the screen
  Right    = 2,   // slash from attacker's left→right across the screen
  Stab     = 3,
}
```

- `AttackDirection` and `BlockDirection` are merged into `Direction`.
- A `Block(dir)` defends against an incoming attack with the **same** `dir`. Holding `Direction.Left` blocks an incoming `Direction.Left` slash. (Mordhau-equivalent: the defender mirrors the attacker.)
- 4 directions is the MVP cut. Underhand (the v1 fifth direction) goes away — it animates similarly to Overhead and adds noise. Re-add post-MVP if combat depth needs it.

### Mouse-direction sampling

- **At click time**, sample from the rolling buffer (`InputManager.getAverageDelta()` over a 100ms window) — NOT the single-frame `getMouseDelta()`. v1 uses single-frame and that's fragile at low frame rates.
- Algorithm (both attack and block):
  1. Compute average mouse delta `(dx, dy)` over the last 100ms.
  2. If `magnitude < stabThreshold` (12px) → `Stab`.
  3. Else if `|dx| > axisRatio * |dy|` (axisRatio = 1.2) → `Left` (dx<0) or `Right` (dx>0).
  4. Else if `|dy| > axisRatio * |dx|` and `dy<0` → `Overhead`. (`dy>0` would be Underhand; in 4-dir mode it falls back to `Stab`.)
  5. Else (ambiguous) → `Stab`.
- **Morph**: during `Windup`, an LMB just-press re-samples and (if direction differs) routes the FSM through the `Attack(newDir)` morph transition. No additional stamina charge — morph uses the original swing's charge.

---

## 5. WeaponConfig schema diff

`WeaponConfig` already drives most of v2. Three field additions, one rename, one cleanup.

### Add

```ts
interface WeaponConfig {
  // ... existing fields ...

  /** NEW: ticks the parry pose locks before returning to Blocking */
  parryRecovery: number;

  /** NEW: ticks of stagger when block breaks from stamina ≤ 0 */
  blockBreakStunTicks: number;

  turncap: {
    windup: number;
    release: number;
    recovery: number;
    /** NEW: cap during HitStun. Recommend 0.005 rad/tick (very low). */
    hitStun: number;
  };
}
```

### Rename / collapse

- `damage[direction]` keeps the 4-direction shape (drop `Underhand`).
- `staminaCost.feint` is **removed** for MVP (no Feint state). Keep as optional in the type to ease re-adding later.

### Drop

- All `Underhand` keys from `damage`, `windup`, `release`, `recovery`, `comboRecovery` records.

### Defaults / ranges (suggested baseline; tune in playtest)

| Field                | Longsword | Mace | Dagger | Battleaxe |
|----------------------|-----------|------|--------|-----------|
| `parryRecovery`      | 12        | 14   | 8      | 16        |
| `blockBreakStunTicks`| 30        | 36   | 24     | 42        |
| `turncap.hitStun`    | 0.005     | 0.005| 0.005  | 0.005     |

---

## 6. Per-state durations and turncaps

All durations come from `WeaponConfig`. Per-state fixed durations:

```
Idle       → no duration, exits on input
Windup     → weapon.windup[direction]
Release    → weapon.release[direction]      (tracer fires every tick during this state)
Recovery   → weapon.recovery[direction]     OR weapon.comboRecovery[direction] when comboing
Blocking   → no duration, exits on RMB-up or hit
Parry      → weapon.parryRecovery
HitStun    → weapon.hitStunTicks            (normal hit)
           → weapon.parryStunTicks          (got parried)
           → weapon.blockBreakStunTicks     (block broken)
```

Turncap (cap on `CameraController.maxTurnRate` set per tick by `CombatSystem`, behavior already wired by PR #78):

```
Idle, Blocking, Parry → Infinity
Windup                → weapon.turncap.windup
Release               → weapon.turncap.release       (lowest — committed swing)
Recovery              → weapon.turncap.recovery
HitStun               → weapon.turncap.hitStun       (NEW, very low)
```

Note: `Parry` uses `Infinity` (defender can rotate to face the next attacker) rather than recovery's cap. Justification: the parrier is rewarded; they should feel agile while the attacker is staggered.

### Combo recovery

When LMB is just-pressed during `Recovery`, set `_isComboRecovery = true` on the next swing's recovery entry — i.e. the *next* recovery is shorter. This matches v1 behavior. **Expose `_isComboRecovery` via a getter** so `CombatSystem.computePhaseTotal()` can stop reverse-engineering it from `ticksRemaining`.

---

## 7. Damage model

### Where the tracer fires

`TracerSystem` fires for every entity with `TracerTag` whose `state == Release` — once per fixed tick — and computes a swept volume between the previous-tick and current-tick positions of each `weapon.tracerPoints[]` location (transformed through `weaponBoneMap.get(eid)` world matrix). Already implemented (`TracerSystem.ts:110-131`); v2 keeps this.

### Hit resolution (NEW: dispatched through FSM, not written directly)

When `TracerSystem` detects a sensor intersection, it emits a `DamageEvent` ECS entity. `DamageSystem` reads the event and **dispatches an FSM input** instead of writing `CombatState.state` directly. This is the single biggest correctness fix in v2.

```
For each DamageEvent:
  1. Skip if attackerEid == targetEid.                  (self-hit guard)
  2. Skip if hitEntities Set already contains targetEid for this swing.
                                                          (per-swing dedupe; lives in tracerState)
  3. Look up target FSM in fsmRegistry.
  4. Branch on target.state:
       case Blocking:
         elapsed = currentTick - target.blockingEntryTick
         if elapsed <= target.weapon.parryWindow
             AND target.blockingEntryWasJustPress:
           dispatch ParryTriggered to target FSM     → target enters Parry
           dispatch WasParried to attacker FSM       → attacker enters HitStun (parryStunTicks)
         else:
           dispatch BlockedHit to target FSM         → drains block stamina
           dispatch BlockedHit to attacker FSM       → attacker forced to Recovery
       default (Idle, Windup, Release, Recovery, Parry, HitStun):
         hp = weapon.damage[attackDir][bodyZone]
         apply hp via dispatch HitReceived(amount=hp) to target FSM
                                                     → FSM applies damage AND transitions to HitStun
                                                       (HealthSystem reads the FSM event)
```

### Body-part multipliers

Already baked into `WeaponConfig.damage[direction][zone]` where `zone ∈ {head, torso, limb}`. **Do not introduce a separate multiplier table** — the per-direction × per-zone matrix is the source of truth.

`BodyRegion` enum (existing, in `components.ts`) maps Rapier collider handle → `head | torso | limb`:

- `Head` → `head`
- `Torso` → `torso`
- `ArmLeft, ArmRight, LegLeft, LegRight` → `limb`

`HitboxSystem` already provides this; no changes needed.

### Friendly fire

MVP is **FFA arena**. Policy:

- Self-hit: blocked (already implemented via the `attackerEid === ownerEid` check at `TracerSystem.ts:293`).
- Everyone else: damage applies. No team-id check.
- Add a `TeamComponent` post-MVP. Network multiplayer (#92) will need it; we are not building that here.

### Stab vs. directional block (open question, decided here)

v1 treats Stab as blocked by *any* direction (`DamageSystem.ts:38-39`). **v2 reverses this**: a Stab is blocked only by `Direction.Stab` block. Justification: directional combat is more interesting if every direction has a counter. If playtest finds this too punishing, change to "Stab is blocked by `Stab` OR by the block direction matching the attacker's current facing" — but that's over-design for MVP.

---

## 8. Stamina costs

All values come from `weapon.staminaCost`. The FSM emits stamina events from canonical points; `CombatSystem` drains them via `queueStaminaCost()`.

| Event                        | When                                                          | Cost source                  |
|------------------------------|---------------------------------------------------------------|------------------------------|
| Swing start                  | On entering `Windup` (charges whether or not the swing lands) | `staminaCost.attack`         |
| Block-on-hit                 | On `BlockedHit` dispatched to defender                        | `staminaCost.block`          |
| Parry                        | On `ParryTriggered` dispatched to defender                    | `staminaCost.parry`          |
| Passive block drain          | Every tick while in `Blocking`                                | `weapon.blockStaminaDrain`   |
| Miss                         | **Not charged** in MVP — `attack` already covers the swing    | —                            |

Regen: `5/sec` after `60` idle ticks (only when state is `Idle` or `Recovery`). Existing behavior, keep.

Block break: when stamina hits ≤ 0 in `Blocking`, dispatch `BlockBreak` to FSM → `HitStun` for `blockBreakStunTicks`. **No more direct `CombatStateComponent.state` writes from `StaminaSystem`** (current bug at `StaminaSystem.ts:99-100`).

---

## 9. FSM data publishing — what the renderer reads

**Single component**, replacing the dual `CombatStateComponent` + `CombatStateComp`:

```ts
const CombatState = defineComponent({
  state:         Types.ui8,    // Direction enum value (0..6)
  direction:     Types.ui8,    // current attack OR block direction
  phaseElapsed:  Types.ui16,   // ticks since entering current state
  phaseTotal:    Types.ui16,   // total ticks for current state, 0 if state has no fixed duration
  weaponId:      Types.ui8,
  // NEW: surfaces the parry-window predicate to the HUD without re-deriving it
  parryActive:   Types.ui8,    // 0 or 1; true while in Blocking AND elapsed ≤ parryWindow
});
```

`CombatSystem` is the **only** writer; everyone else (HUD, AnimationSystem, ViewmodelAnimationSystem, DirectionIndicator, TracerSystem, DamageSystem, StaminaSystem) reads.

Animation systems use `phase = phaseElapsed / phaseTotal` clamped to `[0,1]` for animatable states; for `Idle`/`Blocking` (no fixed duration), they fall back to idle-pose blending.

### Migration

- Delete `CombatStateComp` (the animation mirror).
- Rename existing `CombatStateComponent` to `CombatState` and add the two new fields.
- All readers updated in one PR (single search-and-replace; this is feasible because of strict types).

---

## 10. Acceptance test list

These are the test cases that must pass for FSM v2 to be considered complete. Implementer should write them as `vitest` suites alongside the FSM module.

### State transitions

1. **Idle → Windup on Attack(dir) when stamina sufficient.** Assert state, direction, phaseTotal, stamina drained.
2. **Idle → Windup is rejected when stamina < `staminaCost.attack`.** Assert state still Idle, no charge.
3. **Windup auto-transitions to Release after `windup[dir]` ticks.** Assert tracer arms exactly on the boundary tick.
4. **Release auto-transitions to Recovery after `release[dir]` ticks.** Assert tracer disarms.
5. **Recovery auto-transitions to Idle after `recovery[dir]` ticks** when no Attack queued.
6. **Recovery uses `comboRecovery[dir]`** when LMB was pressed during recovery.

### Tracer + damage

7. **Windup → Release boundary fires the tracer** — `TracerSystem` emits exactly one `DamageEvent` if a sensor intersects on the very first Release tick.
8. **Tracer dedupe** — same target hit by two consecutive Release ticks results in exactly one HP-deduction.
9. **Per-zone damage** — hitting the head sensor applies `damage[dir].head`, torso applies `damage[dir].torso`, limbs apply `damage[dir].limb`.
10. **Self-hit blocked** — attacker's own hitboxes never intersect their tracer (already true; regression test).

### Block / parry

11. **RMB just-press during opponent Windup transitions defender to Blocking.** Assert `blockingEntryTick == currentTick`.
12. **Tracer hits defender in Blocking with elapsed ≤ parryWindow → Parry.** Defender enters Parry, attacker enters HitStun for `parryStunTicks`. Defender's stamina drained by `staminaCost.parry`.
13. **Tracer hits defender in Blocking with elapsed > parryWindow → BlockedHit.** Defender stays in Blocking, attacker forced to Recovery. Defender's stamina drained by `staminaCost.block` plus `blockStaminaDrain`.
14. **Mismatched block direction** — direction of attack differs from direction of block: defender takes full damage AND enters HitStun. (Documents the "directional block" requirement.)
15. **Stab blocked only by Stab direction** — overhead block does NOT defend against Stab.
16. **Block break** — defender's stamina drained to 0 while blocking → defender enters HitStun for `blockBreakStunTicks`.
17. **Parry recovery** — Parry state lasts exactly `parryRecovery` ticks, then returns to Blocking if RMB still held, Idle if released.

### Stamina

18. **Windup entry charges `staminaCost.attack`** even if the swing whiffs (no hit landed).
19. **`feint` cost is not charged in MVP** — the field is gone.
20. **Idle regen** — 60 ticks after last action, stamina regenerates at 5/sec when in Idle or Recovery.

### Direction sampling

21. **`detectDirection` uses rolling 100ms buffer**, not single-frame. (Mock InputManager and assert the buffer method is called.)
22. **Below `stabThreshold` magnitude → Stab.**
23. **`|dy| > axisRatio * |dx|` and `dy < 0` → Overhead.** `dy > 0` falls back to Stab in 4-dir mode.

### Component sync

24. **`CombatState.phaseElapsed` increments by 1 each tick during Windup/Release/Recovery/Parry/HitStun.** Stays 0 in Idle/Blocking.
25. **`CombatState.parryActive` is 1** while in Blocking with elapsed ≤ parryWindow, 0 otherwise.
26. **No external system writes `CombatState.state` directly** — assert via grep test that only `CombatSystem` mutates `CombatState.state`. (Implementer can use a custom ESLint rule or a test-time wrapper.)

### Turncap

27. **`CameraController.maxTurnRate` matches `weapon.turncap.<state>`** every tick for the player entity. (Existing test from PR #78; extend with the new HitStun cap.)

---

## 11. Migration checklist (cross-references implementation issues)

Implementation lands in five PRs, sequenced as below. **All depend on #85 closing (Foundation MVP).**

| # | Title                                         | Depends on |
|---|-----------------------------------------------|------------|
| A | WeaponConfig schema migration (4 weapons + type) | #85       |
| B | Combat FSM v2 core rewrite                       | A         |
| C | Unified `CombatState` component + remove direct writes | B   |
| D | Direction model unification (4-dir, rolling buffer sampling) | B |
| E | Damage pipeline integration with FSM v2 (DamageSystem dispatches FSM events) | B, C |

Each is its own GitHub issue; see issue body links from #88.

---

## 12. Open questions / explicit non-goals

- **Feint** — deferred. Re-add post-MVP behind a weapon flag.
- **Riposte** — deferred. Same.
- **Half-swords / mode shifts** — out of scope.
- **Networking-driven authoritative state** — out of scope here; #92 owns that. v2 must keep all writes funneled through `CombatSystem` so a server-authoritative refactor is local.
- **Multi-target swings (one tracer, two enemies)** — already supported via `tracerState.hitEntities` Set. No change needed.
- **Animation tuning to match new state set** — owned by #89 (third-person animation rebuild) and #90 (FP viewmodel rebuild).
