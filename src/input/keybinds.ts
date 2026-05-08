/**
 * keybinds — typed table of keyboard / mouse bindings.
 *
 * Stub for issue #87 (rebindable controls). Today this is a hardcoded list
 * that the Controls overlay (issue #3) will iterate over to render the
 * keybinds page. When #87 lands, this file will own load/save and the table
 * will become user-mutable.
 *
 * Conventions:
 *   - `key` uses `KeyboardEvent.code` style (`'KeyW'`, `'Escape'`, `'F4'`)
 *     for keyboard, or `'Mouse0'` / `'Mouse1'` / `'Mouse2'` for mouse buttons.
 *   - `action` is a stable identifier — when issue #87 introduces user
 *     overrides, lookups will be by `action`, not by `key`.
 *   - `group` is the section label shown in the Controls overlay.
 *   - `label` is the human-readable description shown next to the key.
 */

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
