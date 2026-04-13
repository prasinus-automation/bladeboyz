import * as THREE from 'three';
import { debugTracerSegments } from '../ecs/systems/TracerSystem';

/**
 * TracerDebugRenderer — renders tracer paths as colored lines in the scene.
 *
 * Toggle with F5 key. Shows:
 * - Tracer sweep lines during Release phase
 * - Lines persist for ~0.5s after swing ends for visual feedback
 * - Color fades from bright to dim as segments age
 */
export class TracerDebugRenderer {
  private scene: THREE.Scene;
  private lineGroup: THREE.Group;
  private visible = false;
  private geometry: THREE.BufferGeometry;
  private material: THREE.LineBasicMaterial;
  private lineSegments: THREE.LineSegments;

  /** Maximum number of line segment pairs to render */
  private static readonly MAX_SEGMENTS = 512;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.lineGroup = new THREE.Group();
    this.lineGroup.name = 'TracerDebugLines';
    this.lineGroup.visible = false;

    // Pre-allocate buffer geometry for line segments
    const positions = new Float32Array(TracerDebugRenderer.MAX_SEGMENTS * 2 * 3);
    const colors = new Float32Array(TracerDebugRenderer.MAX_SEGMENTS * 2 * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    });

    this.lineSegments = new THREE.LineSegments(this.geometry, this.material);
    this.lineSegments.frustumCulled = false;
    this.lineSegments.renderOrder = 999;
    this.lineGroup.add(this.lineSegments);

    this.scene.add(this.lineGroup);

    // Toggle key listener
    window.addEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // F6 for tracer debug (F5 is camera toggle)
    if (e.code === 'F6') {
      e.preventDefault();
      this.toggle();
    }
  };

  /** Programmatically toggle tracer debug visibility */
  toggle(): void {
    this.visible = !this.visible;
    this.lineGroup.visible = this.visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Update the debug line geometry from the tracer segment ring buffer.
   * Call once per render frame.
   */
  update(): void {
    if (!this.visible) return;

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const colors = colorAttr.array as Float32Array;

    const count = Math.min(
      debugTracerSegments.length,
      TracerDebugRenderer.MAX_SEGMENTS,
    );

    for (let i = 0; i < count; i++) {
      const seg = debugTracerSegments[i];
      const baseIdx = i * 6; // 2 vertices * 3 components

      // Positions
      positions[baseIdx] = seg.from.x;
      positions[baseIdx + 1] = seg.from.y;
      positions[baseIdx + 2] = seg.from.z;
      positions[baseIdx + 3] = seg.to.x;
      positions[baseIdx + 4] = seg.to.y;
      positions[baseIdx + 5] = seg.to.z;

      // Color: bright red fading to dark red as segment ages
      // Newer segments are brighter
      const age = debugTracerSegments.length > 0
        ? 1.0 - (i / debugTracerSegments.length) * 0.6
        : 1.0;

      colors[baseIdx] = age;       // R
      colors[baseIdx + 1] = 0.2 * age;  // G
      colors[baseIdx + 2] = 0.1 * age;  // B
      colors[baseIdx + 3] = age;
      colors[baseIdx + 4] = 0.2 * age;
      colors[baseIdx + 5] = 0.1 * age;
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, count * 2);
  }

  /** Clean disposal */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.lineGroup);
  }
}
