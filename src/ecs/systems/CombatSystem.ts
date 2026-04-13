import { defineQuery, type IWorld } from 'bitecs';
import { CombatState } from '../components';
import { CombatFSM } from '../../combat/CombatFSM';
import { CombatInput } from '../../combat/states';
import type { InputManager } from '../../input/InputManager';

/**
 * Map of entity ID → CombatFSM instance.
 * bitECS can't store object references in components, so we use a side map.
 */
export const combatFSMs = new Map<number, CombatFSM>();

/** Query for entities with CombatState component */
const combatQuery = defineQuery([CombatState]);

/**
 * ECS system that drives combat FSM logic.
 * Runs in fixedUpdate() only — all timing is tick-based.
 *
 * Reads input state and calls FSM transitions, then syncs
 * FSM state back to the CombatState ECS component.
 */
export function CombatSystem(world: IWorld, input: InputManager): void {
  const entities = combatQuery(world);

  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    const fsm = combatFSMs.get(eid);
    if (!fsm) continue;

    // --- Process input-driven transitions ---
    // Only process input for player entity (entity 0 by convention for now)
    // TODO: AI entities will have their own input source
    if (eid === 0) {
      processPlayerInput(fsm, input);
    }

    // --- Tick the FSM (decrement timers, auto-transition) ---
    fsm.tick();

    // --- Sync FSM state back to ECS component ---
    CombatState.state[eid] = fsm.getCurrentState();
    CombatState.ticksRemaining[eid] = fsm.getTicksRemaining();
    CombatState.attackDirection[eid] = fsm.getAttackDirection();
    CombatState.turncap[eid] = fsm.getCurrentTurncap();
  }
}

/**
 * Translate raw input into FSM transitions for the player entity.
 */
function processPlayerInput(fsm: CombatFSM, input: InputManager): void {
  // Attack (LMB press)
  if (input.attackPressed) {
    const dir = input.getAttackDirection();
    fsm.transition(CombatInput.AttackStart, dir);
  }

  // Block (RMB press → start, release → end)
  if (input.blockPressed) {
    // If in Windup, RMB = feint
    if (fsm.canTransition(CombatInput.FeintInput)) {
      fsm.transition(CombatInput.FeintInput);
    } else {
      fsm.transition(CombatInput.BlockStart);
    }
  }

  if (input.blockReleased) {
    fsm.transition(CombatInput.BlockEnd);
  }
}
