/**
 * Default keybind map.
 *
 * Pure data — no logic, no side effects. Source of truth for the default
 * keymap referenced in `docs/input-pipeline.md` §7. The runtime InputManager
 * (when rebuilt — see issue #102 and the migration plan) will derive its
 * mutable keybind state from this constant. A future remapping UI will
 * write user overrides to a separate persisted store, falling back to these
 * defaults for any unbound action.
 *
 * Values are `KeyboardEvent.code` strings (or arrays of them for aliases
 * like Shift left/right). Mouse buttons use the convention `Mouse0`,
 * `Mouse1`, `Mouse2` corresponding to `MouseEvent.button` 0/1/2.
 *
 * **Stability contract:** the *keys* of `DEFAULT_KEYBINDS` are
 * `InputAction` enum values. Adding a new action requires both adding the
 * enum entry in `InputManager.types.ts` AND adding a default binding here
 * — `Record<InputAction, ...>` enforces this at compile time.
 */

import { InputAction } from './InputManager.types';

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
