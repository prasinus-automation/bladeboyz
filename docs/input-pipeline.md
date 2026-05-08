# Input Pipeline Architecture

> **Status:** spec, no code change. Defines the target architecture for the input
> pipeline rebuild that replaces the current `src/input/InputManager.ts` and the
> scattered raw `addEventListener` listeners in `CameraController`,
> `InventoryPanel`, `DebugRenderer`, `TracerDebugRenderer`, `HUD`, and `main.ts`.
> This is the source-of-truth doc for downstream rewrite tickets — the
> implementation is **not** in this PR.
>
> Companion files in this PR:
> - `src/input/InputManager.types.ts` — interface signatures only.
> - `src/input/keybinds.ts` — default keymap data.
>
> See `docs/MVP.md` for the broader rebuild roadmap and `AGENTS.md` for current
> tech-stack conventions.

---

## 1. Overview

The input pipeline has one job: **be the single, authoritative source of every
keyboard, mouse, and pointer-lock signal the game consumes.** Everything else
in the codebase reads from it; nothing else attaches raw browser listeners.

Three principles drive the design:

1. **Single source of truth.** All `addEventListener('keydown' | 'keyup' |
   'mousedown' | 'mouseup' | 'mousemove' | 'wheel' | 'pointerlockchange')`
   calls live inside `InputManager`. Consumers (`MovementSystem`,
   `CombatSystem`, `CameraController`, `InventoryPanel`, debug renderers)
   read state via the typed interface (`isActionDown`, `isActionJustPressed`,
   `getMouseDelta`, …) and never import the DOM event types directly.
2. **Pointer-lock-gated input.** Raw mouse motion and gameplay keys are only
   meaningful inside the `Playing` mode. The InputManager enforces this — when
   the mode is not `Playing`, polling reads return `false` / `0`.
3. **No scattered listeners.** Today there are 11 raw `keydown` listeners
   spread across 7 files. Every one of those becomes either a polled
   `isActionDown` read inside an existing tick, or an `onAction(action, cb)`
   subscription served by `InputManager`. The DOM is touched in exactly one
   place.

---

## 2. Input-mode FSM

Three modes, no others. They are mutually exclusive and exhaustive.

| Mode          | Meaning                                                                       | Pointer lock?       |
| ------------- | ----------------------------------------------------------------------------- | ------------------- |
| `Menu`        | Game is loaded but not active. Click-to-play overlay visible.                 | Released            |
| `Playing`     | Pointer is locked, gameplay is running, mouse/keys drive the player.          | Locked              |
| `OverlayOpen` | An HTML overlay (currently inventory; later shop, settings) is in front.      | Released, on purpose |

### 2.1 State diagram

```
                ┌─────────────┐
                │             │
                │    Menu     │◄───────────────────┐
                │             │                    │
                └──────┬──────┘                    │
                       │ click on canvas           │ pointer-lock-lost
                       │ (user gesture)            │ (e.g. user pressed ESC,
                       ▼                           │  alt-tab, browser stole
                ┌─────────────┐                    │  focus mid-game)
                │             │ ───────────────────┤
                │   Playing   │                    │
                │             │◄────┐              │
                └──────┬──────┘     │              │
                       │ KeyI       │ overlay      │
                       │ (toggle)   │ closed       │
                       ▼            │              │
                ┌─────────────┐     │              │
                │             │─────┘              │
                │ OverlayOpen │                    │
                │             │ ESC ──────────────►│
                └─────────────┘  (also closes      │
                                  overlay first)   │
```

### 2.2 Transition table

