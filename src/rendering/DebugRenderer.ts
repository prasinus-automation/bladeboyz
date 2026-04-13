import * as THREE from 'three';
import {
  toggleHitboxDebug,
  updateHitboxDebug,
  isHitboxDebugVisible,
} from '../ecs/systems/HitboxSystem';
import { CombatStateComponent, Health, Stamina, Position, meshRegistry } from '../ecs/components';
import { activeDummies } from '../ecs/entities/createDummy';
import { showNotification } from '../hud/DebugNotification';
import type { GameWorld } from '../core/types';

/** Runtime string labels for CombatState values (const enum can't be iterated) */
const COMBAT_STATE_NAMES: Record<number, string> = {
  0: 'Idle',
  1: 'Windup',
  2: 'Release',
  3: 'Recovery',
  4: 'Block',
  5: 'ParryWindow',
  6: 'Riposte',
  7: 'Feint',
  8: 'Clash',
  9: 'Stunned',
  10: 'HitStun',
};

/**
 * DebugRenderer — manages all debug visualization toggles.
 *
 * F1: Wireframe rendering on all meshes
 * F2: Rapier physics debug lines
 * F3: Hitbox wireframes (from HitboxSystem)
 * F4: FSM state overlay per entity
 */
export class DebugRenderer {
  private _world: GameWorld;

  // F1 — wireframe
  private _wireframe = false;

  // F2 — Rapier debug lines
  private _physicsDebug = false;
  private _physicsLineSegments: THREE.LineSegments | null = null;

  // F4 — FSM overlay
  private _fsmOverlay = false;
  private _fsmContainer: HTMLDivElement | null = null;

  constructor(world: GameWorld) {
    this._world = world;
    window.addEventListener('keydown', this._onKeyDown);
  }

  /** Call each render frame to update all debug visuals. */
  update(): void {
    // F2: Rapier debug rendering
    if (this._physicsDebug) {
      this._updatePhysicsDebug();
    }

    // F3: Hitbox wireframes
    if (isHitboxDebugVisible()) {
      updateHitboxDebug(this._world);
    }

    // F4: FSM overlays
    if (this._fsmOverlay) {
      this._updateFsmOverlay();
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this._onKeyDown);
    this._cleanupPhysicsDebug();
    this._cleanupFsmOverlay();
  }

  /* ─── F1: Wireframe ─── */

