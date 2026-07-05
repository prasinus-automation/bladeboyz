/**
 * Viewmodel Animation System — drives first-person arm bone poses.
 *
 * Runs in `update(dt)` (variable rate) for smooth blending. Reads the
 * player's combat state from ECS and applies per-weapon poses to the
 * `ViewmodelRenderer`'s bone hierarchy.
 *
 * Issue #132 rebuild — now parity with `AnimationSystem.ts`:
 *   - Uses the shared `applyPoseLayer` helper from `animation/poseBlending.ts`
 *     (single source of truth for the slerp-from-snapshot math).
 *   - Reads `CombatStateComp.phaseT` directly (no more re-derivation from
 *     `phaseElapsed / phaseTotal`).
 *   - Per-entity snapshot side-table (`prevPoseSnapshots`) replacing the
 *     module-level globals.
 *   - During Release, calls `computeArcSwingPose(dir, weaponName, t)` filtered
 *     to right-arm viewmodel bones — blade-timing parity with the third-person
 *     system.
 *
 * Animation write-permissions (per AGENTS.md): writes `quaternion` on
 * `vm_upper_arm_R / vm_forearm_R / vm_hand_R`. MUST NOT touch
 * `vm_weapon_attach` — that bone is owned by per-weapon grip data (#125).
 * Idle sway / locomotion bob from #129 are layered post-slerp via quaternion
 * multiply on the SAME three bones; they live in this module too (see §5 of
 * the architecture doc), but their channels are restricted to the right-arm
 * subset.
 *
 * This is NOT a bitECS query-based system — it operates on a single
 * player entity's viewmodel (Three.js objects), so it lives in
 * `src/rendering/` rather than `src/ecs/systems/`.
 */

import * as THREE from 'three';
import { CombatStateComp } from '../ecs/components';
import { CombatState } from '../combat/states';
import { getViewmodelPose } from '../animation/ViewmodelAnimationData';
import {
  applyPoseLayer,
  smoothstepEase,
  combatPhaseBlend,
  crossfadeDurationFor,
  anchoredPhaseT,
} from '../animation/poseBlending';
import {
  computeArcSwingPose,
  ARC_SWING_VIEWMODEL_BONES,
  type WeaponName,
} from '../animation/arcSwing';
import { IDLE_SWAY_CHANNELS } from './ViewmodelTuning';
import type { ViewmodelRenderer } from './ViewmodelRenderer';
import type { Pose } from '../animation/AnimationData';

/**
 * Remap arc-swing pose keys for the viewmodel rig.
 *
 * The arc swing operates in the third-person bone namespace:
 * `{ shoulder_R, forearm_R, hand_R, spine? }`. The viewmodel rig (see
 * `ViewmodelRenderer`) has no `shoulder_R` bone — `upper_arm_R` is the
 * pivot. Likewise, the FP viewmodel has no torso, so `spine` is dropped.
 *
 * Exported for tests so the blade-timing parity test can verify that
 * 3rd-person `shoulder_R` and FP `upper_arm_R` receive the same rotation
 * during Release.
 */
export function adaptArcPoseForViewmodel(arcPose: Pose): Pose {
  const adapted: Pose = {};
  if (arcPose.shoulder_R) adapted.upper_arm_R = arcPose.shoulder_R;
  if (arcPose.forearm_R) adapted.forearm_R = arcPose.forearm_R;
  if (arcPose.hand_R) adapted.hand_R = arcPose.hand_R;
  // spine intentionally dropped — viewmodel has no torso.
  return adapted;
}

// ── Pre-allocated temp objects (avoid GC pressure) ───────

const _euler = new THREE.Euler();
const _swayQuat = new THREE.Quaternion();

// ── Side-tables (per-entity snapshot — matches AnimationSystem pattern) ──

/**
 * Per-entity snapshot of viewmodel bone quaternions captured at the moment
 * of the last state-or-direction change. `applyPoseLayer` slerps FROM this
 * snapshot toward the target pose by `easedT` — that's the §10.1 bug fix
 * the shared helper exists for.
 *
 * Same pattern as `AnimationSystem.prevPoseSnapshots`. The viewmodel only
 * ever has one active entity today (the local player), but the side-table
 * shape future-proofs for spectator / replay viewmodels post-#92.
 */
export const prevPoseSnapshots = new Map<
  number,
  Record<string, THREE.Quaternion>
>();

// ── Per-entity blend state (replaces module-level globals) ──

/**
 * Per-entity crossfade timer + last-seen state/direction. Mirror of
 * `AnimationComp.crossfadeT / prevCombatState / prevDirection` but stored
 * separately because the viewmodel typically operates only on the player
 * entity and we don't want to require an `AnimationComp` on the player
 * (the player entity doesn't carry it today — only character-mesh
 * entities do).
 */