| From          | To            | Trigger                                                                                  | Side effects                                                                                                                         |
| ------------- | ------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Menu`        | `Playing`     | Canvas click (user gesture) **AND** browser grants pointer lock                          | `requestPointerLock()`; `#click-to-play` hidden by `main.ts` reacting to mode-change event; canvas focused                            |
| `Playing`     | `OverlayOpen` | `KeyI` pressed (inventory toggle), or future overlay-open API call                       | `releasePointerLock()` (calls `document.exitPointerLock()`); accumulated key/mouse-button state cleared so nothing stays "stuck"      |
| `OverlayOpen` | `Playing`     | Overlay's `close()` called (e.g. user clicked close button or pressed `KeyI` again)      | Mode becomes `Menu` first if pointer-lock isn't reacquired immediately. Pointer lock requires a fresh user-gesture click on canvas. |
| `OverlayOpen` | `Menu`        | `Escape` pressed                                                                          | Overlay's `close()` is called; pointer-lock already released                                                                        |
| `Playing`     | `Menu`        | Pointer-lock lost (user pressed ESC; or browser-internal lock loss; or focus stolen)     | `#click-to-play` shown by `main.ts`; key/mouse-button state cleared                                                                  |
| `OverlayOpen` | `Menu`        | Pointer-lock-lost event (defensive — overlay should already be the path that released it) | Same as `Playing → Menu`                                                                                                            |

> **Invariant:** mode is never `Playing` while `document.pointerLockElement !== canvas`.
> If the browser unilaterally releases lock, `InputManager` immediately
> demotes mode to `Menu` (or `OverlayOpen` stays in `OverlayOpen` if an
> overlay is what caused the release — see §3 for the contract).

### 2.3 Routing table

Every input source is listed. Cells are **(W)**here-it-goes:
`G`ameplay = forwarded to combat/movement systems via polled or edge-detected
reads; `U`I = consumed by overlay/UI handlers; `–` = ignored.

| Source                       | `Menu` | `Playing` | `OverlayOpen` |
| ---------------------------- | ------ | --------- | ------------- |
| WASD (`KeyW/A/S/D`)          | –      | G (poll, `isActionDown`)                                                       | – (returns false)                       |
| Sprint / Crouch (`Shift`/`Ctrl`) | –   | G (poll)  | –                                       |
| Jump (`Space`)               | –      | G (poll)  | –                                       |
| Mouse movement (delta)       | –      | G (`getMouseDelta` / `getAverageDelta`) | –                         |
| Mouse left button (Mouse0)   | –      | G (edge `isActionJustPressed(AttackPrimary)` triggers attack) | – |
| Mouse right button (Mouse2)  | –      | G (edge press = block/feint, edge release = release-block)   | – |
| Scroll wheel                 | –      | G (`getScrollDelta`, used for third-person zoom in `CameraController`) | – |
| `Escape`                     | – (browser default — leaves canvas focus) | – (browser releases pointer-lock automatically; routed through `Playing → Menu` transition) | U (closes overlay) |
| `KeyI`                       | –      | U (toggles inventory: `Playing → OverlayOpen`) | U (closes overlay: `OverlayOpen → Playing`) |
| `F5` (camera mode toggle)    | –      | G (camera controller; debug)            | –                                       |
| `KeyT` (debug toggle dummy block)        | – | G (debug, dummy state)            | –                                       |
| `KeyY` (debug cycle dummy block dir)     | – | G (debug)                          | –                                       |
| `KeyJ` (debug spawn dummy)               | – | G (debug)                          | –                                       |
| `KeyK` (debug reset dummies)             | – | G (debug)                          | –                                       |
| `F1`–`F4`, `F6` (debug renderers)         | – | G (debug)                          | –                                       |

> **No "global hotkeys."** Every binding is mode-scoped. `KeyI` is the only key
> that is meaningful in both `Playing` and `OverlayOpen` — and even then it's
> the same logical action (`OpenInventory` / `CloseOverlay`) bound to the same
> physical key. Conceptually that's two actions, one shared key.

---

## 3. Pointer-lock contract

Pointer lock is the load-bearing element of the whole pipeline. Browsers only
let us request it from a user-gesture handler, and they may unilaterally
release it at any time.

### 3.1 Acquire

- **Only** from the canvas-click handler in `Menu` mode.
- Implementation: `main.ts` (or a small shim) calls
  `inputManager.requestPointerLock()` from inside the click handler.
  `InputManager` calls `canvas.requestPointerLock()`. The DOM gesture
  requirement is preserved because `main.ts`'s click listener is the
  user gesture.
