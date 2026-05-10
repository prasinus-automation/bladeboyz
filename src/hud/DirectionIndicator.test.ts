/**
 * DirectionIndicator — Unit tests
 *
 * FSM v2 (#139): unified `Direction` enum (Overhead=0, Left=1, Right=2,
 * Stab=3). Indicator reads from `CombatStateComp.direction` (single field)
 * and draws 3 wedges (Overhead/Left/Right) plus a center ring (Stab).
 * The pre-#139 Bottom wedge is gone.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CombatStateComp } from '../ecs/components';
import { DirectionIndicator } from './DirectionIndicator';

// CombatState numeric values — FSM v2 (#135), const enum duplicated for tests.
const CombatState = {
  Idle: 0,
  Windup: 1,
  Release: 2,
  Recovery: 3,
  Blocking: 4,
  Parry: 5,
  HitStun: 6,
} as const;

// Direction numeric values — FSM v2 #139 (unified attack+block enum).
const Direction = {
  Overhead: 0,
  Left: 1,
  Right: 2,
  Stab: 3,
} as const;

const PLAYER_EID = 1;

// jsdom normalizes hex colors to rgb() format
const RED = 'rgb(255, 68, 68)';       // #ff4444
const BLUE = 'rgb(68, 170, 255)';     // #44aaff
const IDLE_WHITE = 'rgba(255, 255, 255, 0.35)';
const IDLE_STAB = 'rgba(255, 255, 255, 0.25)';
const DIM = 'rgba(255, 255, 255, 0.12)';

function setPlayerState(state: number, dir: number = Direction.Overhead) {
  CombatStateComp.state[PLAYER_EID] = state;
  CombatStateComp.direction[PLAYER_EID] = dir;
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

    setPlayerState(CombatState.Idle, Direction.Left);
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
    // FSM v2 (#139): 3 arrows (left/right/top) + 1 stab ring = 4 children.
    // Bottom wedge was removed when BlockDirection.Bottom was deleted.
    expect(container.children.length).toBe(4);
  });

  it('creates 3 directional arrows and 1 stab ring', () => {
    const arrows = getArrows(container);
    // FSM v2 (#139): only 3 arrows now — Bottom dropped.
    expect(arrows.length).toBe(3);
    expect(arrows.map(a => a.dataset.dir)).toEqual(['left', 'right', 'top']);

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

  it('highlights left arrow during idle with left direction', () => {
    setPlayerState(CombatState.Idle, Direction.Left);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    // Arrow array layout: [left=0, right=1, top=2]
    expect(arrows[0].style.borderBottomColor).toBe(IDLE_WHITE);
    expect(arrows[1].style.borderBottomColor).toBe(DIM);
    expect(arrows[2].style.borderBottomColor).toBe(DIM);
  });

  it('highlights right arrow in red during Windup with right direction', () => {
    setPlayerState(CombatState.Windup, Direction.Right);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    expect(arrows[1].style.borderBottomColor).toBe(RED);
    expect(arrows[0].style.borderBottomColor).toBe(DIM);
  });

  it('highlights overhead (top) arrow in red during Release', () => {
    setPlayerState(CombatState.Release, Direction.Overhead);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    expect(arrows[2].style.borderBottomColor).toBe(RED);
  });

  it('highlights stab ring during attack with Stab direction', () => {
    setPlayerState(CombatState.Windup, Direction.Stab);
    indicator.update(PLAYER_EID);

    const stab = getStabRing(container);
    expect(stab.style.borderColor).toBe(RED);
    // All arrows should be dim
    const arrows = getArrows(container);
    arrows.forEach(a => {
      expect(a.style.borderBottomColor).toBe(DIM);
    });
  });

  it('highlights direction in blue during Blocking', () => {
    // FSM v2 #139: Block(dir) defends `dir`. Direction.Right while
    // Blocking → right wedge lit blue.
    setPlayerState(CombatState.Blocking, Direction.Right);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    expect(arrows[1].style.borderBottomColor).toBe(BLUE);
    expect(arrows[0].style.borderBottomColor).toBe(DIM);
  });

  it('highlights direction in blue during Parry', () => {
    // FSM v2 (#135): Parry is the locked pose AFTER a successful parry —
    // the indicator should still show the defensive (blue) wedge.
    // FSM v2 (#139): Direction.Overhead = old BlockDirection.Top.
    setPlayerState(CombatState.Parry, Direction.Overhead);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    expect(arrows[2].style.borderBottomColor).toBe(BLUE);
  });

  it('highlights stab ring in blue during Blocking with Stab direction', () => {
    // FSM v2 #139: Block(Stab) defends an incoming Stab thrust — replaces
    // the v1 BlockDirection.Bottom slot.
    setPlayerState(CombatState.Blocking, Direction.Stab);
    indicator.update(PLAYER_EID);

    const stab = getStabRing(container);
    expect(stab.style.borderColor).toBe(BLUE);
  });

  it('shows stab ring dim-idle in idle with stab direction', () => {
    setPlayerState(CombatState.Idle, Direction.Stab);
    indicator.update(PLAYER_EID);

    const stab = getStabRing(container);
    expect(stab.style.borderColor).toBe(IDLE_STAB);
  });

  it('dims all arrows during Recovery (non-active state)', () => {
    setPlayerState(CombatState.Recovery, Direction.Right);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    arrows.forEach(a => {
      expect(a.style.borderBottomColor).toBe(DIM);
    });
  });

  it('updates direction in real-time as state changes', () => {
    setPlayerState(CombatState.Idle, Direction.Left);
    indicator.update(PLAYER_EID);

    const arrows = getArrows(container);
    expect(arrows[0].style.borderBottomColor).toBe(IDLE_WHITE);

    // Switch to attack with overhead
    setPlayerState(CombatState.Windup, Direction.Overhead);
    indicator.update(PLAYER_EID);

    expect(arrows[0].style.borderBottomColor).toBe(DIM);
    expect(arrows[2].style.borderBottomColor).toBe(RED);
  });

  it('dispose removes the container from DOM', () => {
    indicator.dispose();
    expect(document.getElementById('direction-indicator')).toBeNull();
  });
});
