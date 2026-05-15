/**
 * keybinds — unit tests
 */
import { describe, it, expect } from 'vitest';
import {
  keybinds,
  getKeybind,
  keybindsByGroup,
  formatKeyCode,
  type Keybind,
  type KeybindGroup,
} from './keybinds';

describe('keybinds', () => {
  it('table is non-empty', () => {
    expect(keybinds.length).toBeGreaterThan(0);
  });

  it('every entry has a non-empty action, key, and label', () => {
    for (const kb of keybinds) {
      expect(typeof kb.action).toBe('string');
      expect(kb.action.length).toBeGreaterThan(0);
      expect(typeof kb.key).toBe('string');
      expect(kb.key.length).toBeGreaterThan(0);
      expect(typeof kb.label).toBe('string');
      expect(kb.label.length).toBeGreaterThan(0);
    }
  });

  it('every entry uses one of the allowed groups', () => {
    const allowed: KeybindGroup[] = ['Movement', 'Combat', 'Interface'];
    for (const kb of keybinds) {
      expect(allowed).toContain(kb.group);
    }
  });

  it('action identifiers are unique', () => {
    const seen = new Set<string>();
    for (const kb of keybinds) {
      expect(seen.has(kb.action)).toBe(false);
      seen.add(kb.action);
    }
  });

  it('contains the canonical movement bindings', () => {
    const actions = keybinds.map((k) => k.action);
    expect(actions).toContain('moveForward');
    expect(actions).toContain('moveBackward');
    expect(actions).toContain('moveLeft');
    expect(actions).toContain('moveRight');
  });

  it('contains the inventory + pause bindings the menu system uses', () => {
    expect(getKeybind('toggleInventory')?.key).toBe('KeyI');
    expect(getKeybind('pauseMenu')?.key).toBe('Escape');
  });

  describe('getKeybind', () => {
    it('finds an existing binding', () => {
      const kb = getKeybind('moveForward');
      expect(kb).toBeDefined();
      expect(kb!.key).toBe('KeyW');
    });

    it('returns undefined for unknown actions', () => {
      expect(getKeybind('nope')).toBeUndefined();
    });
  });

  describe('keybindsByGroup', () => {
    it('partitions every binding into its declared group', () => {
      const grouped = keybindsByGroup();
      const total =
        grouped.Movement.length + grouped.Combat.length + grouped.Interface.length;
      expect(total).toBe(keybinds.length);
    });

    it('preserves insertion order within each group', () => {
      const grouped = keybindsByGroup();
      // Within Movement, the canonical WASD order is W,S,A,D per file order
      const movementActions = grouped.Movement.map((k) => k.action);
      const idxW = movementActions.indexOf('moveForward');
      const idxS = movementActions.indexOf('moveBackward');
      expect(idxW).toBeGreaterThanOrEqual(0);
      expect(idxS).toBeGreaterThan(idxW);
    });
  });

  describe('Keybind type', () => {
    it('narrows correctly with type guards', () => {
      const kb: Keybind = { action: 'x', key: 'KeyX', group: 'Combat', label: 'X' };
      // TS-level: this should compile. Runtime: assert structurally.
      expect(kb.group).toBe('Combat');
    });
  });

  describe('formatKeyCode', () => {
    it('letters: KeyA → A', () => {
      expect(formatKeyCode('KeyA')).toBe('A');
    });

    it('letters: every KeyA..KeyZ maps to single uppercase letter', () => {
      for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode('A'.charCodeAt(0) + i);
        expect(formatKeyCode('Key' + letter)).toBe(letter);
      }
    });

    it('digits: Digit0 → 0', () => {
      expect(formatKeyCode('Digit0')).toBe('0');
      expect(formatKeyCode('Digit5')).toBe('5');
      expect(formatKeyCode('Digit9')).toBe('9');
    });

    it('numpad digits: Numpad0 → Num0', () => {
      expect(formatKeyCode('Numpad0')).toBe('Num0');
      expect(formatKeyCode('Numpad7')).toBe('Num7');
    });

    it('Shift variants collapse to Shift', () => {
      expect(formatKeyCode('ShiftLeft')).toBe('Shift');
      expect(formatKeyCode('ShiftRight')).toBe('Shift');
    });

    it('Control variants collapse to Ctrl', () => {
      expect(formatKeyCode('ControlLeft')).toBe('Ctrl');
      expect(formatKeyCode('ControlRight')).toBe('Ctrl');
    });

    it('Alt variants collapse to Alt', () => {
      expect(formatKeyCode('AltLeft')).toBe('Alt');
      expect(formatKeyCode('AltRight')).toBe('Alt');
    });

    it('Meta variants collapse to Meta', () => {
      expect(formatKeyCode('MetaLeft')).toBe('Meta');
      expect(formatKeyCode('MetaRight')).toBe('Meta');
    });

    it('Space passes through as "Space"', () => {
      expect(formatKeyCode('Space')).toBe('Space');
    });

    it('Escape → Esc', () => {
      expect(formatKeyCode('Escape')).toBe('Esc');
    });

    it('Tab and Enter pass through unchanged', () => {
      expect(formatKeyCode('Tab')).toBe('Tab');
      expect(formatKeyCode('Enter')).toBe('Enter');
    });

    it('Backspace and Delete pass through unchanged', () => {
      expect(formatKeyCode('Backspace')).toBe('Backspace');
      expect(formatKeyCode('Delete')).toBe('Delete');
    });

    it('F-keys pass through (F1..F12)', () => {
      expect(formatKeyCode('F1')).toBe('F1');
      expect(formatKeyCode('F4')).toBe('F4');
      expect(formatKeyCode('F12')).toBe('F12');
    });

    it('does NOT treat F13+ as F-key (no F13/F14 in our coverage)', () => {
      // The whitelist stops at F12 — beyond that we fall through to passthrough.
      // The end result is still "F13" passing through, so visually the user
      // would still see something sensible.
      expect(formatKeyCode('F13')).toBe('F13');
    });

    it('arrow keys render as Unicode arrows', () => {
      expect(formatKeyCode('ArrowLeft')).toBe('←');
      expect(formatKeyCode('ArrowRight')).toBe('→');
      expect(formatKeyCode('ArrowUp')).toBe('↑');
      expect(formatKeyCode('ArrowDown')).toBe('↓');
    });

    it('Mouse0/1/2 → LMB/MMB/RMB', () => {
      expect(formatKeyCode('Mouse0')).toBe('LMB');
      expect(formatKeyCode('Mouse1')).toBe('MMB');
      expect(formatKeyCode('Mouse2')).toBe('RMB');
    });

    it('unknown codes pass through unchanged', () => {
      expect(formatKeyCode('AnythingWeird')).toBe('AnythingWeird');
      expect(formatKeyCode('OSLeft')).toBe('OSLeft');
      expect(formatKeyCode('')).toBe('');
    });

    it('passes through the every `key` in the bindings table without throwing', () => {
      // The Controls overlay will call this on every keybind in the table.
      // None of them should crash or return an empty string for a non-empty input.
      for (const kb of keybinds) {
        const result = formatKeyCode(kb.key);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });
  });
});
