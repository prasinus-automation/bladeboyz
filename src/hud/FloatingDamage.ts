import * as THREE from 'three';

/**
 * FloatingDamage — spawns floating damage number <div>s that rise and fade.
 *
 * Uses 3D→2D projection to position HTML overlays at the hit location.
 * Each number rises ~60px over ~1 second, then is removed from the DOM.
 */

interface DamageNumber {
  el: HTMLDivElement;
  startTime: number;
  worldPos: THREE.Vector3;
}

const DURATION_MS = 1000;
const RISE_PX = 60;

export class FloatingDamage {
  private container: HTMLDivElement;
  private active: DamageNumber[] = [];
  private camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;

    this.container = document.createElement('div');
    this.container.id = 'floating-damage-container';
    this.container.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20;overflow:hidden;';
    document.body.appendChild(this.container);
  }

  /**
   * Spawn a floating damage number at a world position.
   * @param damage  Numeric damage amount
   * @param region  Body region name (e.g. "HEAD", "TORSO")
   * @param worldPos World-space position to project from
   */
  spawn(damage: number, region: string, worldPos: THREE.Vector3): void {
    const el = document.createElement('div');
    el.textContent = `${Math.round(damage)} ${region}`;
    el.style.cssText =
      'position:absolute;color:#ff4444;font-family:monospace;font-weight:bold;' +
      'font-size:16px;text-shadow:0 0 4px #000,0 0 2px #000;white-space:nowrap;' +
      'pointer-events:none;transition:none;';

    this.container.appendChild(el);
    this.active.push({
      el,
      startTime: performance.now(),
      worldPos: worldPos.clone(),
    });
  }

  /**
   * Update positions and fade. Call each render frame.
   */
  update(): void {
    const now = performance.now();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const proj = new THREE.Vector3();

    for (let i = this.active.length - 1; i >= 0; i--) {
      const dn = this.active[i];
      const elapsed = now - dn.startTime;

      if (elapsed >= DURATION_MS) {
        dn.el.remove();
        this.active.splice(i, 1);
        continue;
      }

      const t = elapsed / DURATION_MS;

      // Project 3D position to screen
      proj.copy(dn.worldPos);
      proj.project(this.camera);

      // Behind camera — hide
      if (proj.z > 1) {
        dn.el.style.display = 'none';
        continue;
      }
      dn.el.style.display = '';

      const screenX = (proj.x * 0.5 + 0.5) * width;
      const screenY = (-proj.y * 0.5 + 0.5) * height - t * RISE_PX;

      dn.el.style.left = `${screenX}px`;
      dn.el.style.top = `${screenY}px`;
      dn.el.style.opacity = `${1 - t}`;
    }
  }

  dispose(): void {
    this.container.remove();
  }
}
