import { describe, it, expect } from 'vitest';
import {
  getViewmodelPose,
  VIEWMODEL_ANIMS,
  type ViewmodelWeaponAnims,
} from './ViewmodelAnimationData';
import type { Pose } from './AnimationData';
import { CombatState } from '../combat/states';
import { Direction } from '../combat/directions';

const WEAPON_NAMES = [
  'Longsword',
  'Mace',
  'Dagger',
  'Battleaxe',
  'Zweihander',
  'Warhammer',
  'Spear',
  'Katana',
  'Scythe',
  'Yeeter',
  'Rapier',
  'Halberd',
];

/** Only these bones should appear in viewmodel poses */
const ALLOWED_BONES = new Set(['upper_arm_R', 'forearm_R', 'hand_R']);

// FSM v2 (#88, #131): 4 attack directions — Underhand removed.
const ALL_ATTACK_DIRS = [
  Direction.Left,
  Direction.Right,
  Direction.Overhead,
  Direction.Stab,
];

const ALL_BLOCK_DIRS = [
  Direction.Left,
  Direction.Right,
  Direction.Overhead,
  Direction.Stab,
];

function validatePoseBonesOnly(pose: Pose, label: string) {
  for (const bone of Object.keys(pose)) {
    expect(ALLOWED_BONES.has(bone), `${label}: unexpected bone '${bone}'`).toBe(true);
  }
}

function validatePoseValues(pose: Pose, label: string) {
  expect(Object.keys(pose).length, `${label}: pose should not be empty`).toBeGreaterThan(0);
  for (const [bone, rot] of Object.entries(pose)) {
    if (rot.x !== undefined) expect(typeof rot.x, `${label}.${bone}.x`).toBe('number');
    if (rot.y !== undefined) expect(typeof rot.y, `${label}.${bone}.y`).toBe('number');
    if (rot.z !== undefined) expect(typeof rot.z, `${label}.${bone}.z`).toBe('number');
  }
}

