import { Position, Velocity, MovementState } from '../ecs/components';
import { CameraController, CameraMode } from '../rendering/CameraController';

/**
 * Simple debug overlay showing FPS, player position, movement state.
 */
export class DebugOverlay {
  private el: HTMLElement;
  private frameCount = 0;
  private fpsTimer = 0;
  private fps = 0;

  constructor() {
    this.el = document.getElementById('debug-overlay') || document.createElement('div');
  }

  update(dt: number, playerEntity: number, cameraController: CameraController): void {
    this.frameCount++;
    this.fpsTimer += dt;

    if (this.fpsTimer >= 1.0) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTimer -= 1.0;
    }

    const x = Position.x[playerEntity]?.toFixed(1) ?? '?';
    const y = Position.y[playerEntity]?.toFixed(1) ?? '?';
    const z = Position.z[playerEntity]?.toFixed(1) ?? '?';
    const vy = Velocity.y[playerEntity]?.toFixed(1) ?? '?';
    const grounded = MovementState.grounded[playerEntity] === 1 ? 'YES' : 'NO';
    const sprinting = MovementState.sprinting[playerEntity] === 1 ? 'YES' : 'NO';
    const crouching = MovementState.crouching[playerEntity] === 1 ? 'YES' : 'NO';
    const mode = cameraController.getMode() === CameraMode.FirstPerson ? 'FPS' : '3RD';

    this.el.textContent =
      `FPS: ${this.fps}\n` +
      `Pos: ${x}, ${y}, ${z}\n` +
      `VelY: ${vy}\n` +
      `Ground: ${grounded}\n` +
      `Sprint: ${sprinting}\n` +
      `Crouch: ${crouching}\n` +
      `Camera: ${mode}`;
  }
}
