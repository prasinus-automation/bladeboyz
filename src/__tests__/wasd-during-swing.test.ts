/**
 * G1 — WASD continuity through full swing cycle (issue #175).
 *
 * Pins the architectural invariant that **InputSystem is decoupled from the
 * combat FSM**: holding W (or any movement key) MUST keep producing a non-zero
 * `MovementIntent.moveZ` for every tick of Windup, Release, AND Recovery
 * across every weapon and every direction. The swing must NOT zero the
 * movement intent.
 *
 * If a future change makes `inputSystem` consult `CombatStateComp.state` (or
 * any FSM field) to gate movement, this test fails immediately — by design.
 *
 * Setup: real `InputManager` + real `CombatFSM` + real `CombatSystem` driving
 * one Player entity (Player + MovementIntent + CombatStateComponent). LMB
 * down on tick 1 enters Windup via the actual `CombatSystem` plumbing; from
 * there `fsm.tick()` (called by `combatSystem`) auto-advances through Release
 * → Recovery → Idle.
 *
 * See `docs/animation-architecture.md` (tick contract) and
 * AGENTS.md "Tick contract" for the source-of-truth ordering this test pins.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import {
  Player,
  MovementIntent,
  CombatStateComponent,
  CombatStateComp,
} from '../ecs/components';
import {
  createInputSystem,
  resetInputState,
} from '../ecs/systems/InputSystem';
import {
  createCombatSystem,
  resetCombatInputState,
  weaponIdToName,
} from '../ecs/systems/CombatSystem';
import { CombatFSM, fsmRegistry } from '../combat/CombatFSM';
import { CombatState } from '../combat/states';
import { Direction } from '../combat/directions';
import { weaponConfigs } from '../weapons/WeaponConfig';
// Register all four weapons (side-effect imports).
import '../weapons/longsword';
import '../weapons/mace';
import '../weapons/dagger';
import '../weapons/battleaxe';
import { FIXED_TIMESTEP } from '../core/types';

const WEAPON_NAMES = ['Longsword', 'Mace', 'Dagger', 'Battleaxe'] as const;
const DIRECTIONS: Array<{ name: string; value: Direction }> = [
  { name: 'Overhead', value: Direction.Overhead },
  { name: 'Left', value: Direction.Left },
  { name: 'Right', value: Direction.Right },
  { name: 'Stab', value: Direction.Stab },
];

// ── Test fixture ────────────────────────────────────────

interface Fixture {
  ecs: any;
  eid: number;
  input: import('../input/InputManager').InputManager;
  canvas: HTMLCanvasElement;
  cameraController: any;
  inputSystem: (dt: number) => void;
  combatSystem: () => void;
  pressKey: (code: string) => void;
  releaseKey: (code: string) => void;
  pressLmb: () => void;
  releaseLmb: () => void;
}

async function buildFixture(weaponName: string): Promise<Fixture> {
  resetInputState();
  resetCombatInputState();
  fsmRegistry.clear();

  const ecs = createWorld();

  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const { InputManager } = await import('../input/InputManager');
  const input = new InputManager(canvas);

  const cameraController = {
    getYaw: vi.fn().mockReturnValue(0),
    getPitch: vi.fn().mockReturnValue(0),
    maxTurnRate: Infinity,
  } as any;

  const eid = addEntity(ecs);
  addComponent(ecs, Player, eid);
  addComponent(ecs, MovementIntent, eid);
  addComponent(ecs, CombatStateComponent, eid);
  addComponent(ecs, CombatStateComp, eid);

  // Resolve weaponId from the canonical `weaponIdToName` table so the
  // CombatSystem's getWeaponConfigById path stays exercised.
  const weaponId = weaponIdToName.indexOf(weaponName);
  if (weaponId < 0) throw new Error(`unknown weapon: ${weaponName}`);
  CombatStateComponent.weaponId[eid] = weaponId;

  // Register a CombatFSM keyed by entity ID — CombatSystem reads via
  // `fsmRegistry.get(eid)` to drive transitions.
  const fsm = new CombatFSM(weaponConfigs[weaponName]);
  fsmRegistry.set(eid, fsm);

  const inputSystem = createInputSystem(
    { ecs } as any,
    input,
    cameraController,
  );
  const combatSystem = createCombatSystem(ecs, input, cameraController);

  function pressKey(code: string) {
    document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  }
  function releaseKey(code: string) {
    document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  }
  function pressLmb() {
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
  }
  function releaseLmb() {
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
  }

  return {
    ecs,
    eid,
    input,
    canvas,
    cameraController,
    inputSystem,
    combatSystem,
    pressKey,
    releaseKey,
    pressLmb,
    releaseLmb,
  };
}

function teardownFixture(fx: Fixture): void {
  fx.canvas.remove();
  fsmRegistry.clear();
  resetInputState();
  resetCombatInputState();
}

// ── Tests ────────────────────────────────────────────────

// `CombatState` is a `const enum`, so reverse-lookup tables (`CombatState[n]`)
// don't exist at runtime and TS forbids the syntax. Hoist a local label table
// for human-readable assertion messages; keep in sync with `combat/states.ts`.
const COMBAT_STATE_LABELS = [
  'Idle',
  'Windup',
  'Release',
  'Recovery',
  'Blocking',
  'Parry',
  'HitStun',
] as const;

describe('G1 — WASD continuity through full swing cycle', () => {
  let fx: Fixture;

  afterEach(() => {
    if (fx) teardownFixture(fx);
  });

  for (const weaponName of WEAPON_NAMES) {
    for (const { name: dirName, value: dir } of DIRECTIONS) {
      it(`${weaponName} / ${dirName}: holding W keeps MovementIntent.moveZ < 0 across Windup+Release+Recovery`, async () => {
        fx = await buildFixture(weaponName);
        const weapon = weaponConfigs[weaponName];
        const fsm = fsmRegistry.get(fx.eid)!;

        // ── (1) Press W BEFORE the swing — verify the baseline. ──
        fx.pressKey('KeyW');
        fx.inputSystem(FIXED_TIMESTEP);
        expect(MovementIntent.moveZ[fx.eid]).toBeLessThan(0);

        // ── (2) Force the FSM into a deterministic direction. ──
        // The real `detectDirection()` reads the mouse delta buffer, which
        // is empty in jsdom and defaults to `Stab`. To pin the test to the
        // direction under examination, drive the FSM directly via
        // `transition()` instead of letting `combatSystem` infer it. We
        // still tick `combatSystem` afterwards so the ECS mirror, stamina
        // events, and the rest of the v2 contract get exercised.
        fsm.transition(/* CombatInput.Attack */ 0, dir);
        expect(fsm.state).toBe(CombatState.Windup);
        // FSM must report a non-zero phaseTotal for the windup it just
        // entered — otherwise the auto-progression loop below is racy.
        expect(fsm.phaseTotal).toBe(weapon.windup[dir]);

        // ── (3) Drive the full swing cycle: Windup → Release → Recovery. ──
        // CombatSystem ticks the FSM internally (one tick per call). For
        // each fixed step, also run InputSystem and assert MovementIntent
        // is still forward.
        const totalTicks =
          weapon.windup[dir] + weapon.release[dir] + weapon.recovery[dir];

        for (let t = 0; t < totalTicks; t++) {
          fx.inputSystem(FIXED_TIMESTEP);
          fx.combatSystem();

          // Hard invariant: the swing must not zero the movement intent.
          expect(
            MovementIntent.moveZ[fx.eid],
            `tick ${t} of swing (state=${COMBAT_STATE_LABELS[fsm.state] ?? fsm.state}, ` +
              `phase ${fsm.phaseElapsed}/${fsm.phaseTotal}) — moveZ was ${MovementIntent.moveZ[fx.eid]}`,
          ).toBeLessThan(0);

          // Defensive: while the FSM is still in the active swing window,
          // it must NOT be Idle. (After totalTicks we expect Idle below.)
          if (t < totalTicks - 1) {
            expect(fsm.state).not.toBe(CombatState.Idle);
          }
        }

        // ── (4) After Recovery completes, FSM is back to Idle and W is ──
        // still pressed: assert one final time that movement intent stays
        // forward.
        fx.inputSystem(FIXED_TIMESTEP);
        fx.combatSystem();
        expect(fsm.state).toBe(CombatState.Idle);
        expect(MovementIntent.moveZ[fx.eid]).toBeLessThan(0);
      });
    }
  }

  // ── Companion: same invariant for S / A / D, sanity-checked once
  // against the default weapon so the per-direction explosion stays at
  // 16 tests instead of 64. The decoupling argument is identical.

  it('S (backward) stays positive across a Longsword Overhead swing', async () => {
    fx = await buildFixture('Longsword');
    const weapon = weaponConfigs.Longsword;
    const fsm = fsmRegistry.get(fx.eid)!;

    fx.pressKey('KeyS');
    fx.inputSystem(FIXED_TIMESTEP);
    expect(MovementIntent.moveZ[fx.eid]).toBeGreaterThan(0);

    fsm.transition(0 /* Attack */, Direction.Overhead);
    const totalTicks =
      weapon.windup[Direction.Overhead] +
      weapon.release[Direction.Overhead] +
      weapon.recovery[Direction.Overhead];
    for (let t = 0; t < totalTicks; t++) {
      fx.inputSystem(FIXED_TIMESTEP);
      fx.combatSystem();
      expect(MovementIntent.moveZ[fx.eid]).toBeGreaterThan(0);
    }
  });

  it('A (strafe left) stays negative across a Mace Left swing', async () => {
    fx = await buildFixture('Mace');
    const weapon = weaponConfigs.Mace;
    const fsm = fsmRegistry.get(fx.eid)!;

    fx.pressKey('KeyA');
    fx.inputSystem(FIXED_TIMESTEP);
    expect(MovementIntent.moveX[fx.eid]).toBeLessThan(0);

    fsm.transition(0, Direction.Left);
    const totalTicks =
      weapon.windup[Direction.Left] +
      weapon.release[Direction.Left] +
      weapon.recovery[Direction.Left];
    for (let t = 0; t < totalTicks; t++) {
      fx.inputSystem(FIXED_TIMESTEP);
      fx.combatSystem();
      expect(MovementIntent.moveX[fx.eid]).toBeLessThan(0);
    }
  });

  it('D (strafe right) stays positive across a Dagger Stab swing', async () => {
    fx = await buildFixture('Dagger');
    const weapon = weaponConfigs.Dagger;
    const fsm = fsmRegistry.get(fx.eid)!;

    fx.pressKey('KeyD');
    fx.inputSystem(FIXED_TIMESTEP);
    expect(MovementIntent.moveX[fx.eid]).toBeGreaterThan(0);

    fsm.transition(0, Direction.Stab);
    const totalTicks =
      weapon.windup[Direction.Stab] +
      weapon.release[Direction.Stab] +
      weapon.recovery[Direction.Stab];
    for (let t = 0; t < totalTicks; t++) {
      fx.inputSystem(FIXED_TIMESTEP);
      fx.combatSystem();
      expect(MovementIntent.moveX[fx.eid]).toBeGreaterThan(0);
    }
  });

  // ── Bonus: explicitly assert the inverse — InputSystem MUST NOT read
  // the FSM. If it does, swapping the FSM out from under it should NOT
  // change MovementIntent. (Pins the decoupling architecturally.)

  it('InputSystem does not consult fsmRegistry — clearing it mid-swing leaves moveZ untouched', async () => {
    fx = await buildFixture('Battleaxe');
    const fsm = fsmRegistry.get(fx.eid)!;

    fx.pressKey('KeyW');
    fx.inputSystem(FIXED_TIMESTEP);
    expect(MovementIntent.moveZ[fx.eid]).toBeLessThan(0);

    fsm.transition(0, Direction.Overhead);
    fx.combatSystem(); // advance one combat tick so FSM is mid-Windup

    // Yank the FSM. If InputSystem reads anything from the FSM/CombatSystem,
    // this should now misbehave — but it must not, because they're decoupled.
    fsmRegistry.delete(fx.eid);

    fx.inputSystem(FIXED_TIMESTEP);
    expect(MovementIntent.moveZ[fx.eid]).toBeLessThan(0);
  });
});
