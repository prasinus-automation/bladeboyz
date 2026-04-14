/**
 * Tests for the CombatSystem — ECS system that bridges input to FSMs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent, type IWorld } from 'bitecs';
import { CombatStateComponent, CombatStateComp, Player } from '../components';
import { CombatState } from '../../combat/states';
import { AttackDirection, BlockDirection } from '../../combat/directions';
import { CombatFSM, CombatInput, fsmRegistry, createFSM } from '../../combat/CombatFSM';
import { createCombatSystem, resetCombatInputState, computePhaseTotal } from './CombatSystem';
import type { WeaponConfig } from '../../weapons/WeaponConfig';

// ── Mock InputManager ────────────────────────────────────

class MockInputManager {
  private _mouseButtons = new Set<number>();
  private _keys = new Set<string>();
  private _mouseDelta = { x: 0, y: 0 };

  pressMouseButton(button: number): void {
    this._mouseButtons.add(button);
  }

  releaseMouseButton(button: number): void {
    this._mouseButtons.delete(button);
  }

  isMouseButtonDown(button: number): boolean {
    return this._mouseButtons.has(button);
  }

  isKeyDown(code: string): boolean {
    return this._keys.has(code);
  }

  setMouseDelta(x: number, y: number): void {
    this._mouseDelta = { x, y };
  }

  getMouseDelta(): { x: number; y: number } {
    return this._mouseDelta;
  }

  getAverageDelta(): { dx: number; dy: number } {
    return { dx: this._mouseDelta.x, dy: this._mouseDelta.y };
  }

  resetFrameDeltas(): void {
    this._mouseDelta = { x: 0, y: 0 };
  }
}

// ── Test weapon config ───────────────────────────────────

function createTestWeapon(): WeaponConfig {
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

// ── Tests ────────────────────────────────────────────────

describe('CombatSystem', () => {
  let ecsWorld: IWorld;
  let input: MockInputManager;
  let tick: () => void;
  let playerEid: number;
  let weapon: WeaponConfig;

  beforeEach(() => {
    // Clear FSM registry
    fsmRegistry.clear();
    resetCombatInputState();

    ecsWorld = createWorld();
    input = new MockInputManager();
    weapon = createTestWeapon();

    // Create player entity with combat components
    playerEid = addEntity(ecsWorld);
    addComponent(ecsWorld, CombatStateComponent, playerEid);
    addComponent(ecsWorld, CombatStateComp, playerEid);
    addComponent(ecsWorld, Player, playerEid);
    CombatStateComponent.state[playerEid] = CombatState.Idle;
    CombatStateComponent.ticksRemaining[playerEid] = 0;
    CombatStateComponent.weaponId[playerEid] = 0;

    // Create FSM for player
    createFSM(playerEid, weapon);

    // Create system
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tick = createCombatSystem(ecsWorld, input as any);
  });

  it('left click triggers attack transition', () => {
    input.pressMouseButton(0);
    tick(); // First tick: detect press, transition to Windup
    expect(CombatStateComponent.state[playerEid]).toBe(CombatState.Windup);
  });

  it('attack input only triggers on press edge (not held)', () => {
    input.pressMouseButton(0);
    tick(); // Press edge → Windup
    expect(CombatStateComponent.state[playerEid]).toBe(CombatState.Windup);

    // Hold button and tick again — should NOT restart windup
    const ticksBefore = CombatStateComponent.ticksRemaining[playerEid];
    tick();
    // Ticks should have decreased by 1, not reset
    expect(CombatStateComponent.ticksRemaining[playerEid]).toBe(ticksBefore - 1);
  });

  it('right click triggers block from Idle', () => {
    input.pressMouseButton(2);
    tick();
    expect(CombatStateComponent.state[playerEid]).toBe(CombatState.ParryWindow);
  });

  it('right click during Windup triggers feint', () => {
    input.pressMouseButton(0);
    tick(); // → Windup
    input.releaseMouseButton(0);
    tick(); // edge detection reset

    input.pressMouseButton(2);
    tick(); // right-click during windup → Feint
    expect(CombatStateComponent.state[playerEid]).toBe(CombatState.Feint);
  });

  it('release right mouse button releases block', () => {
    input.pressMouseButton(2);
    tick(); // → ParryWindow

    // Tick through parry window to get to Block
    for (let i = 0; i < weapon.parryWindow; i++) tick();
    expect(CombatStateComponent.state[playerEid]).toBe(CombatState.Block);

    input.releaseMouseButton(2);
    tick(); // → Idle
    expect(CombatStateComponent.state[playerEid]).toBe(CombatState.Idle);
  });

  it('syncs ticksRemaining to ECS component', () => {
    input.pressMouseButton(0);
    tick(); // → Windup

    // After one tick, ticksRemaining should be windup - 1 (tick() decremented it)
    const expected = weapon.windup[AttackDirection.Stab] - 1; // Stab due to no mouse movement
    expect(CombatStateComponent.ticksRemaining[playerEid]).toBe(expected);
  });

  it('ticks non-player combat entities without input', () => {
    // Create a non-player combat entity (e.g., dummy)
    const dummyEid = addEntity(ecsWorld);
    addComponent(ecsWorld, CombatStateComponent, dummyEid);
    CombatStateComponent.state[dummyEid] = CombatState.Idle;

    // Create FSM and force it into a state
    const dummyFsm = createFSM(dummyEid, weapon);
    dummyFsm.transition(CombatInput.HitReceived);

    tick();
    // Should tick the dummy's FSM and sync to ECS
    expect(CombatStateComponent.state[dummyEid]).toBe(CombatState.HitStun);
    expect(CombatStateComponent.ticksRemaining[dummyEid]).toBe(weapon.hitStunTicks - 1);
  });

  it('complete attack chain syncs all states through ECS', () => {
    // Attack
    input.pressMouseButton(0);
    tick(); // → Windup

    // Tick through windup
    input.releaseMouseButton(0);
    const windup = weapon.windup[AttackDirection.Stab]; // no mouse movement = Stab
    for (let i = 1; i < windup; i++) tick();
    tick(); // → Release
    expect(CombatStateComponent.state[playerEid]).toBe(CombatState.Release);

    // Tick through release
    const release = weapon.release[AttackDirection.Stab];
    for (let i = 0; i < release; i++) tick();
    expect(CombatStateComponent.state[playerEid]).toBe(CombatState.Recovery);

    // Tick through recovery
    const recovery = weapon.recovery[AttackDirection.Stab];
    for (let i = 0; i < recovery; i++) tick();
    expect(CombatStateComponent.state[playerEid]).toBe(CombatState.Idle);
  });

  // ── CombatStateComp sync tests ────────────────────────

  describe('CombatStateComp sync', () => {
    it('syncs state to CombatStateComp on attack', () => {
      input.pressMouseButton(0);
      tick(); // → Windup
      expect(CombatStateComp.state[playerEid]).toBe(CombatState.Windup);
    });

    it('syncs direction to CombatStateComp (attack direction)', () => {
      input.pressMouseButton(0);
      tick();
      // No mouse movement → Stab direction
      expect(CombatStateComp.direction[playerEid]).toBe(AttackDirection.Stab);
    });

    it('syncs phaseTotal for windup state', () => {
      input.pressMouseButton(0);
      tick();
      expect(CombatStateComp.phaseTotal[playerEid]).toBe(weapon.windup[AttackDirection.Stab]);
    });

    it('syncs phaseElapsed correctly during windup', () => {
      input.pressMouseButton(0);
      tick(); // 1st tick in Windup
      // After tick: phaseElapsed = phaseTotal - ticksRemaining
      const phaseTotal = weapon.windup[AttackDirection.Stab];
      const ticksRemaining = CombatStateComponent.ticksRemaining[playerEid];
      expect(CombatStateComp.phaseElapsed[playerEid]).toBe(phaseTotal - ticksRemaining);
    });

    it('syncs phaseTotal for release state', () => {
      input.pressMouseButton(0);
      tick(); // → Windup
      input.releaseMouseButton(0);
      // Tick through windup
      const windup = weapon.windup[AttackDirection.Stab];
      for (let i = 1; i < windup; i++) tick();
      tick(); // → Release (timer expired, auto-transition)
      expect(CombatStateComp.state[playerEid]).toBe(CombatState.Release);
      expect(CombatStateComp.phaseTotal[playerEid]).toBe(weapon.release[AttackDirection.Stab]);
    });

    it('syncs block direction for ParryWindow state', () => {
      input.pressMouseButton(2);
      tick(); // → ParryWindow
      expect(CombatStateComp.state[playerEid]).toBe(CombatState.ParryWindow);
      // Block direction defaults to Top when no mouse movement
      expect(CombatStateComp.direction[playerEid]).toBe(BlockDirection.Top);
    });

    it('phaseElapsed progresses each tick', () => {
      input.pressMouseButton(0);
      tick(); // Tick 1 of Windup
      const elapsed1 = CombatStateComp.phaseElapsed[playerEid];

      input.releaseMouseButton(0);
      tick(); // Tick 2 of Windup
      const elapsed2 = CombatStateComp.phaseElapsed[playerEid];

      expect(elapsed2).toBe(elapsed1 + 1);
    });

    it('Idle state has phaseTotal = 0 and phaseElapsed = 0', () => {
      tick(); // stays Idle
      expect(CombatStateComp.state[playerEid]).toBe(CombatState.Idle);
      expect(CombatStateComp.phaseTotal[playerEid]).toBe(0);
      expect(CombatStateComp.phaseElapsed[playerEid]).toBe(0);
    });
  });

  // ── computePhaseTotal unit tests ──────────────────────

  describe('computePhaseTotal', () => {
    it('returns windup ticks for Windup state', () => {
      const fsm = new CombatFSM(weapon);
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      fsm.tick();
      expect(computePhaseTotal(CombatState.Windup, fsm)).toBe(weapon.windup[AttackDirection.Left]);
    });

    it('returns release ticks for Release state', () => {
      const fsm = new CombatFSM(weapon);
      fsm.transition(CombatInput.Attack, AttackDirection.Stab);
      // Tick through windup
      for (let i = 0; i < weapon.windup[AttackDirection.Stab]; i++) fsm.tick();
      expect(fsm.state).toBe(CombatState.Release);
      expect(computePhaseTotal(CombatState.Release, fsm)).toBe(weapon.release[AttackDirection.Stab]);
    });

    it('returns recovery ticks for Recovery state', () => {
      const fsm = new CombatFSM(weapon);
      fsm.transition(CombatInput.Attack, AttackDirection.Stab);
      // Through windup
      for (let i = 0; i < weapon.windup[AttackDirection.Stab]; i++) fsm.tick();
      // Through release
      for (let i = 0; i < weapon.release[AttackDirection.Stab]; i++) fsm.tick();
      expect(fsm.state).toBe(CombatState.Recovery);
      expect(computePhaseTotal(CombatState.Recovery, fsm)).toBe(weapon.recovery[AttackDirection.Stab]);
    });

    it('returns 3 for Feint state', () => {
      const fsm = new CombatFSM(weapon);
      fsm.transition(CombatInput.Attack, AttackDirection.Left);
      fsm.tick();
      fsm.transition(CombatInput.Feint);
      fsm.tick();
      expect(fsm.state).toBe(CombatState.Feint);
      expect(computePhaseTotal(CombatState.Feint, fsm)).toBe(3);
    });

    it('returns 0 for Idle state', () => {
      const fsm = new CombatFSM(weapon);
      expect(computePhaseTotal(CombatState.Idle, fsm)).toBe(0);
    });

    it('returns parryWindow for ParryWindow state', () => {
      const fsm = new CombatFSM(weapon);
      fsm.transition(CombatInput.Block, undefined, BlockDirection.Top);
      fsm.tick();
      expect(fsm.state).toBe(CombatState.ParryWindow);
      expect(computePhaseTotal(CombatState.ParryWindow, fsm)).toBe(weapon.parryWindow);
    });

    it('returns hitStunTicks for HitStun state', () => {
      const fsm = new CombatFSM(weapon);
      fsm.transition(CombatInput.HitReceived);
      fsm.tick();
      expect(fsm.state).toBe(CombatState.HitStun);
      expect(computePhaseTotal(CombatState.HitStun, fsm)).toBe(weapon.hitStunTicks);
    });
  });
});