- `InputManager` does **not** auto-request lock from any other code path.
  Specifically, it does not request lock when the inventory is closed —
  that requires a fresh canvas click.

### 3.2 Release (intentional)

There are exactly two intentional release paths:

1. **Overlay open** — `setMode(OverlayOpen)` calls
   `document.exitPointerLock()` internally. Mode becomes `OverlayOpen`.
2. **`dispose()`** — released as a teardown safety net.

`InventoryPanel` (and future overlays) **must not** call
`document.exitPointerLock()` directly. They call `inputManager.setMode(OverlayOpen)`.

### 3.3 Lost (unintentional)

The browser fires `pointerlockchange` whenever lock state changes. When
`InputManager` sees lock has been **lost** (i.e. it was locked, now isn't, and
mode is currently `Playing`), the contract is:

```
mode = Menu
emit onModeChange(Menu)
emit onPointerLockChange(false)
clear keysDown, mouseButtons, frameDelta, deltaBuffer
```

`main.ts`'s mode-change subscriber re-shows `#click-to-play`. The user gets
their cursor back and can choose to click and resume.

> **Why `Menu`, not "re-open last overlay"?** Pointer-lock loss is usually a
> deliberate user action (ESC) or system intervention (alt-tab). Putting them
> back into the inventory they had open before would be surprising. Show them
> the click-to-play overlay; if they want inventory again they can press `I`
> after re-acquiring lock.

> **Edge case:** if mode is currently `OverlayOpen` and lock is lost, mode
> stays `OverlayOpen` (lock was already released — nothing to do). The
> `pointerlockchange` event is suppressed for the FSM but
> `onPointerLockChange(false)` still fires for any subscribers that need it
> (currently none).

### 3.4 Acquire failure

If `pointerlockerror` fires, `InputManager` logs a warning and stays in
`Menu`. The click-to-play overlay remains visible. The user can try again.

---

## 4. Click-to-play overlay decision

**Recommendation: keep the existing `#click-to-play` element in `index.html`,
but make `InputManager` DOM-agnostic.**

### Rationale

The current implementation has `InputManager` reach into the DOM by
`document.getElementById('click-to-play')` and toggle a `hidden` class on it
inside the pointer-lock change handler. It also has an ad-hoc
`_suppressClickToPlay: (() => boolean) | null` callback so `InventoryPanel` can
override the behavior. This is the wrong layer.

In the rewrite:

- The `#click-to-play` element stays in `index.html` exactly as it is
  (HTML/CSS, zero JS). The CSS already handles the hidden state via
  `.hidden`.
- `InputManager` knows nothing about this element. It only emits
  `onModeChange` events.
- `main.ts` (the wiring layer) subscribes to `onModeChange` and shows/hides
  the overlay based on the mode:

  ```ts
  // pseudocode, not part of this spec's code
  inputManager.onModeChange((mode) => {
    overlay.classList.toggle('hidden', mode !== InputMode.Menu);
  });
  ```
- The `_suppressClickToPlay` callback dies. The overlay is hidden whenever
  mode ≠ `Menu`, which already handles the inventory case (mode is
  `OverlayOpen`, not `Menu`, so overlay stays hidden). No special-casing.

### Considered alternatives

| Option                                  | Pro                                                                                          | Con                                                                                                                                       | Decision                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Three.js intro screen                   | Visually consistent with game; can show animated content                                      | Requires loading the full renderer before a click is even meaningful; harder to make accessible; doesn't solve the user-gesture requirement | **Rejected.** Too much work for an MVP intro.  |
| Remove overlay, auto-request lock on first key press | Smaller HTML; one fewer element to maintain                                              | Browsers will reject the request (no user gesture); UX is worse — user presses W and nothing happens                                       | **Rejected.** Violates pointer-lock requirement. |
| Keep overlay, keep DOM coupling in InputManager | Smallest diff                                                                              | Layering violation persists; testability suffers (tests need to stub `getElementById`)                                                    | **Rejected.** Whole point of rewrite is to fix this. |
| Keep overlay, move DOM coupling to `main.ts` (recommended) | Clean separation; InputManager testable in isolation; HTML/CSS unchanged                | One more subscription in `main.ts`                                                                                                        | **Selected.**                                  |

