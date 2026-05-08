/**
 * WorldLabel — world-anchored HTML overlays for shopkeep labels.
 *
 * Two label types per shopkeep:
 *   1. Persistent nameplate floating above the head (always visible)
 *   2. Conditional "Press [E] to shop" prompt (only when player is in range)
 *
 * Implementation pattern is borrowed from `DummyHealthBar.ts`:
 *   - Project a 3D world point through camera.project() to NDC
 *   - Translate the NDC coords to pixel coords for `style.transform`
 *   - Hide when proj.z > 1 (point is behind the camera)
 *
 * Updates happen in the render loop (NOT fixedUpdate) — same cadence as
 * `dummyHealthBar.update()`.
 */

import * as THREE from 'three';
import { Position } from '../ecs/components';
import { shopkeepRegistry } from '../ecs/entities/createShopkeep';

const NAMEPLATE_OFFSET_Y = 1.6; // meters above shopkeep feet
const PROMPT_OFFSET_Y = 1.2; // slightly below the nameplate

interface LabelEntry {
  shopkeepEid: number;
  nameplate: HTMLDivElement;
  prompt: HTMLDivElement;
}

export class WorldLabel {
  private camera: THREE.PerspectiveCamera;
  private wrapper: HTMLDivElement;
  private entries: Map<number, LabelEntry> = new Map();

  /** Reusable Vector3 to avoid per-frame allocation. */
  private _v = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;

    this.wrapper = document.createElement('div');
    this.wrapper.id = 'world-label-container';
    this.wrapper.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:14;overflow:hidden;';
    document.body.appendChild(this.wrapper);
  }

  private getOrCreateEntry(eid: number): LabelEntry {
    let entry = this.entries.get(eid);
    if (entry) return entry;

    const nameplate = document.createElement('div');
    nameplate.className = 'world-label-nameplate';
    nameplate.style.cssText =
      'position:absolute;color:#ffe066;font-family:monospace;font-size:13px;' +
      'text-shadow:1px 1px 2px rgba(0,0,0,0.9);white-space:nowrap;' +
      'transform:translate(-50%,-100%);pointer-events:none;';
    this.wrapper.appendChild(nameplate);

    const prompt = document.createElement('div');
    prompt.className = 'world-label-prompt';
    prompt.style.cssText =
      'position:absolute;color:#fff;font-family:monospace;font-size:12px;' +
      'background:rgba(0,0,0,0.65);padding:3px 8px;border:1px solid #888;border-radius:3px;' +
      'text-shadow:none;white-space:nowrap;' +
      'transform:translate(-50%,-100%);pointer-events:none;display:none;';
    this.wrapper.appendChild(prompt);

    entry = { shopkeepEid: eid, nameplate, prompt };
    this.entries.set(eid, entry);
    return entry;
  }

  /**
   * Update label positions and visibility. Call once per render frame.
   *
   * @param nearbyInteractableEid - The shopkeep ID currently in range, or null.
   *   When non-null, that shopkeep's prompt is shown; all others are hidden.
   */
  update(nearbyInteractableEid: number | null): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Remove labels for shopkeeps that no longer exist
    for (const [eid, entry] of this.entries) {
      if (!shopkeepRegistry.has(eid)) {
        entry.nameplate.remove();
        entry.prompt.remove();
        this.entries.delete(eid);
      }
    }

    for (const [eid, data] of shopkeepRegistry) {
      const entry = this.getOrCreateEntry(eid);

      // Set nameplate text once (or whenever it changes)
      if (entry.nameplate.textContent !== data.name) {
        entry.nameplate.textContent = data.name;
      }
      const promptText = 'Press [E] to shop';
      if (entry.prompt.textContent !== promptText) {
        entry.prompt.textContent = promptText;
      }

      // ─── Nameplate position (head height) ───
      this._v.set(Position.x[eid], Position.y[eid] + NAMEPLATE_OFFSET_Y, Position.z[eid]);
      this._v.project(this.camera);

      if (this._v.z > 1) {
        // Behind camera — hide both labels
        entry.nameplate.style.display = 'none';
        entry.prompt.style.display = 'none';
        continue;
      }

      const nameScreenX = (this._v.x * 0.5 + 0.5) * width;
      const nameScreenY = (-this._v.y * 0.5 + 0.5) * height;
      entry.nameplate.style.display = '';
      entry.nameplate.style.left = `${nameScreenX}px`;
      entry.nameplate.style.top = `${nameScreenY}px`;

      // ─── Prompt position (slightly below nameplate, only if in range) ───
      const showPrompt = nearbyInteractableEid === eid;
      if (!showPrompt) {
        entry.prompt.style.display = 'none';
        continue;
      }

      this._v.set(Position.x[eid], Position.y[eid] + PROMPT_OFFSET_Y, Position.z[eid]);
      this._v.project(this.camera);
      if (this._v.z > 1) {
        entry.prompt.style.display = 'none';
        continue;
      }
      const promptScreenX = (this._v.x * 0.5 + 0.5) * width;
      const promptScreenY = (-this._v.y * 0.5 + 0.5) * height;
      entry.prompt.style.display = '';
      entry.prompt.style.left = `${promptScreenX}px`;
      entry.prompt.style.top = `${promptScreenY}px`;
    }
  }

  dispose(): void {
    this.wrapper.remove();
    this.entries.clear();
  }
}
