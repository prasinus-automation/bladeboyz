import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { ViewmodelDebugOverlay, ViewmodelDebugState } from './ViewmodelDebugOverlay';

/** Build a fully-populated debug state with the given overrides. */
function makeState(overrides: Partial<ViewmodelDebugState> = {}): ViewmodelDebugState {
  return {
    weaponName: 'Longsword',
    combatState: 'Idle',
    direction: 'Stab',
    phaseElapsed: 0,
    phaseTotal: 0,
    boneEulers: {
      upper_arm_R: new THREE.Euler(0, 0, 0),
      forearm_R: new THREE.Euler(0, 0, 0),
      hand_R: new THREE.Euler(0, 0, 0),
      weapon_attach: new THREE.Euler(Math.PI * 0.85, 0, 0),
    },
    armOffset: new THREE.Vector3(0.25, -0.1, -0.4),
    fov: 70,
    aimSwayDeg: null,
    ...overrides,
  };
}

describe('ViewmodelDebugOverlay', () => {
  let overlay: ViewmodelDebugOverlay;

  beforeEach(() => {
    document.body.innerHTML = '';
    overlay = new ViewmodelDebugOverlay();
  });

  afterEach(() => {
    overlay.dispose();
    document.body.innerHTML = '';
  });

  describe('construction', () => {
    it('creates a fixed-position bottom-left div', () => {
      expect(overlay.el).toBeInstanceOf(HTMLElement);
      expect(overlay.el.id).toBe('viewmodel-debug-overlay');
      expect(overlay.el.style.position).toBe('fixed');
      expect(overlay.el.style.bottom).toBe('12px');
      expect(overlay.el.style.left).toBe('12px');
    });

    it('starts hidden (display:none) — zero-cost-when-disabled contract', () => {
      expect(overlay.visible).toBe(false);
      expect(overlay.el.style.display).toBe('none');
    });

    it('reuses an existing DOM node with the canonical id', () => {
      // Tear down the beforeEach overlay first so its DOM node isn't the one
      // getElementById finds.
      overlay.dispose();
      document.body.innerHTML = '';

      const div = document.createElement('div');
      div.id = 'viewmodel-debug-overlay';
      div.dataset.preExisting = 'yes';
      document.body.appendChild(div);

      const ov2 = new ViewmodelDebugOverlay();
      expect(ov2.el).toBe(div);
      expect(ov2.el.dataset.preExisting).toBe('yes');
      // Re-bind `overlay` so afterEach's dispose() doesn't double-remove the div.
      overlay = ov2;
    });
  });

  describe('setVisible', () => {
    it('toggles display style', () => {
      overlay.setVisible(true);
      expect(overlay.visible).toBe(true);
      expect(overlay.el.style.display).toBe('block');

      overlay.setVisible(false);
      expect(overlay.visible).toBe(false);
      expect(overlay.el.style.display).toBe('none');
    });

    it('is idempotent — repeated same-value calls do not flip state', () => {
      overlay.setVisible(true);
      overlay.setVisible(true);
      overlay.setVisible(true);
      expect(overlay.visible).toBe(true);
      expect(overlay.el.style.display).toBe('block');
    });
  });

  describe('update', () => {
    it('does not write text when overlay is hidden', () => {
      overlay.update(makeState({ weaponName: 'Mace' }));
      expect(overlay.el.textContent).toBe('');
    });

    it('writes weapon, state, direction, and phase when visible', () => {
      overlay.setVisible(true);
      overlay.update(
        makeState({
          weaponName: 'Battleaxe',
          combatState: 'Windup',
          direction: 'Overhead',
          phaseElapsed: 12,
          phaseTotal: 24,
        }),
      );

      const text = overlay.el.textContent ?? '';
      expect(text).toContain('weapon:    Battleaxe');
      expect(text).toContain('state:     Windup');
      expect(text).toContain('dir:       Overhead');
      expect(text).toContain('12 / 24 ticks (50%)');
    });

    it('reports 0% when phaseTotal is 0 (avoids div-by-zero)', () => {
      overlay.setVisible(true);
      overlay.update(makeState({ phaseElapsed: 0, phaseTotal: 0 }));
      expect(overlay.el.textContent).toContain('0 / 0 ticks (0%)');
    });

    it('formats bone Eulers in degrees, fixed to 1 decimal', () => {
      overlay.setVisible(true);
      const eulers = {
        upper_arm_R: new THREE.Euler(Math.PI / 4, 0, 0), // 45° on X
        forearm_R: new THREE.Euler(0, -Math.PI / 6, 0), // -30° on Y
        hand_R: new THREE.Euler(0, 0, Math.PI / 2), // 90° on Z
        weapon_attach: new THREE.Euler(Math.PI * 0.85, 0, 0),
      };
      overlay.update(makeState({ boneEulers: eulers }));

      const text = overlay.el.textContent ?? '';
      // 45.0° on X for upper_arm_R
      expect(text).toMatch(/upper_arm_R\s*:\s*45\.0/);
      // -30.0° on Y for forearm_R
      expect(text).toMatch(/forearm_R\s*:\s*0\.0\s+-30\.0/);
      // 90.0° on Z for hand_R
      expect(text).toMatch(/hand_R\s*:\s*0\.0\s+0\.0\s+90\.0/);
      // weapon_attach pre-rotated Math.PI * 0.85 ≈ 153.0° on X
      expect(text).toMatch(/weapon_attach\s*:\s*153\.0/);
    });

    it('renders ARM_OFFSET to 3 decimals', () => {
      overlay.setVisible(true);
      overlay.update(
        makeState({ armOffset: new THREE.Vector3(0.25, -0.1, -0.4) }),
      );
      expect(overlay.el.textContent).toContain('arm_off:   0.250, -0.100, -0.400');
    });

    it('renders FOV to 1 decimal with a degree symbol', () => {
      overlay.setVisible(true);
      overlay.update(makeState({ fov: 65 }));
      expect(overlay.el.textContent).toContain('vm_fov:    65.0°');
    });

    it('renders n/a for aim-sway when null (#129 placeholder)', () => {
      overlay.setVisible(true);
      overlay.update(makeState({ aimSwayDeg: null }));
      expect(overlay.el.textContent).toContain('aim_sway:  n/a');
    });

    it('renders aim-sway value with 2 decimals when provided', () => {
      overlay.setVisible(true);
      overlay.update(makeState({ aimSwayDeg: 3.14159 }));
      expect(overlay.el.textContent).toContain('aim_sway:  3.14°');
    });

    it('handles missing bone gracefully', () => {
      overlay.setVisible(true);
      const eulers = {
        upper_arm_R: new THREE.Euler(0, 0, 0),
        // forearm_R intentionally missing
        hand_R: new THREE.Euler(0, 0, 0),
        weapon_attach: new THREE.Euler(0, 0, 0),
      };
      overlay.update(makeState({ boneEulers: eulers }));
      expect(overlay.el.textContent).toContain('forearm_R    : (no bone)');
    });

    it('overwrites previous text on each update (no DOM stacking)', () => {
      overlay.setVisible(true);
      overlay.update(makeState({ weaponName: 'Dagger' }));
      overlay.update(makeState({ weaponName: 'Mace' }));
      // Old weapon name must be gone — otherwise we'd be appending instead of
      // overwriting, which would grow the DOM unboundedly across frames.
      expect(overlay.el.textContent).toContain('weapon:    Mace');
      expect(overlay.el.textContent).not.toContain('weapon:    Dagger');
      // Confirm we haven't accumulated multiple `weapon:` rows.
      const matches = (overlay.el.textContent ?? '').match(/weapon:/g) ?? [];
      expect(matches.length).toBe(1);
    });
  });

  describe('dispose', () => {
    it('removes the overlay element from the DOM', () => {
      const el = overlay.el;
      expect(document.body.contains(el)).toBe(true);
      overlay.dispose();
      expect(document.body.contains(el)).toBe(false);
    });
  });
});