---

## 5. Tick-order semantics

This is the trickiest part of the current code and the rewrite must preserve
its observable behavior.

### 5.1 Current behavior (do not change)

The game loop hooks (`src/core/GameLoop.ts`) fire in this order **per render
frame**:

```
onFrameStart  → cameraController.processInput()       (consumes mouse delta)
fixedUpdate × N (N ≥ 0, where N depends on accumulator)
              → combatSystem()                         (reads mouse buttons + delta)
              → movementSystem(dt)                     (polls WASD, reads camera yaw)
              → physics step, hitbox sync, tracer/damage, mesh sync
update(dt)    → animationSystem, viewmodel anim, debug overlay, HUD
render(alpha) → debugRenderer, tracerDebug, floating damage, camera updateCamera
onFrameEnd    → input.resetFrameDeltas()              (zeroes frame deltas)
```

The critical ordering is:

1. **Camera consumes mouse delta first.** `processInput()` reads
   `getMouseDelta()` and updates yaw/pitch. This must happen before
   `movementSystem` reads `cameraController.getYaw()`, otherwise WASD
   movement uses the previous frame's yaw and the player's strafe lags
   one frame behind their look direction.
2. **Frame deltas are reset at frame end, not tick end.** If the game runs at
   144 Hz with 60 Hz fixed updates, two fixed ticks per frame would otherwise
   double-count the same accumulated mouse delta.

### 5.2 Recommendation: keep per-frame mouse delta sampling

**Mouse delta is sampled at frame boundary (current behavior). Do not switch
to per-fixed-tick sampling.**

#### Why

- Camera yaw needs to be authoritative *before* the first fixed tick of the
  frame. With per-tick sampling, the camera would update inside the tick loop
  and `movementSystem` reading it would race the camera update.
- The current design lets the camera see the entire frame's mouse motion at
  once. This is desirable: at 144 Hz the user expects look responsiveness,
  not 60 Hz quantization.
- The combat directional detection (`detectAttackDirection` /
  `detectBlockDirection`) reads `getAverageDelta(windowMs)`, which uses a
  time-windowed rolling buffer. This is independent of the per-frame delta
  and is already correct.

#### What changes in the rewrite

The mechanism is the same; the surface is renamed for clarity. The new
`IInputManager` exposes:

- `getMouseDelta()` → accumulated since last `resetFrameDeltas()`. Called by
  `CameraController.processInput()` at frame start. **Per-frame.**
- `getAverageDelta(windowMs)` → time-windowed. Called by `CombatSystem` for
  attack-direction detection. **Per-call, time-windowed.**
- `resetFrameDeltas()` → called from `onFrameEnd` exactly once per render
  frame. Continues to also prune the rolling delta buffer of stale entries.

There is no per-tick reset.

### 5.3 Edge-detection state

Currently `CombatSystem.ts:54-55` keeps `prevLeftMouseDown` /
`prevRightMouseDown` at module scope to detect press/release edges. This
breaks isolation (resetting between tests requires an exported
`resetCombatInputState()`) and conflates input concerns with combat concerns.

In the rewrite, the edge-detection table lives inside `InputManager`. Each
fixed tick (or each call site, depending on which is the ground-truth tick),
`InputManager` snapshots the current pressed-set into a "previous" set.
Consumers ask:

- `isActionJustPressed(AttackPrimary)` → true on the tick where the action
  transitioned from up → down.
- `isActionJustReleased(BlockOrFeint)` → true on the tick where the action
  transitioned from down → up.

