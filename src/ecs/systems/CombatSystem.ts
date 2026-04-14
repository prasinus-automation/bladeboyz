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
import { CombatStateComponent, CombatStateComp, Player } from '../components';
import { CombatState } from '../../combat/states';
import { CombatInput, fsmRegistry, type CombatFSM } from '../../combat/CombatFSM';
import { detectAttackDirection, detectBlockDirection } from '../../combat/directions';
import type { InputManager, MouseDeltaEntry } from '../../input/InputManager';
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

// ── Phase total computation ─────────────────────────────

/**
 * Compute the total ticks for the current FSM phase from the weapon config.
 * Returns 0 for states without a fixed duration (Idle, Block).
 */
export function computePhaseTotal(state: CombatState, fsm: CombatFSM): number {
  const config = fsm.weaponConfig;
  const atkDir = fsm.attackDirection;
  switch (state) {
    case CombatState.Windup:
      return config.windup[atkDir];
    case CombatState.Release:
    case CombatState.Riposte:
      return config.release[atkDir];
    case CombatState.Recovery:
      // Could be normal or combo recovery — use the larger as an approximation
      // since FSM doesn't expose _isComboRecovery. We can derive it:
      // if ticksRemaining <= comboRecovery ticks, it's a combo recovery.
      return fsm.ticksRemaining <= config.comboRecovery[atkDir]
        ? config.comboRecovery[atkDir]
        : config.recovery[atkDir];
    case CombatState.Feint:
      return 3; // Feint always has 3-tick duration (see CombatFSM._handleFeint)
    case CombatState.ParryWindow:
      return config.parryWindow;
    case CombatState.HitStun:
      return config.hitStunTicks;
    case CombatState.Stunned:
      return config.parryStunTicks;
    default:
      return 0; // Idle, Block — no fixed phase duration
  }
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

      // Sync CombatStateComp (read by AnimationSystem)
      CombatStateComp.state[eid] = fsm.state;
      // Direction: use attackDirection for attack states, blockDirection for block states
      const currentState = fsm.state;
      if (
        currentState === CombatState.Block ||
        currentState === CombatState.ParryWindow
      ) {
        CombatStateComp.direction[eid] = fsm.blockDirection;
      } else {
        CombatStateComp.direction[eid] = fsm.attackDirection;
      }
      // Compute phaseTotal and phaseElapsed from FSM + weapon config
      const phaseTotal = computePhaseTotal(fsm.state, fsm);
      CombatStateComp.phaseTotal[eid] = phaseTotal;
      CombatStateComp.phaseElapsed[eid] =
        phaseTotal > 0 ? phaseTotal - fsm.ticksRemaining : 0;
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
  };
}