interface ViewmodelEntityState {
  crossfadeT: number;
  prevState: number;
  prevDirection: number;
  /** Elapsed-time accumulator for idle sway (per-entity so it survives
   *  state changes without re-syncing the sinusoid phase). */
  elapsedTime: number;
  /** `phaseTotal` captured when the current phase was ENTERED. The combat
   *  ease curve is driven off `phaseElapsed / blendPhaseTotal` so an in-place
   *  shrink (combo buffered mid-Recovery, #190) can't make it jump. Mirror of
   *  `AnimationComp.blendPhaseTotal`. */
  blendPhaseTotal: number;
}

const entityStates = new Map<number, ViewmodelEntityState>();

function getOrCreateEntityState(eid: number): ViewmodelEntityState {
  let s = entityStates.get(eid);
  if (!s) {
    s = {
      // Start fully blended on first sight — no jarring slerp from
      // identity. The snapshot is empty so `applyPoseLayer` slerps from
      // identity for every bone, which at easedT=1 is just "land at target".
      crossfadeT: 1,
      prevState: -1,
      prevDirection: -1,
      elapsedTime: 0,
      blendPhaseTotal: 0,
    };
    entityStates.set(eid, s);
  }
  return s;
}

// ── Constants ────────────────────────────────────────────

/**
 * Owned bone set for the viewmodel combat layer. Three bones — exactly
 * the same as `ARC_SWING_VIEWMODEL_BONES` — but kept as a separate
 * constant for legibility at the call site. `vm_weapon_attach` is
 * deliberately absent.
 */
const VIEWMODEL_COMBAT_BONES: ReadonlySet<string> = ARC_SWING_VIEWMODEL_BONES;

// ── Main System Function ─────────────────────────────────

/**
 * Drive viewmodel bone poses based on the player's combat state.
 *
 * Call in the variable-rate `update(dt)` loop, after `animationSystem()`.
 *
 * @param viewmodel       The ViewmodelRenderer instance.
 * @param playerEid       Player entity ID (to read CombatStateComp).
 * @param dt              Frame delta time in seconds (variable rate).
 * @param weaponIdToName  Weapon ID → name mapping array (from CombatSystem).
 */
