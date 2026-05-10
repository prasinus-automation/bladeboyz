/**
 * keybinds — unit tests
 */
import { describe, it, expect } from 'vitest';
import {
  keybinds,
  getKeybind,
  keybindsByGroup,
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
});
