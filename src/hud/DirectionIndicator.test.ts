/**
 * DirectionIndicator — Unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CombatStateComponent } from '../ecs/components';
import { DirectionIndicator } from './DirectionIndicator';

// CombatState numeric values (const enum — duplicated for tests)
const CombatState = {
  Idle: 0,
  Windup: 1,
  Release: 2,
  Recovery: 3,
  Block: 4,
  ParryWindow: 5,
} as const;

// AttackDirection numeric values
const AttackDirection = {
  Left: 0,
  Right: 1,
  Overhead: 2,
  Underhand: 3,
  Stab: 4,
} as const;

// BlockDirection numeric values
const BlockDirection = {
  Left: 0,
  Right: 1,
  Top: 2,
  Bottom: 3,
} as const;

const PLAYER_EID = 1;

// jsdom normalizes hex colors to rgb() format
const RED = 'rgb(255, 68, 68)';       // #ff4444
const BLUE = 'rgb(68, 170, 255)';     // #44aaff
const IDLE_WHITE = 'rgba(255, 255, 255, 0.35)';
const IDLE_STAB = 'rgba(255, 255, 255, 0.25)';
const DIM = 'rgba(255, 255, 255, 0.12)';

function setPlayerState(state: number, atkDir = 0, blkDir = 0) {
  CombatStateComponent.state[PLAYER_EID] = state;
  CombatStateComponent.attackDirection[PLAYER_EID] = atkDir;
  CombatStateComponent.blockDirection[PLAYER_EID] = blkDir;
}

function getArrows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-dir]:not([data-dir="stab"])'));
}

function getStabRing(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('[data-dir="stab"]')!;
}

describe('DirectionIndicator', () => {
  let indicator: DirectionIndicator;
  let container: HTMLElement;

  beforeEach(() => {
    // Simulate pointer lock
    Object.defineProperty(document, 'pointerLockElement', {
      value: document.createElement('canvas'),
      writable: true,
      configurable: true,
    });

    setPlayerState(CombatState.Idle, AttackDirection.Left, BlockDirection.Left);
    indicator = new DirectionIndicator();
    container = document.getElementById('direction-indicator')!;
  });

  afterEach(() => {
    indicator.dispose();
    Object.defineProperty(document, 'pointerLockElement', {
      value: null,
      writable: true,
      configurable: true,
    });
  });

  it('creates container with correct id and structure', () => {
    expect(container).toBeTruthy();
    expect(container.style.pointerEvents).toBe('none');
    // 4 arrows + 1 stab ring = 5 children
    expect(container.children.length).toBe(5);
  });

  it('creates 4 directional arrows and 1 stab ring', () => {
    const arrows = getArrows(container);
    expect(arrows.length).toBe(4);
    expect(arrows.map(a => a.dataset.dir)).toEqual(['left', 'right', 'top', 'bottom']);

    const stab = getStabRing(container);
    expect(stab).toBeTruthy();
    expect(stab.style.borderRadius).toBe('50%');
  });

  it('hides when pointer lock is not active', () => {
    Object.defineProperty(document, 'pointerLockElement', {
      value: null,
      writable: true,
      configurable: true,
    });

    indicator.update(PLAYER_EID);
    expect(container.style.display).toBe('none');
  });

  it('shows when pointer lock is active', () => {
    indicator.update(PLAYER_EID);
    expect(container.style.display).toBe('block');
  });

  it('highlights left arrow during idle with left attack direction', () => {
    setPlayerState(CombatState.Idle, AttackDirection.Left);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    // Left arrow (index 0) should be idle white
    expect(arrows[0].style.borderBottomColor).toBe(IDLE_WHITE);
    // Others should be dim
    expect(arrows[1].style.borderBottomColor).toBe(DIM);
    expect(arrows[2].style.borderBottomColor).toBe(DIM);
    expect(arrows[3].style.borderBottomColor).toBe(DIM);
  });

  it('highlights right arrow in red during Windup with right attack', () => {
    setPlayerState(CombatState.Windup, AttackDirection.Right);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    expect(arrows[1].style.borderBottomColor).toBe(RED);
    expect(arrows[0].style.borderBottomColor).toBe(DIM);
  });

  it('highlights overhead arrow in red during Release', () => {
    setPlayerState(CombatState.Release, AttackDirection.Overhead);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    expect(arrows[2].style.borderBottomColor).toBe(RED);
  });

  it('highlights stab ring during attack with Stab direction', () => {
    setPlayerState(CombatState.Windup, AttackDirection.Stab);
    indicator.update(PLAYER_EID);

    const stab = getStabRing(container);
    expect(stab.style.borderColor).toBe(RED);
    // All arrows should be dim
    const arrows = getArrows(container);
    arrows.forEach(a => {
      expect(a.style.borderBottomColor).toBe(DIM);
    });
  });

  it('highlights block direction in blue during Block', () => {
    setPlayerState(CombatState.Block, AttackDirection.Left, BlockDirection.Right);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    // Block Right = index 1
    expect(arrows[1].style.borderBottomColor).toBe(BLUE);
    expect(arrows[0].style.borderBottomColor).toBe(DIM);
  });

  it('highlights block direction in blue during ParryWindow', () => {
    setPlayerState(CombatState.ParryWindow, AttackDirection.Left, BlockDirection.Top);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    // Block Top = index 2
    expect(arrows[2].style.borderBottomColor).toBe(BLUE);
  });

  it('shows stab ring dim in idle with stab direction', () => {
    setPlayerState(CombatState.Idle, AttackDirection.Stab);
    indicator.update(PLAYER_EID);

    const stab = getStabRing(container);
    expect(stab.style.borderColor).toBe(IDLE_STAB);
  });

  it('dims all arrows during Recovery (non-active state)', () => {
    setPlayerState(CombatState.Recovery, AttackDirection.Right);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    arrows.forEach(a => {
      expect(a.style.borderBottomColor).toBe(DIM);
    });
  });

  it('updates direction in real-time as state changes', () => {
    setPlayerState(CombatState.Idle, AttackDirection.Left);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    expect(arrows[0].style.borderBottomColor).toBe(IDLE_WHITE);

    // Switch to attack with overhead
    setPlayerState(CombatState.Windup, AttackDirection.Overhead);
    indicator.update(PLAYER_EID);

    expect(arrows[0].style.borderBottomColor).toBe(DIM);
    expect(arrows[2].style.borderBottomColor).toBe(RED);
  });

  it('dispose removes the container from DOM', () => {
    indicator.dispose();
    expect(document.getElementById('direction-indicator')).toBeNull();
  });

  it('highlights underhand direction correctly', () => {
    setPlayerState(CombatState.Windup, AttackDirection.Underhand);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    // Underhand = index 3 (bottom)
    expect(arrows[3].style.borderBottomColor).toBe(RED);
  });

  it('highlights bottom block direction correctly', () => {
    setPlayerState(CombatState.Block, AttackDirection.Left, BlockDirection.Bottom);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    // Block Bottom = index 3
    expect(arrows[3].style.borderBottomColor).toBe(BLUE);
  });
});
