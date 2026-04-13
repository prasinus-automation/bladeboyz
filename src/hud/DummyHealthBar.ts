import * as THREE from 'three';
import { Health, meshRegistry } from '../ecs/components';
import { activeDummies } from '../ecs/entities/createDummy';

/**
 * DummyHealthBar — renders floating health bars above each dummy's head.
 *
 * Uses 3D→2D projection of the dummy's head position to place HTML overlays.
 */

interface HealthBarEntry {
  container: HTMLDivElement;
  fill: HTMLDivElement;
}

const BAR_WIDTH = 60;
const BAR_HEIGHT = 6;
const HEAD_OFFSET_Y = 2.1; // above character head

export class DummyHealthBar {
  private camera: THREE.PerspectiveCamera;
  private wrapper: HTMLDivElement;
  private bars: Map<number, HealthBarEntry> = new Map();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;

    this.wrapper = document.createElement('div');
    this.wrapper.id = 'dummy-healthbar-container';
    this.wrapper.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:15;overflow:hidden;';
    document.body.appendChild(this.wrapper);
  }

  private getOrCreateBar(eid: number): HealthBarEntry {
    let entry = this.bars.get(eid);
    if (entry) return entry;

    const container = document.createElement('div');
    container.style.cssText =
      `position:absolute;width:${BAR_WIDTH}px;height:${BAR_HEIGHT}px;` +
      'background:rgba(0,0,0,0.6);border:1px solid #666;pointer-events:none;';

    const fill = document.createElement('div');
    fill.style.cssText =
      `width:100%;height:100%;background:#e33;transition:width 0.15s ease;`;
    container.appendChild(fill);

    this.wrapper.appendChild(container);
    entry = { container, fill };
    this.bars.set(eid, entry);
    return entry;
  }

  /**
   * Update health bar positions and fill. Call each render frame.
   */
  update(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const proj = new THREE.Vector3();

    // Remove bars for dummies that no longer exist
    for (const [eid, entry] of this.bars) {
      if (!activeDummies.includes(eid)) {
        entry.container.remove();
        this.bars.delete(eid);
      }
    }

    for (const eid of activeDummies) {
      const bar = this.getOrCreateBar(eid);
      const modelData = meshRegistry.get(eid);
      if (!modelData) {
        bar.container.style.display = 'none';
        continue;
      }

      // Get world position above the dummy's head
      proj.setFromMatrixPosition(modelData.group.matrixWorld);
      proj.y += HEAD_OFFSET_Y;
      proj.project(this.camera);

      if (proj.z > 1) {
        bar.container.style.display = 'none';
        continue;
      }

      bar.container.style.display = '';
      const screenX = (proj.x * 0.5 + 0.5) * width - BAR_WIDTH / 2;
      const screenY = (-proj.y * 0.5 + 0.5) * height;

      bar.container.style.left = `${screenX}px`;
      bar.container.style.top = `${screenY}px`;

      // Update fill
      const hp = Health.current[eid];
      const maxHp = Health.max[eid] || 100;
      const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
      bar.fill.style.width = `${pct}%`;

      // Color: green > yellow > red
      if (pct > 60) bar.fill.style.background = '#4e4';
      else if (pct > 30) bar.fill.style.background = '#ee4';
      else bar.fill.style.background = '#e33';
    }
  }

  dispose(): void {
    this.wrapper.remove();
  }
}
