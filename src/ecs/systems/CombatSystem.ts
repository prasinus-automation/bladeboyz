/**
 * CombatSystem — ECS system that bridges input to the per-entity CombatFSM.
 *
 * Runs in fixedUpdate() at 60 Hz. Each tick:
 * 1. Reads input state (mouse buttons, rolling mouse buffer for direction)
 * 2. Calls FSM transitions based on input
 * 3. Ticks the FSM (phaseElapsed countdown + auto-transitions)
 * 4. Syncs FSM state back to the CombatStateComponent for other systems to read
 * 5. Drains stamina events and queues them with StaminaSystem
 *
 * FSM v2 (#135): Feint input is gone — RMB-during-Windup no longer triggers
 * a feint. RMB always evaluates as a Block input now (rejected by the FSM
 * if state is Windup, since canTransition(Block) is false there).
 *
 * FSM v2 (#139): direction sampling switched from single-frame
 * `getMouseDelta()` to the rolling `getAverageDelta(100)` buffer. Both
 * Attack and Block use the same `detectDirection(input)` call against the
 * unified 4-value `Direction` enum.
 */

import { defineQuery, hasComponent, type IWorld } from 'bitecs';
import {
  CombatStateComponent,
  CombatStateComp,
  Player,
  DeadTag,
} from '../components';
import { CombatState } from '../../combat/states';
import { CombatInput, fsmRegistry } from '../../combat/CombatFSM';
import { detectDirection } from '../../combat/directions';
import type { InputManager } from '../../input/InputManager';
import type { CameraController } from '../../rendering/CameraController';
import { queueStaminaCost } from './StaminaSystem';
import { weaponConfigs } from '../../weapons/WeaponConfig';

// ── Queries ──────────────────────────────────────────────

const combatQuery = defineQuery([CombatStateComponent]);
const playerQuery = defineQuery([CombatStateComponent, Player]);

// ── Weapon ID → name mapping ─────────────────────────────

export const weaponIdToName: string[] = ['Longsword', 'Mace', 'Dagger', 'Battleaxe'];

/** Look up weapon config by numeric ID */
function getWeaponConfigById(id: number) {
  const name = weaponIdToName[id];
  return name ? weaponConfigs[name] : undefined;
}

// ── Previous input state (for edge detection) ────────────

let prevLeftMouseDown = false;
let prevRightMouseDown = false;

/** Reset input tracking state (for testing) */
export function resetCombatInputState(): void {
  prevLeftMouseDown = false;
  prevRightMouseDown = false;
}

// ── System factory ───────────────────────────────────────

/**
 * Create the combat system closure.
 * Returns a tick function to be called in fixedUpdate.
 */
export function createCombatSystem(
  ecsWorld: IWorld,
  input: InputManager,
  cameraController?: CameraController,
): () => void {
  return function combatSystemTick(): void {
    const playerEntities = playerQuery(ecsWorld);
    const leftMouseDown = input.isMouseButtonDown(0);
    const rightMouseDown = input.isMouseButtonDown(2);

    // Detect press/release edges
    const leftJustPressed = leftMouseDown && !prevLeftMouseDown;
    const rightJustPressed = rightMouseDown && !prevRightMouseDown;
    const rightJustReleased = !rightMouseDown && prevRightMouseDown;

    // Update previous state
    prevLeftMouseDown = leftMouseDown;
    prevRightMouseDown = rightMouseDown;

    // Process player entities (input-driven)
    for (const eid of playerEntities) {
      // Dead entities don't read input. processDeaths already reset their
      // FSM to Idle; without this skip a held mouse button would re-arm
      // an attack mid-respawn.
      if (hasComponent(ecsWorld, DeadTag, eid)) continue;

      const fsm = fsmRegistry.get(eid);
      if (!fsm) continue;

      // Direction is sampled at click time from the rolling 100 ms mouse
      // buffer (FSM v2 #139). Attack and Block use the same algorithm — the
      // pre-v2 split into `detectAttackDirection`/`detectBlockDirection`
      // had identical logic, so they're a single `detectDirection` now.

      // Attack input (left mouse button press) — FSM handles morph + combo.
      if (leftJustPressed) {
        const dir = detectDirection(input);
        fsm.transition(CombatInput.Attack, dir);
      }

      // Block input (right mouse button press). FSM v2: always a Block —
      // Feint is gone, so RMB during Windup just no-ops via `canTransition`.
      if (rightJustPressed) {
        const dir = detectDirection(input);
        fsm.transition(CombatInput.Block, dir);
      }

      // Release block (right mouse button released)
      if (rightJustReleased) {
        fsm.transition(CombatInput.ReleaseBlock);
      }
    }

    // Tick all combat entities (including non-player AI/dummies)
    const allCombatEntities = combatQuery(ecsWorld);
    for (const eid of allCombatEntities) {
      // Dead entities (player or bot) don't tick FSM, don't sync ECS mirrors.
      // processDeaths already wrote them to Idle; respawn restores normal flow.
      if (hasComponent(ecsWorld, DeadTag, eid)) continue;

      const fsm = fsmRegistry.get(eid);
      if (!fsm) continue;

      // Advance FSM timer (increments phaseElapsed; auto-transitions on phase end).
      fsm.tick();

      // Sync FSM state to ECS component. With the unified `Direction` enum
      // (FSM v2 #139), `attackDirection` and `blockDirection` ECS slots both
      // get the same value — they're a transitional pair until issue C
      // (#136) collapses CombatStateComponent + CombatStateComp into a
      // single component with one direction field.
      CombatStateComponent.state[eid] = fsm.state;
      CombatStateComponent.ticksRemaining[eid] = fsm.ticksRemaining;
      CombatStateComponent.attackDirection[eid] = fsm.direction;
      CombatStateComponent.blockDirection[eid] = fsm.direction;

      // Sync CombatStateComp (read by AnimationSystem)
      CombatStateComp.state[eid] = fsm.state;
      CombatStateComp.direction[eid] = fsm.direction;
      // Phase fields straight from the FSM (single source of truth).
      CombatStateComp.phaseTotal[eid] = fsm.phaseTotal;
      CombatStateComp.phaseElapsed[eid] = fsm.phaseElapsed;
      CombatStateComp.phaseT[eid] = fsm.getPhaseT();
      CombatStateComp.weaponId[eid] = CombatStateComponent.weaponId[eid];

      // Drain and forward stamina events
      const staminaEvents = fsm.drainStaminaEvents();
      const weaponConfig = fsm.weaponConfig;
      for (const evt of staminaEvents) {
        queueStaminaCost({
          entity: eid,
          type: evt.type,
          weaponConfig,
        });
      }
    }

    // Update turncap for player entities (drag/accel mechanic)
    if (cameraController) {
      for (const eid of playerEntities) {
        // Dead players: leave turncap at whatever the last live tick set
        // it to. Camera still works during the respawn screen, but the
        // input loop is otherwise frozen.
        if (hasComponent(ecsWorld, DeadTag, eid)) continue;
        const fsm = fsmRegistry.get(eid);
        if (fsm) {
          cameraController.maxTurnRate = fsm.getCurrentTurncap();
        }
      }
    }
  };
}