The "tick" boundary for edges is the **fixed tick**. `InputManager` exposes a
`commitFrame()` (or similar) that is called from the system tick loop —
typically right after the last gameplay system reads input, and before the
next tick boundary. Implementation detail; the public surface is just
`isActionJustPressed` / `isActionJustReleased`. See §6.

> **Migration note:** the existing `prevLeftMouseDown` / `prevRightMouseDown`
> module-level state in `CombatSystem.ts` is removed. `resetCombatInputState`
> goes away. Tests that need to clear edge state call `inputManager.dispose()`
> or construct a fresh manager.

---

## 6. Event-driven vs polled API

Inputs split cleanly into two flavors. The new API exposes both.

### 6.1 Polled (continuous) — `isActionDown(action)`

For inputs that are held over many ticks. Returns `true` for the entire
duration of the press.

| Action             | Source     | Used by                               |
| ------------------ | ---------- | ------------------------------------- |
| `MoveForward`      | `KeyW`     | `MovementSystem`                      |
| `MoveBackward`     | `KeyS`     | `MovementSystem`                      |
| `StrafeLeft`       | `KeyA`     | `MovementSystem`                      |
| `StrafeRight`      | `KeyD`     | `MovementSystem`                      |
| `Sprint`           | `Shift*`   | `MovementSystem`                      |
| `Crouch`           | `Control*` | `MovementSystem`                      |
| `Jump`             | `Space`    | `MovementSystem` (currently — could be edge) |
| `BlockOrFeint`     | `Mouse2`   | `CombatSystem` (held → block sustains) |

Returns `false` whenever mode ≠ `Playing`.

### 6.2 Edge-detected (one-shot) — `isActionJustPressed` / `isActionJustReleased`

For inputs that fire a one-shot action. Valid for the current tick only.

| Action              | Edge          | Source     | Used by                                                                      |
| ------------------- | ------------- | ---------- | ---------------------------------------------------------------------------- |
| `AttackPrimary`     | JustPressed   | `Mouse0`   | `CombatSystem` → triggers directional attack with sampled mouse delta        |
| `BlockOrFeint`      | JustPressed   | `Mouse2`   | `CombatSystem` → triggers block (or feint if currently in Windup)            |
| `BlockOrFeint`      | JustReleased  | `Mouse2`   | `CombatSystem` → triggers `ReleaseBlock`                                     |
| `OpenInventory`     | JustPressed   | `KeyI`     | UI layer toggles `InventoryPanel`                                            |
| `CloseOverlay`      | JustPressed   | `Escape`   | UI layer closes current overlay                                              |
| `ToggleCameraMode`  | JustPressed   | `F5`       | `CameraController` toggles FPS / TPS                                         |
| `DebugSpawnDummy`   | JustPressed   | `KeyJ`     | `main.ts` debug                                                              |
| `DebugResetDummies` | JustPressed   | `KeyK`     | `main.ts` debug                                                              |
| `DebugToggleDummyBlock` | JustPressed | `KeyT`   | `main.ts` debug                                                              |
| `DebugCycleBlockDir`    | JustPressed | `KeyY`   | `main.ts` debug                                                              |

> Returns `false` whenever mode ≠ `Playing` (with the exception of
> `CloseOverlay`, which is meaningful only in `OverlayOpen` and is the one
> mode-specific edge action — see the keybind table in §7 for its mode column).

### 6.3 Event subscription — `onAction(action, cb)` (deferred)

The interface exposes `onModeChange` and `onPointerLockChange` event
subscriptions. A general `onAction(action, cb)` event API is **not** in scope
for this spec — it's deferred until a consumer actually needs purely
event-driven dispatch (no consumer does today; everything fits poll +
edge). If that need arises, the action enum and edge-detection plumbing
already in place make it a small follow-up.

---

## 7. Keybind table

This is the **complete** default keymap. Every binding currently in code is
listed. The matching machine-readable version lives in
`src/input/keybinds.ts`.

