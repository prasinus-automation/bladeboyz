import { describe, it, expect } from 'vitest';
import {
  getViewmodelPose,
  VIEWMODEL_ANIMS,
  type ViewmodelWeaponAnims,
} from './ViewmodelAnimationData';
import type { Pose } from './AnimationData';
import { CombatState } from '../combat/states';
import { AttackDirection, BlockDirection } from '../combat/directions';

const WEAPON_NAMES = ['Longsword', 'Mace', 'Dagger', 'Battleaxe'];

/** Only these bones should appear in viewmodel poses */
const ALLOWED_BONES = new Set(['upper_arm_R', 'forearm_R', 'hand_R']);

const ALL_ATTACK_DIRS = [
  AttackDirection.Left,
  AttackDirection.Right,
  AttackDirection.Overhead,
  AttackDirection.Underhand,
  AttackDirection.Stab,
];

const ALL_BLOCK_DIRS = [
  BlockDirection.Left,
  BlockDirection.Right,
  BlockDirection.Top,
  BlockDirection.Bottom,
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
        JSON.stringify(VIEWMODEL_ANIMS[n].attacks[AttackDirection.Left as number].windup),
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
        const leftWindup = JSON.stringify(anims.attacks[AttackDirection.Left as number].windup);
        const rightWindup = JSON.stringify(anims.attacks[AttackDirection.Right as number].windup);
        const overheadWindup = JSON.stringify(anims.attacks[AttackDirection.Overhead as number].windup);
        const stabWindup = JSON.stringify(anims.attacks[AttackDirection.Stab as number].windup);

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
      const pose = getViewmodelPose('Longsword', CombatState.Windup, AttackDirection.Left);
      expect(pose).toBe(VIEWMODEL_ANIMS['Longsword'].attacks[AttackDirection.Left as number].windup);
    });

    it('returns release pose for Release state', () => {
      const pose = getViewmodelPose('Mace', CombatState.Release, AttackDirection.Overhead);
      expect(pose).toBe(VIEWMODEL_ANIMS['Mace'].attacks[AttackDirection.Overhead as number].release);
    });

    it('returns recovery pose for Recovery state', () => {
      const pose = getViewmodelPose('Dagger', CombatState.Recovery, AttackDirection.Stab);
      expect(pose).toBe(VIEWMODEL_ANIMS['Dagger'].attacks[AttackDirection.Stab as number].recovery);
    });

    it('returns windup pose for Riposte state', () => {
      const pose = getViewmodelPose('Battleaxe', CombatState.Riposte, AttackDirection.Right);
      expect(pose).toBe(VIEWMODEL_ANIMS['Battleaxe'].attacks[AttackDirection.Right as number].windup);
    });

    it('returns recovery pose for Feint state', () => {
      const pose = getViewmodelPose('Longsword', CombatState.Feint, AttackDirection.Overhead);
      expect(pose).toBe(VIEWMODEL_ANIMS['Longsword'].attacks[AttackDirection.Overhead as number].recovery);
    });

    it('returns block pose for Block state', () => {
      const pose = getViewmodelPose('Mace', CombatState.Block, BlockDirection.Top);
      expect(pose).toBe(VIEWMODEL_ANIMS['Mace'].blocks[BlockDirection.Top as number]);
    });

    it('returns parry pose for ParryWindow state', () => {
      const pose = getViewmodelPose('Dagger', CombatState.ParryWindow, 0);
      expect(pose).toBe(VIEWMODEL_ANIMS['Dagger'].parry);
    });

    it('returns stunned pose for Stunned and Clash states', () => {
      expect(getViewmodelPose('Longsword', CombatState.Stunned, 0))
        .toBe(VIEWMODEL_ANIMS['Longsword'].stunned);
      expect(getViewmodelPose('Longsword', CombatState.Clash, 0))
        .toBe(VIEWMODEL_ANIMS['Longsword'].stunned);
    });

    it('returns hitStun pose for HitStun state', () => {
      const pose = getViewmodelPose('Battleaxe', CombatState.HitStun, 0);
      expect(pose).toBe(VIEWMODEL_ANIMS['Battleaxe'].hitStun);
    });

    it('falls back to Longsword for unknown weapon names', () => {
      const unknown = getViewmodelPose('UnknownWeapon', CombatState.Idle, 0);
      const longsword = getViewmodelPose('Longsword', CombatState.Idle, 0);
      expect(unknown).toBe(longsword);
    });

    it('falls back to Longsword for all states with unknown weapon', () => {
      const states: Array<[CombatState, number]> = [
        [CombatState.Idle, 0],
        [CombatState.Windup, AttackDirection.Left],
        [CombatState.Release, AttackDirection.Right],
        [CombatState.Recovery, AttackDirection.Stab],
        [CombatState.Block, BlockDirection.Top],
        [CombatState.ParryWindow, 0],
        [CombatState.Stunned, 0],
        [CombatState.HitStun, 0],
      ];

      for (const [state, dir] of states) {
        const unknown = getViewmodelPose('NonexistentWeapon', state, dir);
        const longsword = getViewmodelPose('Longsword', state, dir);
        expect(unknown).toBe(longsword);
      }
    });

    it('returns different poses for different weapons in same state', () => {
      const longsword = getViewmodelPose('Longsword', CombatState.Windup, AttackDirection.Left);
      const dagger = getViewmodelPose('Dagger', CombatState.Windup, AttackDirection.Left);
      const mace = getViewmodelPose('Mace', CombatState.Windup, AttackDirection.Left);
      const battleaxe = getViewmodelPose('Battleaxe', CombatState.Windup, AttackDirection.Left);

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
