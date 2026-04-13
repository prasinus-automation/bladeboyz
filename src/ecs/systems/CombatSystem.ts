/**
 * CombatSystem — ECS system that bridges input to the per-entity CombatFSM.
 *
 * Runs in fixedUpdate() at 60Hz. Each tick:
 * 1. Reads input state (mouse buttons, mouse deltas for direction)
 * 2. Calls FSM transitions based on input
 * 3. Ticks the FSM (timer countdown + auto-transitions)
 * 4. Syncs FSM state back to the CombatStateComponent for other systems to read
 * 5. Drains stamina events and queues them with StaminaSystem
 */

import { defineQuery, type IWorld } from 'bitecs';
import { CombatStateComponent, Player } from '../components';
import { CombatState } from '../../combat/states';
import { CombatInput, fsmRegistry } from '../../combat/CombatFSM';
import { detectAttackDirection, detectBlockDirection } from '../../combat/directions';
import type { InputManager, MouseDeltaEntry } from '../../input/InputManager';
import { queueStaminaCost } from './StaminaSystem';
import { weaponConfigs } from '../../weapons/WeaponConfig';

// ── Queries ──────────────────────────────────────────────

const combatQuery = defineQuery([CombatStateComponent]);
const playerQuery = defineQuery([CombatStateComponent, Player]);

// ── Weapon ID → name mapping ─────────────────────────────

const weaponIdToName: string[] = ['Longsword'];

/** Look up weapon config by numeric ID */
function getWeaponConfigById(id: number) {
  const name = weaponIdToName[id];
  return name ? weaponConfigs[name] : undefined;
}

// ── Mouse delta adapter ──────────────────────────────────

/** Convert InputManager's delta buffer to the format expected by direction detection */
function getMouseDeltasForDirection(input: InputManager): {
  dx: number;
  dy: number;
  time: number;
}[] {
  // InputManager exposes getAverageDelta but we need the raw buffer for detection.
  // Use the accumulated frame delta as a single sample for direction detection.
  const delta = input.getMouseDelta();
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return [{ dx: delta.x, dy: delta.y, time: now }];
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

    // Get mouse direction for attack/block detection
    const deltas = getMouseDeltasForDirection(input);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Process player entities (input-driven)
    for (const eid of playerEntities) {
      const fsm = fsmRegistry.get(eid);
      if (!fsm) continue;

      // Attack input (left mouse button press)
      if (leftJustPressed) {
        const attackDir = detectAttackDirection(deltas, now);
        fsm.transition(CombatInput.Attack, attackDir);
      }

      // Block input (right mouse button press)
      if (rightJustPressed) {
        const currentState = fsm.state;
        if (currentState === CombatState.Windup) {
          // Right-click during windup = feint
          fsm.transition(CombatInput.Feint);
        } else {
          const blockDir = detectBlockDirection(deltas, now);
          fsm.transition(CombatInput.Block, undefined, blockDir);
        }
      }

      // Release block (right mouse button released)
      if (rightJustReleased) {
        fsm.transition(CombatInput.ReleaseBlock);
      }
    }

    // Tick all combat entities (including non-player AI/dummies)
    const allCombatEntities = combatQuery(ecsWorld);
    for (const eid of allCombatEntities) {
      const fsm = fsmRegistry.get(eid);
      if (!fsm) continue;

      // Advance FSM timer
      fsm.tick();

      // Sync FSM state to ECS component
      CombatStateComponent.state[eid] = fsm.state;
      CombatStateComponent.ticksRemaining[eid] = fsm.ticksRemaining;
      CombatStateComponent.attackDirection[eid] = fsm.attackDirection;
      CombatStateComponent.blockDirection[eid] = fsm.blockDirection;

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
  };
}