export function viewmodelAnimationSystem(
  viewmodel: ViewmodelRenderer,
  playerEid: number,
  dt: number,
  weaponIdToName: string[],
): void {
  if (!viewmodel.visible) return;

  // ── Read combat state from ECS ──
  const combatState = CombatStateComp.state[playerEid] as CombatState;
  const direction = CombatStateComp.direction[playerEid];
  const phaseT = CombatStateComp.phaseT[playerEid];
  const phaseElapsed = CombatStateComp.phaseElapsed[playerEid];
  const phaseTotal = CombatStateComp.phaseTotal[playerEid];
  const weaponId = CombatStateComp.weaponId[playerEid];

  // ── Map weapon ID to name ──
  const weaponName = (weaponIdToName[weaponId] ?? 'Longsword') as WeaponName;

  // ── Look up target pose (non-Release states use keyframe poses) ──
  const targetPose = getViewmodelPose(weaponName, combatState, direction);

  // ── Per-entity blend state ──
  const entityState = getOrCreateEntityState(playerEid);
  entityState.elapsedTime += dt;

  // ── Detect state/direction transitions, snapshot prev bones ──
  const stateChanged =
    combatState !== entityState.prevState ||
    direction !== entityState.prevDirection;

  if (stateChanged) {
    // Snapshot every animatable bone's current quaternion. Same pattern
    // as `AnimationSystem.ts` — cost is 3 Quaternion clones (arm bones
    // only, weapon_attach is owned by grip data + skipped).
    const snapshot: Record<string, THREE.Quaternion> = {};
    for (const boneName of VIEWMODEL_COMBAT_BONES) {
      const bone = viewmodel.bones[boneName];
      if (bone) snapshot[boneName] = bone.quaternion.clone();
    }
    prevPoseSnapshots.set(playerEid, snapshot);
    entityState.crossfadeT = 0;
    entityState.prevState = combatState;
    entityState.prevDirection = direction;
    // Anchor the ease curve to the phase length at entry — a combo buffered
    // mid-Recovery (#190) shrinks phaseTotal in place; anchoring keeps the
    // curve monotonic so the FP rig doesn't pop and stays in lockstep with
    // AnimationSystem (BladeTimingParity). See `anchoredPhaseT`.
    entityState.blendPhaseTotal = phaseTotal;
  }

  // Lazy-init empty snapshot on first sight so applyPoseLayer's missing-bone
  // path slerps from identity (rest pose) on tick 1.
  let prevSnapshot = prevPoseSnapshots.get(playerEid);
  if (!prevSnapshot) {
    prevSnapshot = {};
    prevPoseSnapshots.set(playerEid, prevSnapshot);
  }

  // ── Crossfade timer ──
  entityState.crossfadeT = Math.min(
    1,
    entityState.crossfadeT + dt / crossfadeDurationFor(combatState),
  );
  const crossfadeT = entityState.crossfadeT;

  // ── Apply pose via shared `applyPoseLayer` ──
  //
  // Release: hybrid like AnimationSystem.ts §9 step 7. Arc swing for the
  // right-arm bones; ViewmodelAnimationData's `release` entry is no longer
  // consulted during Release. crossfadeT-only blend (NOT max(phaseT,
  // crossfadeT)) because the arc target moves with phaseT — see
  // `docs/animation-architecture.md` §4 and `AnimationSystem.ts:431` for
  // the double-blending rationale.
  if (combatState === CombatState.Release) {
    const arcPose = computeArcSwingPose(direction, weaponName, phaseT);

    // Adapt arc-pose bone names to the viewmodel rig (#132):
    // The arc returns { shoulder_R, forearm_R, hand_R, spine? }. The FP rig
    // pivots from `upper_arm_R` directly (no shoulder bone above it), so we
    // remap `shoulder_R` → `upper_arm_R`. `spine` is dropped — the FP
    // viewmodel has no torso. This is the canonical viewmodel-rig adapter;
    // it lives at the call site rather than in `arcSwing.ts` because the
    // arc itself is rig-agnostic (the third-person system reads it
    // verbatim — see `AnimationSystem.ts:432`).
    const adaptedPose = adaptArcPoseForViewmodel(arcPose);

    const arcEasedT = smoothstepEase(crossfadeT);
    applyPoseLayer(
      viewmodel.bones,
      prevSnapshot,
      adaptedPose,
      arcEasedT,
      VIEWMODEL_COMBAT_BONES,
    );
  } else {
    // Pure keyframe slerp — Idle, Windup, Recovery, Blocking, Parry, HitStun.
    // Per-state time curves via combatPhaseBlend (#goal-2026-07 fluidity
    // pass): Windup draws across its WHOLE phase, Recovery follows through
    // past guard and settles; reactive states keep the crossfade race.
    // Mirrors AnimationSystem's combat layer exactly so FP and TP stay in
    // lockstep (BladeTimingParity).
    // Phase progress anchored to the ENTRY total (`blendPhaseTotal`), not the
    // live phaseTotal — see AnimationSystem / anchoredPhaseT. Keeps a
    // combo-buffered mid-Recovery shrink (#190) from popping the arm. Falls
    // back to raw phaseT when no phase length is available (phaseTotal 0 —
    // reactive states), matching AnimationSystem exactly for FP/TP lockstep.
    const anchorTotal = entityState.blendPhaseTotal || phaseTotal;
    const blendPhaseT =
      anchorTotal > 0 ? anchoredPhaseT(phaseElapsed, anchorTotal) : phaseT;
    const effectiveT = combatPhaseBlend(combatState, blendPhaseT, crossfadeT);
    applyPoseLayer(
      viewmodel.bones,
      prevSnapshot,
      targetPose,
      effectiveT,
      VIEWMODEL_COMBAT_BONES,
    );
  }

  // ── Idle sway / breathing (doc §5) ──
  //
  // Multi-bone, mutually-prime sinusoids LAYERED ON TOP of the slerp via
  // post-multiply. Channel definitions live in `ViewmodelTuning.ts` so QA
  // can tune the feel without spelunking through render code. Frequencies
  // (0.27, 0.31, 0.35, 0.40 Hz) are mutually prime in the sub-Hz range —
  // composite motion never visibly repeats. Amplitudes are <0.015 rad (≈ <1°).
  //
  // Gated to Idle ONLY: combat poses already animate the arm and stacking
  // sway on top would fight them (see doc §5.2 — "applies only when
  // combatState === Idle"). Channels for non-existent bones are silently
  // skipped so the system stays robust if the bone hierarchy gains/loses
  // bones in a future PR.
  if (combatState === CombatState.Idle) {
    for (let i = 0; i < IDLE_SWAY_CHANNELS.length; i++) {
      const ch = IDLE_SWAY_CHANNELS[i];
      const bone = viewmodel.bones[ch.bone];
      if (!bone) continue;
      const angle =
        Math.sin(entityState.elapsedTime * 2 * Math.PI * ch.freq + ch.phase) *
        ch.amplitude;
      // Single-axis Euler — set the matching axis and zero the others. This
      // avoids overwriting the bone's existing rotation: post-multiply layers
      // onto whatever the slerp produced.
      const x = ch.axis === 'x' ? angle : 0;
      const y = ch.axis === 'y' ? angle : 0;
      const z = ch.axis === 'z' ? angle : 0;
      _euler.set(x, y, z, 'XYZ');
      _swayQuat.setFromEuler(_euler);
      bone.quaternion.multiply(_swayQuat);
    }
  }
}

/**
 * Reset viewmodel animation state for tests and entity teardown.
 *
 * Clears both the per-entity blend state map AND the snapshot side-table,
 * so the next call treats every entity as freshly seen.
 */
export function resetViewmodelAnimationSystem(): void {
  entityStates.clear();
  prevPoseSnapshots.clear();
}
