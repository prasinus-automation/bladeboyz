/**
 * ViewmodelDebugOverlay — bottom-left HTML diagnostic readout for the
 * `--debug-viewmodel` toggle (issue #122, parent #90).
 *
 * Mirrors `DebugOverlay.ts`'s style: monospace, fixed-position div, plain
 * `textContent` writes (no DOM diffing). Pre-formatted (`white-space: pre`)
 * so multi-line numeric blocks don't visually jitter as values change.
 *
 * The overlay reads from a single `ViewmodelDebugState` snapshot per frame —
 * the caller (main.ts render loop) builds the snapshot from
 * ViewmodelRenderer + CombatStateComp + camera state. We deliberately do NOT
 * import ECS components or Three.js camera types here so the overlay stays a
 * pure renderer of pre-shaped data and is easy to unit-test.
 *
 * Zero-cost when disabled: `update()` short-circuits when the overlay is
 * hidden, so the caller pays only the snapshot allocation. The DOM div
 * remains in the document; the `display: none` toggle is one style write
 * per toggle, not per frame.
 */

import * as THREE from 'three';

/** Per-frame state snapshot displayed by the overlay. */
export interface ViewmodelDebugState {
  /** Display name of the currently equipped weapon (or '?' if none). */
  weaponName: string;
  /** Combat state (e.g. 'Idle', 'Windup'). Free-form string so the overlay
   * doesn't need to know enum values — caller resolves via COMBAT_STATE_NAMES. */
  combatState: string;
  /** Attack/block direction label (e.g. 'Overhead', 'Stab'). */
  direction: string;
  /** Ticks elapsed in the current combat phase. */
  phaseElapsed: number;
  /** Total ticks the current combat phase will last. */
  phaseTotal: number;
  /** Per-bone Eulers (radians) keyed by canonical bone name. The overlay
   * converts to degrees on render. Caller is expected to pass at least
   * `upper_arm_R`, `forearm_R`, `hand_R`, `weapon_attach`. */
  boneEulers: Record<string, THREE.Euler>;
  /** Current ARM_OFFSET vector. */
  armOffset: THREE.Vector3;
  /** Viewmodel camera FOV (degrees). */
  fov: number;
  /**
   * Aim-sway angular delta between the viewmodel group quaternion and the
   * world camera quaternion, in degrees. Reserved for sub-issue #129; pass
   * `null` until that lands. The overlay renders 'n/a' for null.
   */
  aimSwayDeg: number | null;
}

const RAD_TO_DEG = 180 / Math.PI;

/** Format a single Euler XYZ row in degrees, fixed to 1 decimal place.
 *  Uses fixed-width padding so values don't visually shift between frames. */
function formatEuler(name: string, e: THREE.Euler | undefined): string {
  if (!e) return `  ${name.padEnd(13)}: (no bone)`;
  const x = (e.x * RAD_TO_DEG).toFixed(1);
  const y = (e.y * RAD_TO_DEG).toFixed(1);
  const z = (e.z * RAD_TO_DEG).toFixed(1);
  // Pad each value to 7 chars so " 180.0" / " -45.3" / "  0.0" all align.
  const xs = x.padStart(7);
  const ys = y.padStart(7);
  const zs = z.padStart(7);
  return `  ${name.padEnd(13)}: ${xs} ${ys} ${zs}`;
}

export class ViewmodelDebugOverlay {
  /** The DOM element rendered into. Public for tests. */
  public readonly el: HTMLElement;

  private _visible = false;

  constructor() {
    // Re-use existing DOM node if present (test fixtures may inject one);
    // otherwise create + attach. Mirrors DebugOverlay.ts's pattern.
    const existing = document.getElementById('viewmodel-debug-overlay');
    if (existing) {
      this.el = existing;
    } else {
      this.el = document.createElement('div');
      this.el.id = 'viewmodel-debug-overlay';
      this.el.style.cssText =
        'position:fixed;bottom:12px;left:12px;color:#0f0;' +
        'font-family:monospace;font-size:12px;z-index:50;' +
        'pointer-events:none;white-space:pre;' +
        'background:rgba(0,0,0,0.6);padding:6px 10px;border-radius:4px;';
      document.body.appendChild(this.el);
    }
    // Hidden by default; setVisible(true) will reveal when --debug-viewmodel
    // is enabled.
    this.el.style.display = 'none';
  }

  /** Show or hide the overlay. Single style write per toggle. */
  setVisible(visible: boolean): void {
    if (this._visible === visible) return;
    this._visible = visible;
    this.el.style.display = visible ? 'block' : 'none';
  }

  /** Whether the overlay is currently displayed. */
  get visible(): boolean {
    return this._visible;
  }

  /**
   * Update the overlay's text from a state snapshot.
   *
   * No-op when hidden — caller pays the snapshot-build cost (cheap), but
   * `textContent` writes (which trigger style recalc) are skipped.
   */
  update(state: ViewmodelDebugState): void {
    if (!this._visible) return;

    const phasePct =
      state.phaseTotal > 0
        ? Math.round((state.phaseElapsed / state.phaseTotal) * 100)
        : 0;

    const offset = state.armOffset;
    const ox = offset.x.toFixed(3);
    const oy = offset.y.toFixed(3);
    const oz = offset.z.toFixed(3);

    const swayLabel =
      state.aimSwayDeg === null ? 'n/a' : `${state.aimSwayDeg.toFixed(2)}°`;

    this.el.textContent =
      `── viewmodel debug ──\n` +
      `weapon:    ${state.weaponName}\n` +
      `state:     ${state.combatState}\n` +
      `dir:       ${state.direction}\n` +
      `phase:     ${state.phaseElapsed} / ${state.phaseTotal} ticks (${phasePct}%)\n` +
      `arm_off:   ${ox}, ${oy}, ${oz}\n` +
      `vm_fov:    ${state.fov.toFixed(1)}°\n` +
      `aim_sway:  ${swayLabel}\n` +
      `bone eulers (deg, XYZ):\n` +
      formatEuler('upper_arm_R', state.boneEulers['upper_arm_R']) + '\n' +
      formatEuler('forearm_R', state.boneEulers['forearm_R']) + '\n' +
      formatEuler('hand_R', state.boneEulers['hand_R']) + '\n' +
      formatEuler('weapon_attach', state.boneEulers['weapon_attach']);
  }

  /** Remove the overlay's DOM node. Used by tests / hot-reload teardown. */
  dispose(): void {
    this.el.parentNode?.removeChild(this.el);
  }
}