| Action                  | Default Key (`KeyboardEvent.code` / mouse button) | Mode(s)                | Notes                                                                                          |
| ----------------------- | ------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `MoveForward`           | `KeyW`                                           | `Playing`              |                                                                                                |
| `MoveBackward`          | `KeyS`                                           | `Playing`              |                                                                                                |
| `StrafeLeft`            | `KeyA`                                           | `Playing`              |                                                                                                |
| `StrafeRight`           | `KeyD`                                           | `Playing`              |                                                                                                |
| `Sprint`                | `ShiftLeft`, `ShiftRight`                        | `Playing`              | Either shift counts.                                                                           |
| `Crouch`                | `ControlLeft`, `ControlRight`                    | `Playing`              | Either control counts.                                                                         |
| `Jump`                  | `Space`                                          | `Playing`              |                                                                                                |
| `AttackPrimary`         | `Mouse0` (left mouse button)                     | `Playing`              | Edge-detected. Direction sampled from `getAverageDelta()` at the tick of `JustPressed`.        |
| `BlockOrFeint`          | `Mouse2` (right mouse button)                    | `Playing`              | Polled (held = blocking). `JustPressed` during own Windup = feint, otherwise begins block.     |
| `OpenInventory`         | `KeyI`                                           | `Playing`              | Toggle. In `Playing` opens inventory and transitions to `OverlayOpen`.                         |
| `CloseOverlay`          | `Escape`                                         | `OverlayOpen`          | Closes the active overlay. In `Playing`, browser default releases pointer lock (handled in §3). |
| `OpenInventory` (toggle) | `KeyI`                                          | `OverlayOpen`          | Same key, opposite intent: closes inventory. UI handler interprets based on current mode.       |
| `ToggleCameraMode`      | `F5`                                             | `Playing`              | Debug — switches FPS / TPS.                                                                    |
| `DebugSpawnDummy`       | `KeyJ`                                           | `Playing`              | Debug — spawns next training dummy.                                                            |
| `DebugResetDummies`     | `KeyK`                                           | `Playing`              | Debug — full HP reset for all dummies.                                                         |
| `DebugToggleDummyBlock` | `KeyT`                                           | `Playing`              | Debug — toggles dummy idle ↔ blocking.                                                         |
| `DebugCycleBlockDir`    | `KeyY`                                           | `Playing`              | Debug — cycles dummy block direction.                                                          |
| `DebugToggleWireframe`  | `F1`                                             | `Playing`              | Debug — `DebugRenderer`.                                                                       |
| `DebugTogglePhysics`    | `F2`                                             | `Playing`              | Debug — Rapier debug lines.                                                                    |
| `DebugToggleHitboxes`   | `F3`                                             | `Playing`              | Debug — hitbox wireframes.                                                                     |
| `DebugToggleFsmOverlay` | `F4`                                             | `Playing`              | Debug — per-entity FSM state overlay (lives in `HUD.ts` today).                                |
| `DebugToggleTracers`    | `F6`                                             | `Playing`              | Debug — `TracerDebugRenderer`.                                                                 |
| (none)                  | Scroll wheel                                     | `Playing`              | Not an action — read directly via `getScrollDelta()`. Used by `CameraController` for TPS zoom. |
| (none)                  | Mouse motion                                     | `Playing`              | Not an action — read directly via `getMouseDelta()` / `getAverageDelta()`.                     |

> Mouse motion and scroll-wheel are intentionally *not* action-mapped —
> remapping them makes no sense for a player-controlled action game. They
> stay as direct API methods on `IInputManager`.

---

## 8. Migration plan

This spec unblocks the following downstream tickets. Each is a separate PR;
none of them are in scope here.

1. **Implement new `InputManager`** — rewrite `src/input/InputManager.ts` to
   conform to `IInputManager`. Owns the mode FSM. Replaces all raw listeners
   it currently holds. Adds the action enum routing.
2. **Refactor `MovementSystem`** — replace `input.isKeyDown('KeyW')` calls
   with `input.isActionDown(InputAction.MoveForward)`.
