/**
 * keybinds — typed table of keyboard / mouse bindings.
 *
 * Two complementary surfaces coexist in this file:
 *
 *   1. **`keybinds` array + `Keybind` / `KeybindGroup` types + `getKeybind`
 *      / `keybindsByGroup` helpers** — UI-facing data shape used by the
 *      Controls overlay (issue #3) to render the rebinding page. Stub for
 *      issue #87 (rebindable controls); today this is a hardcoded list.
 *
 *   2. **`DEFAULT_KEYBINDS` (`Record<InputAction, string | string[]>`)** —
 *      the runtime input-pipeline source of truth referenced in
 *      `docs/input-pipeline.md` §7 (issue #102). The InputManager rebuild
 *      will derive its mutable keybind state from this constant; a future
 *      remapping UI will write user overrides to a separate persisted
 *      store, falling back to these defaults for any unbound action.
 *
 * The two surfaces serve different consumers and will be unified by #87
 * (rebindable controls) once load/save is in place. Until then keep both
 * tables in sync when adding new bindings.
 *
 * Conventions (shared between both surfaces):
 *   - `key` / value uses `KeyboardEvent.code` style (`'KeyW'`, `'Escape'`,
 *     `'F4'`) for keyboard, or `'Mouse0'` / `'Mouse1'` / `'Mouse2'` for
 *     mouse buttons.
 *   - `action` is a stable identifier — when issue #87 introduces user
 *     overrides, lookups will be by `action`, not by `key`.
 *
 * **Stability contract for `DEFAULT_KEYBINDS`:** the *keys* of the record
 * are `InputAction` enum values. Adding a new action requires both adding
 * the enum entry in `InputManager.types.ts` AND adding a default binding
 * here — `Record<InputAction, ...>` enforces this at compile time.
 */

import { InputAction } from './InputManager.types';

// ───────────────────────────────────────────────────────────────────────────
// Surface 1 — UI-facing keybinds table (Controls overlay, issue #3)
// ───────────────────────────────────────────────────────────────────────────

export type KeybindGroup = 'Movement' | 'Combat' | 'Interface';

export interface Keybind {
  /** Stable identifier for this binding (used by code that looks it up). */
  action: string;
  /** `KeyboardEvent.code` value, or `'Mouse0' | 'Mouse1' | 'Mouse2'`. */
  key: string;
  /** Section label in the Controls overlay. */
  group: KeybindGroup;
  /** Human-readable description. */
  label: string;
}

export const keybinds: ReadonlyArray<Keybind> = [
  // ─── Movement ───
  { action: 'moveForward',    key: 'KeyW',       group: 'Movement',  label: 'Move forward'  },
  { action: 'moveBackward',   key: 'KeyS',       group: 'Movement',  label: 'Move backward' },
  { action: 'moveLeft',       key: 'KeyA',       group: 'Movement',  label: 'Strafe left'   },
  { action: 'moveRight',      key: 'KeyD',       group: 'Movement',  label: 'Strafe right'  },
  { action: 'jump',           key: 'Space',      group: 'Movement',  label: 'Jump'          },
  { action: 'sprint',         key: 'ShiftLeft',  group: 'Movement',  label: 'Sprint'        },

  // ─── Combat ───
  { action: 'attack',         key: 'Mouse0',     group: 'Combat',    label: 'Attack'        },
  { action: 'block',          key: 'Mouse1',     group: 'Combat',    label: 'Block / Parry' },
  { action: 'feint',          key: 'KeyQ',       group: 'Combat',    label: 'Feint'         },

  // ─── Interface ───
  { action: 'toggleInventory',  key: 'KeyI',  group: 'Interface',  label: 'Toggle inventory' },
  { action: 'pauseMenu',        key: 'Escape',group: 'Interface',  label: 'Pause / back'     },
  { action: 'toggleFsmDebug',   key: 'F4',    group: 'Interface',  label: 'Toggle FSM debug' },
  { action: 'cycleCameraMode',  key: 'F5',    group: 'Interface',  label: 'Cycle camera mode'},
  { action: 'debugDummyBlock',  key: 'KeyT',  group: 'Interface',  label: 'Toggle dummy block'   },
  { action: 'debugDummyDir',    key: 'KeyY',  group: 'Interface',  label: 'Cycle dummy block dir'},
  { action: 'debugSpawnDummy',  key: 'KeyJ',  group: 'Interface',  label: 'Spawn training dummy' },
  { action: 'debugResetDummies',key: 'KeyK',  group: 'Interface',  label: 'Reset all dummies'    },
];

/** Lookup helper — returns `undefined` if no binding for the action. */
export function getKeybind(action: string): Keybind | undefined {
  return keybinds.find((kb) => kb.action === action);
}

/** Group keybinds for rendering. Preserves insertion order within each group. */
export function keybindsByGroup(): Record<KeybindGroup, Keybind[]> {
  const out: Record<KeybindGroup, Keybind[]> = {
    Movement: [],
    Combat: [],
    Interface: [],
  };
  for (const kb of keybinds) {
    out[kb.group].push(kb);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Surface 2 — Runtime input-pipeline keybind map (InputManager, issue #102)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Generic shape for a keybind table — a future user-configurable map can
 * conform to this same type, indexed by the string action name (e.g. for
 * JSON serialization to localStorage).
 */
export interface KeybindMap {
  [action: string]: string | string[];
}

/**
 * Default action → physical-binding map.
 *
 * Mouse-motion delta and scroll-wheel are intentionally NOT actions — they
 * are read directly from `IInputManager.getMouseDelta()` /
 * `getAverageDelta()` / `getScrollDelta()` and have no remappable form.
 */
export const DEFAULT_KEYBINDS: Readonly<Record<InputAction, string | string[]>> = Object.freeze({
  // Movement
  [InputAction.MoveForward]: 'KeyW',
  [InputAction.MoveBackward]: 'KeyS',
  [InputAction.StrafeLeft]: 'KeyA',
  [InputAction.StrafeRight]: 'KeyD',
  [InputAction.Sprint]: ['ShiftLeft', 'ShiftRight'],
  [InputAction.Crouch]: ['ControlLeft', 'ControlRight'],
  [InputAction.Jump]: 'Space',

  // Combat
  [InputAction.AttackPrimary]: 'Mouse0',
  [InputAction.BlockOrFeint]: 'Mouse2',

  // UI
  [InputAction.OpenInventory]: 'KeyI',
  [InputAction.CloseOverlay]: 'Escape',

  // Camera
  [InputAction.ToggleCameraMode]: 'F5',

  // Debug — dummy controls
  [InputAction.DebugSpawnDummy]: 'KeyJ',
  [InputAction.DebugResetDummies]: 'KeyK',
  [InputAction.DebugToggleDummyBlock]: 'KeyT',
  [InputAction.DebugCycleBlockDir]: 'KeyY',

  // Debug — renderers
  [InputAction.DebugToggleWireframe]: 'F1',
  [InputAction.DebugTogglePhysics]: 'F2',
  [InputAction.DebugToggleHitboxes]: 'F3',
  [InputAction.DebugToggleFsmOverlay]: 'F4',
  [InputAction.DebugToggleTracers]: 'F6',
});
