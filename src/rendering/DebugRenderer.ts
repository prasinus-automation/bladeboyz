import {
  toggleHitboxDebug,
  updateHitboxDebug,
  isHitboxDebugVisible,
} from '../ecs/systems/HitboxSystem';
import type { GameWorld } from '../core/types';

/**
 * Debug renderer — handles F3 toggle for hitbox wireframes.
 */
export class DebugRenderer {
  private _world: GameWorld;

  constructor(world: GameWorld) {
    this._world = world;

    window.addEventListener('keydown', this._onKeyDown);
  }

  /** Call each render frame to update debug visuals. */
  update(): void {
    if (isHitboxDebugVisible()) {
      updateHitboxDebug(this._world);
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this._onKeyDown);
  }

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F3') {
      e.preventDefault();
      toggleHitboxDebug(this._world);
    }
  };
}