3. **Refactor `CombatSystem`** — delete `prevLeftMouseDown` /
   `prevRightMouseDown` and `resetCombatInputState`. Use
   `isActionJustPressed(AttackPrimary)` / `isActionJustPressed(BlockOrFeint)` /
   `isActionJustReleased(BlockOrFeint)`. Direction detection still uses
   `getAverageDelta(windowMs)`.
4. **Refactor `CameraController`** — delete the `window.addEventListener('keydown')`
   for F5; replace with `inputManager.isActionJustPressed(InputAction.ToggleCameraMode)`
   read inside `processInput()`.
5. **Refactor `InventoryPanel`** — delete the `document.addEventListener('keydown')`;
   delete the direct `document.exitPointerLock()` and `input.paused = true`
   calls. Use `inputManager.setMode(OverlayOpen)` on open and
   `inputManager.setMode(Playing)` on close. Listen for `CloseOverlay` and
   `OpenInventory` actions. Delete the `input._suppressClickToPlay` hook.
6. **Refactor debug renderers** — `DebugRenderer`, `TracerDebugRenderer`, and
   `HUD` (F4 listener) all switch from raw `keydown` listeners to action
   reads.
7. **Refactor `main.ts`** — replace the `window.addEventListener('keydown')`
   block (KeyT/Y/J/K) with action reads inside a small per-tick debug system.
   Wire the new `onModeChange` subscription to show/hide `#click-to-play`.
   Remove the `_suppressClickToPlay` assignment.
8. **Add `InputManager.dispose()`** — currently the implementation is a stub;
   it must actually remove every listener it added so HMR doesn't leak.
9. **(Later) Remapping UI** — read/write a mutable `KeybindMap` derived from
   `DEFAULT_KEYBINDS`. Settings overlay. Persist to `localStorage`. Validate
   for collisions. Out of scope for this rebuild, but the action enum and
   keybind data are designed for it.

---

## 9. Open questions

- **Window blur / focus loss.** Should we treat `window.blur` as equivalent
  to pointer-lock loss? Current code does not. If the user alt-tabs without
  pressing ESC, mid-flight keydown is followed by no keyup — this used to
  cause stuck keys (issue #72) and was patched by clearing `keysDown` on
  pause. Recommend the rewrite hooks `window.blur` and clears all pressed
  state. Mode stays `Playing` because the browser will fire
  `pointerlockchange` separately; if it doesn't (some browsers don't on
  alt-tab), we keep mode `Playing` but the cleared key state means nothing
  is held, which is the safe behavior.
- **Gamepad support.** Out of scope for the MVP rebuild. Note: the action
  enum and `isActionDown` API are deliberately source-agnostic — a future
  gamepad polling layer can write into the same `keysDown` -equivalent
  state map without changing consumer code.
- **Multi-key chords.** No current consumer needs them. Deferred. If we add
  them, the natural fit is a separate `bindChord(action, [Key1, Key2])` API
  rather than overloading the existing single-key map.
- **Action remap collisions.** When a user remaps a key in the future
  settings UI, what happens if they bind the same key to two actions?
  Recommend: validate at apply-time, refuse to apply a colliding map, surface
  the conflict to the UI. Don't silently first-wins.
- **Fixed-tick edge boundaries vs frame-tick edge boundaries.** §5.3 picks
  the fixed tick as the edge boundary. If a render frame contains zero or
  multiple fixed ticks (sub-60 Hz or above-60 Hz frame rates), some
  consumers might see an edge fire on a different cadence than they
  expect. The recommendation is to commit edge state once per fixed tick
  and document this in the implementation. Open question: are there UI-only
  consumers of `isActionJustPressed` (e.g. inventory toggle) that should run
  at frame cadence instead? Probably not, but worth verifying when ticket
  #5 lands.
- **Pointer-lock-lost while overlay open.** §3.3 says mode stays
  `OverlayOpen`. Is this right, or should an unlocked overlay be a special
  "unlocked menu" mode? Current preference: keep two modes, since the
  observable behavior (pointer free, keys not driving gameplay) is
  identical.
