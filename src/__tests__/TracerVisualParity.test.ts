/**
 * TracerVisualParity — every weapon's DAMAGE geometry must match its
 * VISUAL geometry (#goal-2026-07 hit-accuracy pass).
 *
 * `WeaponConfig.tracerPoints` (what TracerSystem sweeps) and the model
 * factory's returned `tracerPoints` (authored with the mesh, blade
 * base → tip) drifted apart: the longsword dealt damage 0.27m past its
 * visible tip, the katana's config ignored the blade curve, and the
 * spear under-reached its own mesh. This suite pins the two lists
 * together so the drift can't come back — if you resize a blade, update
 * BOTH the factory and the config.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  weaponModelFactories,
  attachThirdPersonWeapon,
} from '../rendering/WeaponModels';
import { createCharacterModel } from '../rendering/CharacterModel';
import { weaponConfigs } from '../weapons/WeaponConfig';
import { weaponIdToName } from '../ecs/systems/CombatSystem';

// Auto-register every weapon config.
import '../weapons/longsword';
import '../weapons/mace';
import '../weapons/dagger';
import '../weapons/battleaxe';
import '../weapons/zweihander';
import '../weapons/warhammer';
import '../weapons/spear';
import '../weapons/katana';
import '../weapons/scythe';
import '../weapons/yeeter';
import '../weapons/rapier';
import '../weapons/halberd';

describe('tracer points match the visible weapon geometry', () => {
  for (const name of weaponIdToName) {
    it(`${name}: config.tracerPoints === model factory tracerPoints`, () => {
      const config = weaponConfigs[name];
      const factory = weaponModelFactories[name];
      expect(config, `weapon config missing for ${name}`).toBeDefined();
      expect(factory, `model factory missing for ${name}`).toBeDefined();

      const visual = factory().tracerPoints;
      expect(
        config.tracerPoints.length,
        `${name}: tracer point count differs from the mesh's`,
      ).toBe(visual.length);

      for (let i = 0; i < visual.length; i++) {
        const [cx, cy, cz] = config.tracerPoints[i];
        expect(cx, `${name} point ${i} x`).toBeCloseTo(visual[i].x, 3);
        expect(cy, `${name} point ${i} y`).toBeCloseTo(visual[i].y, 3);
        expect(cz, `${name} point ${i} z`).toBeCloseTo(visual[i].z, 3);
      }
    });
  }
});

describe('third-person grip (#220) preserves tracer↔visual parity', () => {
  // The list-equality above is grip-agnostic (both lists are raw local
  // coordinates). This extension exercises the actual third-person attach
  // path on a NON-DEFAULT-grip weapon (Longsword pitches forward) and proves
  // that, once the grip is composed onto the `weapon_attach` bone, the damage
  // tracers (config × bone matrix) still coincide in WORLD space with the
  // visible blade (model tracers × model-group matrix). Deeper coverage —
  // every weapon, idempotent swaps — lives in ThirdPersonGripParity.test.ts.
  it('Longsword: grip does not move damage off the visible blade', () => {
    const { group, bones } = createCharacterModel();
    const bone = bones['weapon_attach'];
    const model = attachThirdPersonWeapon(bone, 'Longsword')!;
    group.updateMatrixWorld(true);
    model.group.updateWorldMatrix(true, false);

    const config = weaponConfigs['Longsword'];
    for (let i = 0; i < config.tracerPoints.length; i++) {
      const [cx, cy, cz] = config.tracerPoints[i];
      const damage = new THREE.Vector3(cx, cy, cz).applyMatrix4(bone.matrixWorld);
      const visual = model.tracerPoints[i]
        .clone()
        .applyMatrix4(model.group.matrixWorld);
      expect(damage.distanceTo(visual), `Longsword point ${i}`).toBeCloseTo(0, 3);
    }
  });
});
