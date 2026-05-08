import { describe, it, expect, beforeEach } from 'vitest';
import {
  Health,
  Stamina,
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
import { AttackDirection, BlockDirection } from '../../combat/directions';
import { CombatFSM, fsmRegistry } from '../../combat/CombatFSM';
import type { WeaponConfig } from '../../weapons/WeaponConfig';

/**
 * Tests for createDummy and dummy management functions.
 *
 * Note: createDummy itself requires Rapier WASM + Three.js scene, so we test
 * the management functions (toggleBlock, cycleDirection, resetAll, healthReset)
 * using mocked ECS state. Each fake dummy registers a real `CombatFSM` so
 * the tests exercise the same FSM-driven path the runtime uses.
 */

function makeTestWeapon(): WeaponConfig {
  const ticks = {
    [AttackDirection.Left]: 6,
    [AttackDirection.Right]: 6,
    [AttackDirection.Overhead]: 8,
    [AttackDirection.Underhand]: 7,
    [AttackDirection.Stab]: 5,
  };
  return {
    name: 'TestSword',
    damage: {
      [AttackDirection.Left]: { head: 50, torso: 35, limb: 25 },
      [AttackDirection.Right]: { head: 50, torso: 35, limb: 25 },
      [AttackDirection.Overhead]: { head: 55, torso: 40, limb: 25 },
      [AttackDirection.Underhand]: { head: 45, torso: 35, limb: 25 },
      [AttackDirection.Stab]: { head: 45, torso: 40, limb: 20 },
    },
    windup: { ...ticks },
    release: {
      [AttackDirection.Left]: 4,
      [AttackDirection.Right]: 4,
      [AttackDirection.Overhead]: 5,
      [AttackDirection.Underhand]: 4,
      [AttackDirection.Stab]: 3,
    },
    recovery: {
      [AttackDirection.Left]: 12,
      [AttackDirection.Right]: 12,
      [AttackDirection.Overhead]: 15,
      [AttackDirection.Underhand]: 13,
      [AttackDirection.Stab]: 10,
    },
    comboRecovery: {
      [AttackDirection.Left]: 8,
      [AttackDirection.Right]: 8,
      [AttackDirection.Overhead]: 10,
      [AttackDirection.Underhand]: 9,
      [AttackDirection.Stab]: 6,
    },
    parryWindow: 6,
    staminaCost: { attack: 15, block: 10, parry: 5, feint: 20 },
    turncap: { windup: 0.08, release: 0.03, recovery: 0.05 },
    tracerPoints: [[0, 0.5, 0]],
    range: 1.4,
    blockStaminaDrain: 10,
    parryStunTicks: 40,
    hitStunTicks: 30,
  };
}

// Helper: set up a fake dummy in the ECS arrays (no Rapier/Three needed)
function setupFakeDummy(eid: number): void {
  // Push into activeDummies if not already there
  if (!activeDummies.includes(eid)) {
    activeDummies.push(eid);
  }
  // Register an FSM — toggle/cycle/reset all route through it.
  fsmRegistry.set(eid, new CombatFSM(makeTestWeapon()));
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
  for (const eid of activeDummies) fsmRegistry.delete(eid);
  activeDummies.length = 0;
  dummyLastHitTick.clear();
}

describe('Dummy management functions', () => {
  beforeEach(() => {
    clearDummies();
  });

  describe('toggleDummyBlock', () => {
    it('should toggle dummy from Idle into a blocking state (ParryWindow)', () => {
      setupFakeDummy(100);
      const result = toggleDummyBlock();
      // Block goes through ParryWindow first, exactly like the player FSM.
      expect(CombatStateComponent.state[100]).toBe(CombatState.ParryWindow);
      expect(result).toContain('Block');
    });

    it('should toggle dummy from Block back to Idle', () => {
      setupFakeDummy(100);
      // Drive the FSM into Block via the legitimate path: ParryWindow → tick → Block.
      const fsm = fsmRegistry.get(100)!;
      toggleDummyBlock(); // → ParryWindow
      // Tick the FSM through the parry window so it lands in Block.
      while (fsm.state === CombatState.ParryWindow) fsm.tick();
      expect(fsm.state).toBe(CombatState.Block);

      const result = toggleDummyBlock();
      expect(CombatStateComponent.state[100]).toBe(CombatState.Idle);
      expect(result).toBe('Idle');
    });

    it('should toggle dummy from ParryWindow back to Idle', () => {
      setupFakeDummy(100);
      toggleDummyBlock(); // → ParryWindow
      const result = toggleDummyBlock(); // → Idle
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
      expect(CombatStateComponent.state[100]).toBe(CombatState.ParryWindow);
      expect(CombatStateComponent.state[101]).toBe(CombatState.ParryWindow);
    });
  });

  describe('cycleDummyBlockDirection', () => {
    it('should cycle from Top to Bottom', () => {
      setupFakeDummy(100);
      // FSM starts with blockDirection = Top by default
      const result = cycleDummyBlockDirection();
      expect(result).toBe('Bottom');
      expect(CombatStateComponent.blockDirection[100]).toBe(BlockDirection.Bottom);
      expect(fsmRegistry.get(100)!.blockDirection).toBe(BlockDirection.Bottom);
    });

    it('should cycle through all directions and wrap around', () => {
      setupFakeDummy(100);

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
