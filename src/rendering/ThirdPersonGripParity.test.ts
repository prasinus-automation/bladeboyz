/**
 * ThirdPersonGripParity — the third-person weapon grip (#220) must never
 * desync a weapon's DAMAGE geometry from its VISIBLE geometry.
 *
 * `attachThirdPersonWeapon` composes the per-weapon grip onto the
 * `weapon_attach` BONE (not the weapon model group). This is the whole point:
 * `TracerSystem` sweeps `WeaponConfig.tracerPoints` through
 * `weapon_attach.matrixWorld`, and the visible blade is a child of the same
 * bone — so any grip applied to the bone moves the tracer geometry and the
 * visible mesh by the exact same transform.
 *
 * The bug this suite guards against: applying grip to the weapon model group
 * instead (e.g. `model.group.position.set(...)`). That would move the visible
 * blade while the tracers — read from the bone — stayed put, so damage would
 * land where the blade *used* to be. We prove the two stay coincident in
 * WORLD space, under a real posed skeleton, for a grip'd weapon.
 *
 * We assert with REAL three.js world transforms (build model, attach, pose,
 * `updateMatrixWorld`, read world positions) rather than re-deriving the grip
 * formula — the #212 lesson: a formula-vs-formula test passes tautologically
 * while the render is wrong.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCharacterModel } from './CharacterModel';
import { attachThirdPersonWeapon } from './WeaponModels';
import { weaponConfigs } from '../weapons/WeaponConfig';
import { weaponIdToName } from '../ecs/systems/CombatSystem';
import { IDLE_POSE } from '../animation/AnimationData';

// Auto-register every weapon config so `weaponConfigs[name]` is populated.
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

/** Build a posed character with `weaponName` attached via the shared helper. */
function poseWithWeapon(weaponName: string) {
  const { group, bones } = createCharacterModel();
  // Pose the arms (IDLE). Deliberately do NOT touch `weapon_attach` — poses
  // never write it, so its baked π + grip survive, exactly as in-game.
  for (const [name, rot] of Object.entries(IDLE_POSE)) {
    const b = bones[name];
    if (!b) continue;
    b.quaternion.setFromEuler(
      new THREE.Euler(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0, 'XYZ'),
    );
  }
  const bone = bones['weapon_attach'];
  const model = attachThirdPersonWeapon(bone, weaponName)!;
  group.updateMatrixWorld(true);
  return { group, bones, bone, model };
}

describe('third-person grip keeps damage geometry on the visible blade', () => {
  for (const name of weaponIdToName) {
    it(`${name}: tracer world positions coincide with the visible blade`, () => {
      const { bone, model } = poseWithWeapon(name);
      const config = weaponConfigs[name];
      expect(config, `weapon config missing for ${name}`).toBeDefined();

      // TracerSystem's world positions: config points via the BONE matrix.
      // The visible blade's world positions: the model's authored tracer
      // points via the MODEL GROUP matrix (where the mesh actually renders).
      // If grip were applied to the group instead of the bone, group.matrixWorld
      // would diverge from bone.matrixWorld and these would not match.
      model.group.updateWorldMatrix(true, false);
      for (let i = 0; i < config.tracerPoints.length; i++) {
        // (1) Exact guard against the "offset the model group" bug: the same
        // point transformed by the bone vs by the model group must be
        // identical — i.e. the group carries no independent transform, so it
        // rides the grip'd bone. This is precision-tight (1e-6).
        const p = model.tracerPoints[i];
        const viaBone = p.clone().applyMatrix4(bone.matrixWorld);
        const viaGroup = p.clone().applyMatrix4(model.group.matrixWorld);
        expect(viaBone.distanceTo(viaGroup), `${name} pt ${i} bone≡group`).toBeCloseTo(0, 6);

        // (2) The damage geometry TracerSystem actually sweeps (config points
        // via the bone) coincides in world space with the visible blade
        // (model points via the group), to the same 3-decimal tolerance the
        // base config↔model list parity guarantees.
        const [cx, cy, cz] = config.tracerPoints[i];
        const damageWorld = new THREE.Vector3(cx, cy, cz).applyMatrix4(
          bone.matrixWorld,
        );
        expect(damageWorld.x, `${name} point ${i} x`).toBeCloseTo(viaGroup.x, 3);
        expect(damageWorld.y, `${name} point ${i} y`).toBeCloseTo(viaGroup.y, 3);
        expect(damageWorld.z, `${name} point ${i} z`).toBeCloseTo(viaGroup.z, 3);
      }
    });
  }

  it('grip is applied on the bone, so the model group stays at local identity', () => {
    // Longsword has a non-default grip. The visible-blade parity above only
    // holds because the model group is NOT independently offset — pin that.
    const { bone, model } = poseWithWeapon('Longsword');
    expect(bone.children).toContain(model.group);
    expect(model.group.position.lengthSq()).toBeCloseTo(0, 6);
    expect(model.group.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
  });
});

describe('attachThirdPersonWeapon helper contract', () => {
  it('applies a non-identity grip for a mapped weapon (Longsword)', () => {
    const { bones } = createCharacterModel();
    const bone = bones['weapon_attach'];
    attachThirdPersonWeapon(bone, 'Longsword');
    // Baked base is (π, 0, 0); Longsword grip pitches it forward, so the bone
    // rotation must differ from the bare baked rotation.
    const bare = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    expect(bone.quaternion.angleTo(bare)).toBeGreaterThan(0.1);
  });

  it('leaves the baked rest rotation for an identity-grip weapon (Yeeter)', () => {
    const { bones } = createCharacterModel();
    const bone = bones['weapon_attach'];
    attachThirdPersonWeapon(bone, 'Yeeter');
    const bare = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    expect(bone.quaternion.angleTo(bare)).toBeCloseTo(0, 6);
  });

  it('is idempotent across weapon swaps — grip does not accumulate', () => {
    // RemotePlayers.applyRemoteWeapon calls the helper repeatedly on the same
    // bone. A second call to the SAME weapon must land on the same transform
    // as the first (reset-then-compose, no accumulation).
    const { bones } = createCharacterModel();
    const bone = bones['weapon_attach'];
    attachThirdPersonWeapon(bone, 'Battleaxe');
    const q1 = bone.quaternion.clone();
    const p1 = bone.position.clone();
    // Clear children as applyRemoteWeapon does, then re-attach.
    while (bone.children.length > 0) bone.remove(bone.children[0]);
    attachThirdPersonWeapon(bone, 'Battleaxe');
    expect(bone.quaternion.angleTo(q1)).toBeCloseTo(0, 6);
    expect(bone.position.distanceTo(p1)).toBeCloseTo(0, 6);
  });

  it('swapping to a different weapon resets prior grip (no leftover)', () => {
    const { bones } = createCharacterModel();
    const bone = bones['weapon_attach'];
    // Attach a grip'd weapon, then swap to an identity-grip weapon: the bone
    // must return to the bare baked rotation, not keep the first weapon's grip.
    attachThirdPersonWeapon(bone, 'Longsword');
    while (bone.children.length > 0) bone.remove(bone.children[0]);
    attachThirdPersonWeapon(bone, 'Yeeter');
    const bare = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    expect(bone.quaternion.angleTo(bare)).toBeCloseTo(0, 6);
  });

  it('returns null for an unknown weapon and leaves the bone at rest', () => {
    const { bones } = createCharacterModel();
    const bone = bones['weapon_attach'];
    const result = attachThirdPersonWeapon(bone, 'NotAWeapon');
    expect(result).toBeNull();
    expect(bone.children.length).toBe(0);
  });
});
