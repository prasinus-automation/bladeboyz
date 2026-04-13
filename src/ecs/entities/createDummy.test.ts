import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addComponent } from 'bitecs';
import {
  Position,
  Rotation,
  Health,
  Stamina,
  CharacterModel,
  Hitboxes,
  CombatStateComponent,
} from '../components';
import {
  activeDummies,
  dummyLastHitTick,
  toggleDummyBlock,
  cycleDummyBlockDirection,
  resetAllDummies,
  tickDummyHealthReset,
  recordDummyHit,
} from './createDummy';
import { CombatState } from '../../combat/states';
import { BlockDirection } from '../../combat/directions';

/**
 * Tests for createDummy and dummy management functions.
 *
 * Note: createDummy itself requires Rapier WASM + Three.js scene, so we test
 * the management functions (toggleBlock, cycleDirection, resetAll, healthReset)
 * using mocked ECS state.
 */

// Helper: set up a fake dummy in the ECS arrays (no Rapier/Three needed)
function setupFakeDummy(eid: number): void {
  // Push into activeDummies if not already there
  if (!activeDummies.includes(eid)) {
    activeDummies.push(eid);
  }
  // Set component values directly on the typed arrays
  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Stamina.current[eid] = 100;
  Stamina.max[eid] = 100;
  CombatStateComponent.state[eid] = CombatState.Idle;
  CombatStateComponent.blockDirection[eid] = BlockDirection.Top;
  CombatStateComponent.ticksRemaining[eid] = 0;
  dummyLastHitTick.set(eid, -999);
}

function clearDummies(): void {
  activeDummies.length = 0;
  dummyLastHitTick.clear();
}

describe('Dummy management functions', () => {
  beforeEach(() => {
    clearDummies();
  });

  describe('toggleDummyBlock', () => {
    it('should toggle dummy from Idle to Block', () => {
      setupFakeDummy(100);
      const result = toggleDummyBlock();
      expect(CombatStateComponent.state[100]).toBe(CombatState.Block);
      expect(result).toContain('Block');
    });

    it('should toggle dummy from Block back to Idle', () => {
      setupFakeDummy(100);
      CombatStateComponent.state[100] = CombatState.Block;
      const result = toggleDummyBlock();
      expect(CombatStateComponent.state[100]).toBe(CombatState.Idle);
      expect(result).toBe('Idle');
    });

    it('should return "No dummies" when no dummies exist', () => {
      expect(toggleDummyBlock()).toBe('No dummies');
    });

    it('should toggle all dummies at once', () => {
      setupFakeDummy(100);
      setupFakeDummy(101);
      toggleDummyBlock();
      expect(CombatStateComponent.state[100]).toBe(CombatState.Block);
      expect(CombatStateComponent.state[101]).toBe(CombatState.Block);
    });
  });

  describe('cycleDummyBlockDirection', () => {
    it('should cycle from Top to Bottom', () => {
      setupFakeDummy(100);
      CombatStateComponent.blockDirection[100] = BlockDirection.Top;
      const result = cycleDummyBlockDirection();
      expect(result).toBe('Bottom');
      expect(CombatStateComponent.blockDirection[100]).toBe(BlockDirection.Bottom);
    });

    it('should cycle through all directions and wrap around', () => {
      setupFakeDummy(100);
      CombatStateComponent.blockDirection[100] = BlockDirection.Top;

      cycleDummyBlockDirection(); // Top -> Bottom
      expect(CombatStateComponent.blockDirection[100]).toBe(BlockDirection.Bottom);

      cycleDummyBlockDirection(); // Bottom -> Left
      expect(CombatStateComponent.blockDirection[100]).toBe(BlockDirection.Left);

      cycleDummyBlockDirection(); // Left -> Right
      expect(CombatStateComponent.blockDirection[100]).toBe(BlockDirection.Right);

      cycleDummyBlockDirection(); // Right -> Top (wrap)
      expect(CombatStateComponent.blockDirection[100]).toBe(BlockDirection.Top);
    });

    it('should return "No dummies" when no dummies exist', () => {
      expect(cycleDummyBlockDirection()).toBe('No dummies');
    });
  });

  describe('resetAllDummies', () => {
    it('should reset health, stamina, and state', () => {
      setupFakeDummy(100);
      Health.current[100] = 30;
      Stamina.current[100] = 20;
      CombatStateComponent.state[100] = CombatState.HitStun;
      CombatStateComponent.ticksRemaining[100] = 15;

      // resetAllDummies needs a GameWorld but only uses activeDummies array
      resetAllDummies({} as any);

      expect(Health.current[100]).toBe(100);
      expect(Stamina.current[100]).toBe(100);
      expect(CombatStateComponent.state[100]).toBe(CombatState.Idle);
      expect(CombatStateComponent.ticksRemaining[100]).toBe(0);
    });
  });

  describe('tickDummyHealthReset', () => {
    it('should reset health after enough ticks without being hit', () => {
      setupFakeDummy(100);
      Health.current[100] = 50;
      dummyLastHitTick.set(100, 0);

      // Tick 180+ times (3 seconds at 60Hz)
      for (let i = 0; i < 200; i++) {
        tickDummyHealthReset();
      }

      expect(Health.current[100]).toBe(100);
    });

    it('should not reset health if dummy was recently hit', () => {
      setupFakeDummy(100);
      Health.current[100] = 50;

      // Record a recent hit
      recordDummyHit(100);

      // Only tick a few times
      for (let i = 0; i < 10; i++) {
        tickDummyHealthReset();
      }

      expect(Health.current[100]).toBe(50);
    });
  });
});