describe('ViewmodelAnimationData', () => {
  describe('VIEWMODEL_ANIMS registry', () => {
    it('has entries for all 4 weapons', () => {
      for (const name of WEAPON_NAMES) {
        expect(VIEWMODEL_ANIMS[name], `missing weapon: ${name}`).toBeDefined();
      }
    });

    it.each(WEAPON_NAMES)('%s has complete pose set', (weaponName) => {
      const anims = VIEWMODEL_ANIMS[weaponName];

      // idle
      expect(anims.idle).toBeDefined();
      validatePoseValues(anims.idle, `${weaponName} idle`);

      // 5 attack directions × 3 phases
      for (const dir of ALL_ATTACK_DIRS) {
        const anim = anims.attacks[dir as number];
        expect(anim, `${weaponName} attack dir ${dir}`).toBeDefined();
        expect(anim.windup).toBeDefined();
        expect(anim.release).toBeDefined();
        expect(anim.recovery).toBeDefined();
        validatePoseValues(anim.windup, `${weaponName} attack ${dir} windup`);
        validatePoseValues(anim.release, `${weaponName} attack ${dir} release`);
        validatePoseValues(anim.recovery, `${weaponName} attack ${dir} recovery`);
      }

      // 4 block directions
      for (const dir of ALL_BLOCK_DIRS) {
        const block = anims.blocks[dir as number];
        expect(block, `${weaponName} block dir ${dir}`).toBeDefined();
        validatePoseValues(block, `${weaponName} block ${dir}`);
      }

      // parry, stunned, hitStun
      validatePoseValues(anims.parry, `${weaponName} parry`);
      validatePoseValues(anims.stunned, `${weaponName} stunned`);
      validatePoseValues(anims.hitStun, `${weaponName} hitStun`);
    });

    it.each(WEAPON_NAMES)('%s poses only reference right arm bones', (weaponName) => {
      const anims = VIEWMODEL_ANIMS[weaponName];

      validatePoseBonesOnly(anims.idle, `${weaponName} idle`);
      validatePoseBonesOnly(anims.parry, `${weaponName} parry`);
      validatePoseBonesOnly(anims.stunned, `${weaponName} stunned`);
      validatePoseBonesOnly(anims.hitStun, `${weaponName} hitStun`);

      for (const dir of ALL_ATTACK_DIRS) {
        const anim = anims.attacks[dir as number];
        validatePoseBonesOnly(anim.windup, `${weaponName} attack ${dir} windup`);
        validatePoseBonesOnly(anim.release, `${weaponName} attack ${dir} release`);
        validatePoseBonesOnly(anim.recovery, `${weaponName} attack ${dir} recovery`);
      }

      for (const dir of ALL_BLOCK_DIRS) {
        validatePoseBonesOnly(anims.blocks[dir as number], `${weaponName} block ${dir}`);
      }
    });
  });

  describe('Per-weapon differentiation', () => {
    it('each weapon has distinct idle poses', () => {
      const idles = WEAPON_NAMES.map((n) => JSON.stringify(VIEWMODEL_ANIMS[n].idle));
      const unique = new Set(idles);
      expect(unique.size).toBe(WEAPON_NAMES.length);
    });

    it('each weapon has distinct attack windup for Left direction', () => {
      const windups = WEAPON_NAMES.map((n) =>
        JSON.stringify(VIEWMODEL_ANIMS[n].attacks[Direction.Left as number].windup),
      );
      const unique = new Set(windups);
      expect(unique.size).toBe(WEAPON_NAMES.length);
    });

    it('each weapon has distinct parry poses', () => {
      const parries = WEAPON_NAMES.map((n) => JSON.stringify(VIEWMODEL_ANIMS[n].parry));
      const unique = new Set(parries);
      expect(unique.size).toBe(WEAPON_NAMES.length);
    });

    it('different directions produce different poses for the same weapon', () => {
      for (const weaponName of WEAPON_NAMES) {
        const anims = VIEWMODEL_ANIMS[weaponName];
        const leftWindup = JSON.stringify(anims.attacks[Direction.Left as number].windup);
        const rightWindup = JSON.stringify(anims.attacks[Direction.Right as number].windup);
        const overheadWindup = JSON.stringify(anims.attacks[Direction.Overhead as number].windup);
        const stabWindup = JSON.stringify(anims.attacks[Direction.Stab as number].windup);

        expect(leftWindup, `${weaponName}: Left vs Right windup`).not.toBe(rightWindup);
        expect(leftWindup, `${weaponName}: Left vs Overhead windup`).not.toBe(overheadWindup);
        expect(overheadWindup, `${weaponName}: Overhead vs Stab windup`).not.toBe(stabWindup);
      }
    });
  });

  describe('getViewmodelPose', () => {
    it('returns idle pose for Idle state', () => {
      for (const weaponName of WEAPON_NAMES) {
        const pose = getViewmodelPose(weaponName, CombatState.Idle, 0);
        expect(pose).toBe(VIEWMODEL_ANIMS[weaponName].idle);
      }
    });

    it('returns windup pose for Windup state', () => {
      const pose = getViewmodelPose('Longsword', CombatState.Windup, Direction.Left);
      expect(pose).toBe(VIEWMODEL_ANIMS['Longsword'].attacks[Direction.Left as number].windup);
    });

    it('returns release pose for Release state', () => {
      const pose = getViewmodelPose('Mace', CombatState.Release, Direction.Overhead);
      expect(pose).toBe(VIEWMODEL_ANIMS['Mace'].attacks[Direction.Overhead as number].release);
    });

    it('returns recovery pose for Recovery state', () => {
      const pose = getViewmodelPose('Dagger', CombatState.Recovery, Direction.Stab);
      expect(pose).toBe(VIEWMODEL_ANIMS['Dagger'].attacks[Direction.Stab as number].recovery);
    });

    it('returns block pose for Blocking state', () => {
      // FSM v2 (#135): `Block` was renamed to `Blocking`; the lookup
      // function reads block poses from the same `blocks` table.
      const pose = getViewmodelPose('Mace', CombatState.Blocking, Direction.Overhead);
      expect(pose).toBe(VIEWMODEL_ANIMS['Mace'].blocks[Direction.Overhead as number]);
    });

    it('returns parry pose for Parry state', () => {
      // FSM v2 (#135): `ParryWindow` collapsed into Blocking; the standalone
      // `Parry` state is the brief locked pose AFTER a successful parry.
      const pose = getViewmodelPose('Dagger', CombatState.Parry, 0);
      expect(pose).toBe(VIEWMODEL_ANIMS['Dagger'].parry);
    });

    it('returns hitStun pose for HitStun state', () => {
      // FSM v2 (#135): `Stunned` and `Clash` were both collapsed into
      // `HitStun`. The single state is the full vulnerability window.
      const pose = getViewmodelPose('Battleaxe', CombatState.HitStun, 0);
      expect(pose).toBe(VIEWMODEL_ANIMS['Battleaxe'].hitStun);
    });

    it('falls back to Longsword for unknown weapon names', () => {
      const unknown = getViewmodelPose('UnknownWeapon', CombatState.Idle, 0);
      const longsword = getViewmodelPose('Longsword', CombatState.Idle, 0);
      expect(unknown).toBe(longsword);
    });

    it('falls back to Longsword for all states with unknown weapon', () => {
      // FSM v2 (#135): only the 7 surviving states are covered.
      const states: Array<[CombatState, number]> = [
        [CombatState.Idle, 0],
        [CombatState.Windup, Direction.Left],
        [CombatState.Release, Direction.Right],
        [CombatState.Recovery, Direction.Stab],
        [CombatState.Blocking, Direction.Overhead],
        [CombatState.Parry, 0],
        [CombatState.HitStun, 0],
      ];

      for (const [state, dir] of states) {
        const unknown = getViewmodelPose('NonexistentWeapon', state, dir);
        const longsword = getViewmodelPose('Longsword', state, dir);
        expect(unknown).toBe(longsword);
      }
    });

    it('returns different poses for different weapons in same state', () => {
      const longsword = getViewmodelPose('Longsword', CombatState.Windup, Direction.Left);
      const dagger = getViewmodelPose('Dagger', CombatState.Windup, Direction.Left);
      const mace = getViewmodelPose('Mace', CombatState.Windup, Direction.Left);
      const battleaxe = getViewmodelPose('Battleaxe', CombatState.Windup, Direction.Left);

      expect(longsword).not.toBe(dagger);
      expect(longsword).not.toBe(mace);
      expect(longsword).not.toBe(battleaxe);
      expect(dagger).not.toBe(mace);
    });

    it('returns idle pose as fallback for invalid attack direction', () => {
      const pose = getViewmodelPose('Longsword', CombatState.Windup, 99);
      expect(pose).toBe(VIEWMODEL_ANIMS['Longsword'].idle);
    });

    it('returns idle pose for default/unknown combat state', () => {
      const pose = getViewmodelPose('Longsword', 999 as CombatState, 0);
      expect(pose).toBe(VIEWMODEL_ANIMS['Longsword'].idle);
    });
  });
});
