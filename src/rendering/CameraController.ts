import * as THREE from 'three';
import { Position, PreviousPosition, Rotation, PreviousRotation, MovementState } from '../ecs/components';
import { InputManager } from '../input/InputManager';
import {
  MOUSE_SENSITIVITY,
  MAX_PITCH,
  EYE_HEIGHT,
  CROUCH_EYE_HEIGHT,
  THIRD_PERSON_DISTANCE,
  THIRD_PERSON_MIN_DISTANCE,
  THIRD_PERSON_MAX_DISTANCE,
} from '../core/types';
import { showNotification } from '../hud/DebugNotification';
import type { ViewmodelRenderer } from './ViewmodelRenderer';

export const enum CameraMode {
  FirstPerson = 0,
  ThirdPerson = 1,
}

/**
 * CameraController — manages FPS and debug third-person camera.
 *
 * In first-person: camera is at player's eye-height, mouse controls pitch/yaw.
 * In third-person: camera orbits around player, mouse controls orbit, scroll zooms.
 *
 * Camera structured for future turncap integration via maxTurnRate multiplier.
 */
// Reusable temp vector to avoid per-frame allocations in third-person mode
const _tempTarget = new THREE.Vector3();

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private input: InputManager;

  // Camera state
  private yaw = 0;   // radians, around world Y
  private pitch = 0;  // radians, up/down

  // Camera mode
  private mode: CameraMode = CameraMode.FirstPerson;
  private orbitDistance = THIRD_PERSON_DISTANCE;

  // Turn rate limiter (defaults to Infinity = uncapped)
  public maxTurnRate = Infinity;

  // Sensitivity
  public sensitivity = MOUSE_SENSITIVITY;

  // Player mesh reference (to toggle visibility)
  private playerMesh: THREE.Object3D | null = null;

  // Viewmodel renderer reference (to toggle visibility and sync camera)
  private viewmodel: ViewmodelRenderer | null = null;

  constructor(camera: THREE.PerspectiveCamera, input: InputManager) {
    this.camera = camera;
    this.input = input;

    // Listen for F5 toggle
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'F5') {
        e.preventDefault();
        this.toggleMode();
      }
    });
  }

  /** Set the player mesh for first/third person visibility toggling */
  setPlayerMesh(mesh: THREE.Object3D): void {
    this.playerMesh = mesh;
    this.updateMeshVisibility();
  }

  /** Set the viewmodel renderer for FPS/third-person visibility toggling */
  setViewmodel(viewmodel: ViewmodelRenderer): void {
    this.viewmodel = viewmodel;
    this.updateMeshVisibility();
  }

  /** Get current yaw (for movement direction) */
  getYaw(): number {
    return this.yaw;
  }

  /** Get current pitch */
  getPitch(): number {
    return this.pitch;
  }

  /** Get current camera mode */
  getMode(): CameraMode {
    return this.mode;
  }

  /** Toggle between first-person and third-person */
  toggleMode(): void {
    this.mode = this.mode === CameraMode.FirstPerson
      ? CameraMode.ThirdPerson
      : CameraMode.FirstPerson;
    this.updateMeshVisibility();

    // Update HUD indicator
    const indicator = document.getElementById('camera-mode-indicator');
    if (indicator) {
      indicator.textContent = this.mode === CameraMode.FirstPerson ? 'FPS' : '3RD';
    }
    showNotification(`Camera: ${this.mode === CameraMode.FirstPerson ? 'First Person' : 'Third Person'}`);
  }

  private updateMeshVisibility(): void {
    if (this.playerMesh) {
      this.playerMesh.visible = this.mode === CameraMode.ThirdPerson;
    }
    if (this.viewmodel) {
      this.viewmodel.visible = this.mode === CameraMode.FirstPerson;
    }
  }

  /**
   * Process mouse input and update camera angles.
   * Called once per frame (onFrameStart) before the fixedUpdate loop,
   * so mouse delta is consumed exactly once and yaw is available for movement.
   */
  processInput(): void {
    if (!this.input.isPointerLocked) return;

    const delta = this.input.getMouseDelta();

    // Apply sensitivity with maxTurnRate capping
    let deltaYaw = -delta.x * this.sensitivity;
    let deltaPitch = -delta.y * this.sensitivity;

    // Cap turn rate if configured
    if (isFinite(this.maxTurnRate)) {
      const maxDelta = this.maxTurnRate * (1 / 60); // per tick
      deltaYaw = Math.max(-maxDelta, Math.min(maxDelta, deltaYaw));
      deltaPitch = Math.max(-maxDelta, Math.min(maxDelta, deltaPitch));
    }

    this.yaw += deltaYaw;
    this.pitch += deltaPitch;

    // Clamp pitch to ~89 degrees
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));

    // Handle scroll wheel for third-person zoom
    if (this.mode === CameraMode.ThirdPerson) {
      const scroll = this.input.getScrollDelta();
      if (scroll !== 0) {
        this.orbitDistance += scroll * 0.01;
        this.orbitDistance = Math.max(
          THIRD_PERSON_MIN_DISTANCE,
          Math.min(THIRD_PERSON_MAX_DISTANCE, this.orbitDistance),
        );
      }
    }
  }

  /**
   * Update camera transform from player entity position.
   * Called during render() with interpolation alpha.
   */
  updateCamera(playerEntity: number, alpha: number): void {
    // Interpolate position
    const prevX = PreviousPosition.x[playerEntity];
    const prevY = PreviousPosition.y[playerEntity];
    const prevZ = PreviousPosition.z[playerEntity];
    const currX = Position.x[playerEntity];
    const currY = Position.y[playerEntity];
    const currZ = Position.z[playerEntity];

    const x = prevX + (currX - prevX) * alpha;
    const y = prevY + (currY - prevY) * alpha;
    const z = prevZ + (currZ - prevZ) * alpha;

    // Determine eye height based on crouch state
    const isCrouching = MovementState.crouching[playerEntity] === 1;
    const eyeHeight = isCrouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;

    if (this.mode === CameraMode.FirstPerson) {
      // Position camera at player eye level
      this.camera.position.set(x, y + eyeHeight, z);

      // Set camera rotation from pitch and yaw
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    } else {
      // Third-person: orbit camera around player
      _tempTarget.set(x, y + eyeHeight * 0.8, z);

      // Calculate orbit position
      const offsetX = Math.sin(this.yaw) * Math.cos(this.pitch) * this.orbitDistance;
      const offsetY = Math.sin(this.pitch) * this.orbitDistance;
      const offsetZ = Math.cos(this.yaw) * Math.cos(this.pitch) * this.orbitDistance;

      this.camera.position.set(
        _tempTarget.x + offsetX,
        _tempTarget.y + offsetY,
        _tempTarget.z + offsetZ,
      );
      this.camera.lookAt(_tempTarget);
    }
  }
}
