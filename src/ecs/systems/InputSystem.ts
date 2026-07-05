import { defineQuery } from 'bitecs';
import { Player, MovementIntent } from '../components';
import type { InputManager } from '../../input/InputManager';
import type { CameraController } from '../../rendering/CameraController';
import type { GameWorld } from '../../core/types';

const playerIntentQuery = defineQuery([Player, MovementIntent]);

/**
 * Reset module-level state. Used by tests to ensure clean isolation.
 * Jump edge detection moved into InputManager's latched-edge sets
 * (`consumeKeyPress`), so there is no module state left to reset — kept
 * because test setups call it and future module state may return.
 */
export function resetInputState(): void {}

/**
 * InputSystem — translates raw `InputManager` queries into `MovementIntent`
 * for each `Player` entity each fixed tick. This is the seam where future
 * AI controllers and network input deserializers will plug in (they write
 * `MovementIntent` directly without any keyboard).
 *
 * Contract:
 * - `moveX`/`moveZ` are world-space normalized direction (length 0 or 1),
 *   already rotated by camera yaw. Forward = -Z (Three.js convention).
 * - `sprint` is policy-gated: only 1 when Shift is held AND the user is
 *   pressing forward AND not also crouching. Sprint-while-strafing or
 *   sprint-backwards is forbidden by design.
 * - `crouch` mirrors the raw Ctrl key state.
 * - `jumpRequested` is edge-triggered: 1 only on the rising edge of Space.
 *   MovementSystem clears it back to 0 after consumption.
 *
 * Tick contract: must run BEFORE MovementSystem, AFTER any system that
 * updates the camera yaw.
 */
export function createInputSystem(
  world: GameWorld,
  input: InputManager,
  cameraController: CameraController,
): (dt: number) => void {
  return function inputSystem(_dt: number): void {
    const entities = playerIntentQuery(world.ecs);

    // Read raw key state once
    const wKey = input.isKeyDown('KeyW');
    const sKey = input.isKeyDown('KeyS');
    const aKey = input.isKeyDown('KeyA');
    const dKey = input.isKeyDown('KeyD');
    const wantSprint = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight');
    const wantCrouch = input.isKeyDown('ControlLeft') || input.isKeyDown('ControlRight');
    // Latched edge: fires once per physical press, even if Space went
    // down+up entirely between two ticks (state polling dropped those).
    const jumpPressed = input.consumeKeyPress('Space');

    const forward = (wKey ? 1 : 0) - (sKey ? 1 : 0);
    const strafe = (dKey ? 1 : 0) - (aKey ? 1 : 0);

    const yaw = cameraController.getYaw();
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    let moveX = 0;
    let moveZ = 0;

    if (forward !== 0 || strafe !== 0) {
      // Forward = -Z in Three.js. Yaw=0 looks down -Z.
      moveX = strafe * cosYaw - forward * sinYaw;
      moveZ = -strafe * sinYaw - forward * cosYaw;

      // Normalize so diagonals don't run faster than cardinals.
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (len > 0) {
        moveX /= len;
        moveZ /= len;
      }
    }

    const sprintGated =
      wantSprint && !wantCrouch && forward > 0 ? 1 : 0;
    const crouchFlag = wantCrouch ? 1 : 0;
    const jumpEdge = jumpPressed ? 1 : 0;

    for (let i = 0; i < entities.length; i++) {
      const eid = entities[i];
      MovementIntent.moveX[eid] = moveX;
      MovementIntent.moveZ[eid] = moveZ;
      MovementIntent.sprint[eid] = sprintGated;
      MovementIntent.crouch[eid] = crouchFlag;
      MovementIntent.jumpRequested[eid] = jumpEdge;
    }
  };
}