  private _toggleWireframe(): void {
    this._wireframe = !this._wireframe;
    this._world.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if ('wireframe' in mat) {
            (mat as THREE.MeshStandardMaterial).wireframe = this._wireframe;
          }
        }
      }
    });
    showNotification(`Wireframe: ${this._wireframe ? 'ON' : 'OFF'}`);
  }

  /* ─── F2: Rapier physics debug ─── */

  private _togglePhysicsDebug(): void {
    this._physicsDebug = !this._physicsDebug;
    if (!this._physicsDebug) {
      this._cleanupPhysicsDebug();
    }
    showNotification(`Physics Debug: ${this._physicsDebug ? 'ON' : 'OFF'}`);
  }

  private _updatePhysicsDebug(): void {
    const { vertices, colors } = this._world.physicsWorld.debugRender();

    if (!this._physicsLineSegments) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      geometry.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(colors, 4),
      );
      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        depthTest: false,
        transparent: true,
      });
      this._physicsLineSegments = new THREE.LineSegments(geometry, material);
      this._physicsLineSegments.frustumCulled = false;
      this._physicsLineSegments.renderOrder = 998;
      this._world.scene.add(this._physicsLineSegments);
    } else {
      const geo = this._physicsLineSegments.geometry;
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      geo.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(colors, 4),
      );
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    }
  }

  private _cleanupPhysicsDebug(): void {
    if (this._physicsLineSegments) {
      this._world.scene.remove(this._physicsLineSegments);
      this._physicsLineSegments.geometry.dispose();
      (this._physicsLineSegments.material as THREE.Material).dispose();
      this._physicsLineSegments = null;
    }
  }

  /* ─── F4: FSM overlay ─── */

  private _toggleFsmOverlay(): void {
    this._fsmOverlay = !this._fsmOverlay;
    if (!this._fsmOverlay) {
      this._cleanupFsmOverlay();
    }
    showNotification(`FSM Overlay: ${this._fsmOverlay ? 'ON' : 'OFF'}`);
  }

  private _ensureFsmContainer(): HTMLDivElement {
    if (!this._fsmContainer) {
      this._fsmContainer = document.createElement('div');
      this._fsmContainer.id = 'fsm-overlay-container';
      this._fsmContainer.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:18;overflow:hidden;';
      document.body.appendChild(this._fsmContainer);
    }
    return this._fsmContainer;
  }

  private _fsmLabels: Map<number, HTMLDivElement> = new Map();

  private _updateFsmOverlay(): void {
    const container = this._ensureFsmContainer();
    const camera = this._world.camera;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const proj = new THREE.Vector3();

    // Also show player FSM if they have CombatStateComponent
    const allEntities = [...activeDummies];
    if (this._world.playerEntity >= 0) {
      allEntities.push(this._world.playerEntity);
    }

    // Remove stale labels
    for (const [eid, label] of this._fsmLabels) {
      if (!allEntities.includes(eid)) {
        label.remove();
        this._fsmLabels.delete(eid);
      }
    }

    for (const eid of allEntities) {
      const modelData = meshRegistry.get(eid);

      let label = this._fsmLabels.get(eid);
      if (!label) {
        label = document.createElement('div');
        label.style.cssText =
          'position:absolute;color:#0ff;font-family:monospace;font-size:11px;' +
          'text-shadow:0 0 3px #000;white-space:nowrap;pointer-events:none;';
        container.appendChild(label);
        this._fsmLabels.set(eid, label);
      }

      // Position above entity
      if (modelData) {
        proj.setFromMatrixPosition(modelData.group.matrixWorld);
      } else {
        // Fallback: use Position component directly
        proj.set(Position.x[eid], Position.y[eid], Position.z[eid]);
      }
      proj.y += 2.4;
      proj.project(camera);

      if (proj.z > 1) {
        label.style.display = 'none';
        continue;
      }
      label.style.display = '';

      const screenX = (proj.x * 0.5 + 0.5) * width;
      const screenY = (-proj.y * 0.5 + 0.5) * height;
      label.style.left = `${screenX}px`;
      label.style.top = `${screenY}px`;

      const state = CombatStateComponent.state[eid];
      const stateName = COMBAT_STATE_NAMES[state] ?? `State(${state})`;
      const hp = Health.current[eid]?.toFixed(0) ?? '?';
      const sta = Stamina.current[eid]?.toFixed(0) ?? '?';
      const ticks = CombatStateComponent.ticksRemaining[eid] ?? 0;

      label.textContent = `[${stateName}] HP:${hp} STA:${sta} T:${ticks}`;
    }
  }

  private _cleanupFsmOverlay(): void {
    for (const [, label] of this._fsmLabels) {
      label.remove();
    }
    this._fsmLabels.clear();
    if (this._fsmContainer) {
      this._fsmContainer.remove();
      this._fsmContainer = null;
    }
  }

  /* ─── Key handler ─── */

  private _onKeyDown = (e: KeyboardEvent): void => {
    // Only intercept F-keys when game has focus / pointer lock
    // (don't block browser defaults when not in game)
    switch (e.code) {
      case 'F1':
        e.preventDefault();
        this._toggleWireframe();
        break;
      case 'F2':
        e.preventDefault();
        this._togglePhysicsDebug();
        break;
      case 'F3':
        e.preventDefault();
        toggleHitboxDebug(this._world);
        showNotification(`Hitboxes: ${isHitboxDebugVisible() ? 'ON' : 'OFF'}`);
        break;
      case 'F4':
        e.preventDefault();
        this._toggleFsmOverlay();
        break;
      // F5 is handled by CameraController
    }
  };
}
