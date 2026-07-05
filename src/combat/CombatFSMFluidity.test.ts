/**
 * Fluidity contract tests (2026-07 "fighting should feel EXTREMELY fluid"
 * pass). These pin the behaviors that kill the stuck-after-swinging feel:
 *
 *  1. A combo click during Recovery shortens the CURRENT recovery to
 *     `comboRecovery` ticks — not just the one after the next swing.
 *  2. A click during Release buffers the next swing (input queueing) and
 *     the intervening Recovery runs at `comboRecovery` length.
 *  3. Attack fires straight out of Blocking (no release-then-click dance).
 *  4. Recovery turn rate is uncapped; HitStun cap is "dazed, not frozen".
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CombatFSM, CombatInput, setFsmTraceEnabled } from './CombatFSM';
import { CombatState } from './states';
import { Direction } from './directions';
import { longsword } from '../weapons/longsword';
import { weaponConfigs } from '../weapons/WeaponConfig';
// Register the full arsenal so the every-weapon turncap sweep sees them.
import '../weapons/mace';
import '../weapons/dagger';
import '../weapons/battleaxe';
import '../weapons/zweihander';
import '../weapons/warhammer';
import '../weapons/spear';
import '../weapons/katana';
import '../weapons/scythe';
import '../weapons/yeeter';

beforeEach(() => {
  setFsmTraceEnabled(false);
});

function makeFSM(): CombatFSM {
  return new CombatFSM(longsword);
}

/** Tick until the FSM reaches `state` (bounded). Returns ticks spent. */
function tickUntil(fsm: CombatFSM, state: CombatState, max = 200): number {
  for (let i = 0; i < max; i++) {
    if (fsm.state === state) return i;
    fsm.tick();
  }
  throw new Error(`never reached state ${state}`);
}

describe('combo click during Recovery shortens the CURRENT recovery', () => {
  it('buffered swing fires within comboRecovery ticks of the click', () => {
    const fsm = makeFSM();
    fsm.transition(CombatInput.Attack, Direction.Left);
    tickUntil(fsm, CombatState.Recovery);

    // Click on the first Recovery tick. Full recovery would be
    // recovery[Left]; the clamp must cut it to comboRecovery[Left].
    fsm.transition(CombatInput.Attack, Direction.Right);
    let ticks = 0;
    while (fsm.state === CombatState.Recovery) {
      fsm.tick();
      ticks++;
      expect(ticks).toBeLessThanOrEqual(longsword.comboRecovery[Direction.Left]);
    }
    expect(fsm.state).toBe(CombatState.Windup);
    expect(fsm.direction).toBe(Direction.Right);
  });

  it('a click LATE in a long recovery fires the chain on the next tick', () => {
    const fsm = makeFSM();
    fsm.transition(CombatInput.Attack, Direction.Overhead);
    tickUntil(fsm, CombatState.Recovery);
    // Sit past the comboRecovery mark, then click.
    for (let i = 0; i < longsword.comboRecovery[Direction.Overhead] + 3; i++) {
      fsm.tick();
    }
    expect(fsm.state).toBe(CombatState.Recovery);
    fsm.transition(CombatInput.Attack, Direction.Left);
    fsm.tick();
    expect(fsm.state).toBe(CombatState.Windup);
  });
});

describe('click during Release buffers the next swing', () => {
  it('queued mid-release, chains through a comboRecovery-length recovery', () => {
    const fsm = makeFSM();
    fsm.transition(CombatInput.Attack, Direction.Left);
    tickUntil(fsm, CombatState.Release);

    expect(fsm.transition(CombatInput.Attack, Direction.Overhead)).toBe(true);

    // Finish Release; the recovery that follows must be comboRecovery-long
    // (isComboRecovery was set at buffer time), then chain into Windup.
    tickUntil(fsm, CombatState.Recovery);
    let recoveryTicks = 0;
    while (fsm.state === CombatState.Recovery) {
      fsm.tick();
      recoveryTicks++;
    }
    expect(recoveryTicks).toBeLessThanOrEqual(
      longsword.comboRecovery[Direction.Left],
    );
    expect(fsm.state).toBe(CombatState.Windup);
    expect(fsm.direction).toBe(Direction.Overhead);
  });
});

describe('attack straight out of Blocking', () => {
  it('LMB while blocking goes directly to Windup', () => {
    const fsm = makeFSM();
    fsm.transition(CombatInput.Block, Direction.Left);
    expect(fsm.state).toBe(CombatState.Blocking);

    expect(fsm.transition(CombatInput.Attack, Direction.Overhead)).toBe(true);
    expect(fsm.state).toBe(CombatState.Windup);
    expect(fsm.direction).toBe(Direction.Overhead);
  });
});

describe('turncaps stay loose where fluidity demands it', () => {
  it('Recovery is uncapped for every registered weapon', () => {
    for (const cfg of Object.values(weaponConfigs)) {
      expect(cfg.turncap.recovery, `${cfg.name} recovery turncap`).toBe(
        Infinity,
      );
      expect(
        cfg.turncap.hitStun,
        `${cfg.name} hitStun turncap`,
      ).toBeGreaterThanOrEqual(0.02);
    }
  });

  it('FSM reports Infinity turncap during Recovery', () => {
    const fsm = makeFSM();
    fsm.transition(CombatInput.Attack, Direction.Left);
    tickUntil(fsm, CombatState.Recovery);
    expect(fsm.getCurrentTurncap()).toBe(Infinity);
  });
});
