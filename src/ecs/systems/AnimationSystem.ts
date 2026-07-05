/**
 * Procedural Animation System — third-person rebuild (issue #128).
 *
 * Implements §9 of `docs/animation-architecture.md`:
 *   1. Read the read-model (`CombatStateComp`, `MovementState`).
 *   2. On state OR direction change, snapshot every bone's current
 *      quaternion into a per-entity side-table.
 *   3. Ramp `crossfadeT` (0 → 1 over CROSSFADE_DURATION_SEC).
 *   4. Compute layer ownership — exactly one layer writes each bone
 *      per tick (no double-writes on spine or shoulders).
 *   5. Apply the lower-body procedural walk/run cycle (or movement
 *      basePose).
 *   6. Apply the idle arm-swing when Idle && moving.
 *   7. Apply the upper-body combat pose. Release uses the arc-driven
 *      swing (`arcSwing.ts`); other states use keyframe slerp.
 *   8. Apply the hit-react lean overlay during HitStun.
 *   9. Apply the idle breathing sway.
 *
 * Variable-rate; runs in `update(dt)` after combat/movement systems
 * have populated the read-model on the most recent fixed tick.
 *
 * Read-only contract: this system mutates ONLY bone quaternions and
 * `AnimationComp` fields (`crossfadeT`, `walkCycle`, `prevCombatState`,
 * `prevDirection`, `movementState`). It NEVER touches `CombatStateComp`,
 * `CombatStateComponent`, `MovementState`, the FSM, or any non-animation
 * component.
 */

import * as THREE from 'three';
import { defineQuery, hasComponent } from 'bitecs';
import {
  CharacterModel,
  CombatStateComp,
  AnimationComp,
  HitReactComp,
  MovementState,
  Rotation,
  meshRegistry,
} from '../components';
import {
  CombatState,
  MovementState as MovementStateEnum,
} from '../../combat/states';
import {
  getCombatPose,
  getMovementParams,
  LOWER_BODY_BONES,
  UPPER_BODY_BONES_EXCEPT_SPINE,
  type Pose,
} from '../../animation/AnimationData';
import {
  applyPoseLayer,
  smoothstepEase,
  combatPhaseBlend,
  crossfadeDurationFor,
  anchoredPhaseT,
} from '../../animation/poseBlending';
import {
  computeArcSwingPose,
  ARC_SWING_OWNED_BONES,
  type WeaponName,
} from '../../animation/arcSwing';
import { weaponIdToName } from './CombatSystem';
import { applyHitReactLean } from '../../animation/hitReact';
import { getCurrentFixedTick } from '../../core/tickCounter';
import type { GameWorld } from '../../core/types';

// ── Constants ────────────────────────────────────────────

/** speedFactor below this threshold is treated as "not moving". */
const IDLE_SPEED_FACTOR_THRESHOLD = 0.05;

/** speedFactor above this threshold is treated as running (vs walking). */
const RUN_SPEED_FACTOR_THRESHOLD = 0.85;

/** Subtle idle breathing — amplitude (radians) and frequency (Hz). */
const BREATH_AMPLITUDE = 0.008;
const BREATH_FREQUENCY = 0.4;

/**
 * Max chest lean from aim pitch during attack states (radians, ~34°).
 * Enough to move a spear thrust from head height to shins at reach;
 * clamped so a straight-down camera doesn't fold the model in half.
 */
const PITCH_AIM_MAX_RAD = 0.6;

// ── Pre-computed bone subsets ────────────────────────────

/** Just `spine` — used when checking ownership. */
const SPINE_SET: ReadonlySet<string> = new Set(['spine']);

/** Idle-walk arm-swing owned bones (counter-swing of the gait cycle). */
const SHOULDERS_SET: ReadonlySet<string> = new Set([
  'shoulder_L',
  'shoulder_R',
]);

// ── Side-tables (per-entity, non-numeric data) ───────────

/**
 * Per-entity snapshot of bone quaternions captured at the moment of the
 * last state/direction change. The §4 keyframe rule slerps from this
 * snapshot toward the target pose by `easedT` — fixing the buggy
 * "slerp from live bone state" behavior in the legacy system.
 *
 * Module-level Map (matches the `meshRegistry`/`fsmRegistry` pattern).
 * Will move onto `GameWorld` if multi-world ever lands.
 */
export const prevPoseSnapshots = new Map<
  number,
  Record<string, THREE.Quaternion>
>();

// ── Query ────────────────────────────────────────────────

const animatedQuery = defineQuery([
  CharacterModel,
  CombatStateComp,
  AnimationComp,
]);

// ── Reusable temp objects (avoid GC pressure) ────────────

const _euler = new THREE.Euler();
const _swayQuat = new THREE.Quaternion();

// ── Module-level state ───────────────────────────────────

/** Elapsed time accumulator for breathing animation. */
let _elapsedTime = 0;

// ── Helpers ──────────────────────────────────────────────

/**
 * Map `MovementState` ECS-component flags to the pose-data movement
 * key used by `getMovementParams`. Always returns one of:
 * `'idle' | 'walk' | 'run' | 'jump' | 'crouch'`.
 */
function movementKeyFromState(
  speedFactor: number,
  isGrounded: boolean,
  isCrouching: boolean,
): 'idle' | 'walk' | 'run' | 'jump' | 'crouch' {
  if (!isGrounded) return 'jump';
  if (isCrouching) return 'crouch';
  if (speedFactor <= IDLE_SPEED_FACTOR_THRESHOLD) return 'idle';
  if (speedFactor >= RUN_SPEED_FACTOR_THRESHOLD) return 'run';
  return 'walk';
}

/** Map a movement key back to the legacy `MovementState` enum (HUD/debug). */
function movementKeyToEnum(key: string): MovementStateEnum {
  switch (key) {
    case 'walk':
      return MovementStateEnum.Walking;
    case 'run':
      return MovementStateEnum.Running;
    case 'jump':
      return MovementStateEnum.Jumping;
    case 'crouch':
      return MovementStateEnum.Crouching;
    default:
      return MovementStateEnum.Idle;
  }
}

/**
 * Apply the procedural walk/run cycle to legs (and optionally hips/spine
 * if owned). Bones outside `ownedBoneSet` are NOT touched, so this can
 * coexist with combat layers writing other bones in the same tick.
 *
 * Direct quaternion writes (not slerps from snapshot) — the cycle is a
 * pure procedural function of `walkCycle` and the bone is the only
 * writer this tick.
 */
function applyWalkCycle(
  bones: Record<string, THREE.Bone>,
  walkCycle: number,
  legSwing: number,
  ownedBoneSet: ReadonlySet<string>,
): void {
  const sinPhase = Math.sin(walkCycle);

  // Legs: alternating thigh swing
  const legBones: Array<[string, string, number]> = [
    ['thigh_L', 'shin_L', sinPhase],
    ['thigh_R', 'shin_R', -sinPhase],
  ];

  for (const [thighName, shinName, phase] of legBones) {
    if (ownedBoneSet.has(thighName)) {
      const thigh = bones[thighName];
      if (thigh) {
        _euler.set(phase * legSwing, 0, 0, 'XYZ');
        thigh.quaternion.setFromEuler(_euler);
      }
    }
    if (ownedBoneSet.has(shinName)) {
      const shin = bones[shinName];
      if (shin) {
        const shinBend = Math.max(0, phase) * legSwing * 0.8;
        _euler.set(shinBend, 0, 0, 'XYZ');
        shin.quaternion.setFromEuler(_euler);
      }
    }
  }

  // Feet snap to rest if owned (no foot animation in v1).
  for (const footName of ['foot_L', 'foot_R']) {
    if (ownedBoneSet.has(footName)) {
      const foot = bones[footName];
      if (foot) foot.quaternion.identity();
    }
  }
}

/**
 * Compute the idle arm-swing pose — counter-swing on the shoulders that
 * matches the gait cycle. Returns a `Pose` so it can be slerped into the
 * arms via `applyPoseLayer` (so it crossfades smoothly when entering
 * Idle from a combat state).
 */
function computeIdleArmSwingPose(walkCycle: number, armSwing: number): Pose {
  const sinPhase = Math.sin(walkCycle);
  return {
    shoulder_L: { x: -sinPhase * armSwing },
    shoulder_R: { x: sinPhase * armSwing },
  };
}

/**
 * Compute layer ownership for one tick per §5 of the spec.
 * Returns `{ movementOwned, combatOwned }` such that no bone is in both
 * sets and every animatable bone is owned by at most one layer.
 */
function computeOwnership(
  state: CombatState,
  isMoving: boolean,
  movementBasePose: Pose,
  combatPose: Pose | null,
): { movementOwned: Set<string>; combatOwned: Set<string> } {
  const movementOwned = new Set<string>(LOWER_BODY_BONES);

  // Idle-walk: shoulders counter-swing with the gait.
  if (state === CombatState.Idle && isMoving) {
    movementOwned.add('shoulder_L');
    movementOwned.add('shoulder_R');
  }

  // Spine precedence: combat first, else movement if its base pose
  // touches spine, else rest (no owner).
  const combatWantsSpine = combatPose !== null && 'spine' in combatPose;
  const movementWantsSpine = 'spine' in movementBasePose;
  if (movementWantsSpine && !combatWantsSpine) {
    movementOwned.add('spine');
  }

  const combatOwned = new Set<string>();
  if (combatPose !== null) {
    for (const b of UPPER_BODY_BONES_EXCEPT_SPINE) combatOwned.add(b);
    if (combatWantsSpine) combatOwned.add('spine');
    // Strip anything movement already claimed.
    for (const b of movementOwned) combatOwned.delete(b);
  }

  return { movementOwned, combatOwned };
}

/**
 * Compute the intersection of two bone sets. Allocates a new Set each
 * call — used in the per-tick layer routing where the cost is amortized
 * over a small number of bones.
 */
function intersectBones(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): Set<string> {
  const result = new Set<string>();
  for (const name of a) if (b.has(name)) result.add(name);
  return result;
}

/**
 * Compute `a \ b`. Allocates a new Set each call (same justification).
 */
function subtractBones(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): Set<string> {
  const result = new Set<string>();
  for (const name of a) if (!b.has(name)) result.add(name);
  return result;
}

// ── Main System ──────────────────────────────────────────

/**
 * Animation system — call in `update(dt)` for smooth variable-rate
 * blending. Reads the read-model populated by combat/movement systems
 * during fixedUpdate and writes bone quaternions only.
 */
export function animationSystem(world: GameWorld, dt: number): void {
  _elapsedTime += dt;
  const entities = animatedQuery(world.ecs);

  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    const modelData = meshRegistry.get(CharacterModel.id[eid]);
    if (!modelData) continue;
    const { bones } = modelData;

    // ── 1. Read read-model ──
    const state = CombatStateComp.state[eid] as CombatState;
    const direction = CombatStateComp.direction[eid];
    const phaseT = CombatStateComp.phaseT[eid];
    const phaseElapsed = CombatStateComp.phaseElapsed[eid];
    const phaseTotal = CombatStateComp.phaseTotal[eid];

    // Defensive: not every animatable entity has `MovementState` (dummies
    // don't — only `createPlayer` adds it). For those, default to
    // "stationary, grounded, not crouching" — the natural idle pose.
    //
    // The bitECS slot polarity matters here: `MovementState.grounded === 1`
    // means "on the ground" (see MovementSystem.ts), so reading the raw
    // TypedArray slot for an entity without the component gives 0 = airborne.
    // We must explicitly default to grounded when the component is absent;
    // otherwise dummies render in mid-jump pose every frame.
    //
    // Bonus: also handles the player's first-frame airborne state, where
    // `createPlayer.ts` initializes `grounded = 0` before MovementSystem ticks.
    const hasMovement = hasComponent(world.ecs, MovementState, eid);
    const speedFactor = hasMovement ? MovementState.speedFactor[eid] : 0;
    const isCrouching = hasMovement && MovementState.crouching[eid] === 1;
    const isGrounded = !hasMovement || MovementState.grounded[eid] === 1;

    // ── 2. State-change snapshot ──
    const prevState = AnimationComp.prevCombatState[eid] as CombatState;
    const prevDir = AnimationComp.prevDirection[eid];
    const stateChanged = state !== prevState || direction !== prevDir;

    if (stateChanged) {
      // Snapshot ALL bones — we don't yet know which ones will be owned,
      // and the cost is one Quaternion clone per bone (~17 bones).
      const snapshot: Record<string, THREE.Quaternion> = {};
      for (const boneName in bones) {
        snapshot[boneName] = bones[boneName].quaternion.clone();
      }
      prevPoseSnapshots.set(eid, snapshot);
      AnimationComp.crossfadeT[eid] = 0;
      AnimationComp.prevCombatState[eid] = state;
      AnimationComp.prevDirection[eid] = direction;
      // Anchor the combat ease curve to the phase length AT ENTRY. A combo
      // buffered mid-Recovery (`CombatFSM._handleAttack`, #190) shrinks
      // `phaseTotal` in place with no state change; anchoring here means the
      // curve keeps using the entry total and never jumps. See `anchoredPhaseT`.
      AnimationComp.blendPhaseTotal[eid] = phaseTotal;
    }

    // First sight: lazy-initialize an empty snapshot so the first frame's
    // slerp source is identity (rest pose) — matches the behavior of a
    // never-poised character.
    let prevSnapshot = prevPoseSnapshots.get(eid);
    if (!prevSnapshot) {
      prevSnapshot = {};
      prevPoseSnapshots.set(eid, prevSnapshot);
    }

    // ── 3. Crossfade timer ──
    let crossfadeT = AnimationComp.crossfadeT[eid];
    crossfadeT = Math.min(1, crossfadeT + dt / crossfadeDurationFor(state));
    AnimationComp.crossfadeT[eid] = crossfadeT;
    const effectiveT = smoothstepEase(Math.max(phaseT, crossfadeT));
    // Combat layers get per-state time curves (full-duration windup draw,
    // follow-through recovery) — see combatPhaseBlend. Movement layers
    // keep the crossfade-raced effectiveT: legs settling into a stance
    // SHOULD snap in 80ms regardless of the combat phase length.
    //
    // Drive the combat curve off phase progress anchored to the ENTRY total
    // (`blendPhaseTotal`), not the live phaseTotal — this is what keeps a
    // combo-buffered mid-Recovery shrink (#190) from popping the arm: the
    // curve stays monotonic instead of jumping when the FSM redefines
    // phaseTotal mid-phase. For the no-shrink case blendPhaseTotal ===
    // phaseTotal, so this equals the raw phaseT. The `|| phaseTotal` guards a
    // never-anchored entity (first observed mid-phase); when no phase length
    // is available at all (phaseTotal 0 — the reactive Idle/Blocking states,
    // where the FSM's phaseT is 0 too) we fall back to the raw phaseT.
    const anchorTotal = AnimationComp.blendPhaseTotal[eid] || phaseTotal;
    const blendPhaseT =
      anchorTotal > 0 ? anchoredPhaseT(phaseElapsed, anchorTotal) : phaseT;
    const combatBlendT = combatPhaseBlend(state, blendPhaseT, crossfadeT);

    // ── 4. Layer ownership ──
    const movKey = movementKeyFromState(speedFactor, isGrounded, isCrouching);
    const movParams = getMovementParams(movKey);
    // The combat layer is always active in the upper-body sense — Idle
    // returns IDLE_POSE (the "ready stance" sword-guard) which the layer
    // stamps onto the arms. The §5 spec note "combat is active when state
    // !== Idle" applies to spine ownership only — see `computeOwnership`.
    const combatPose: Pose = getCombatPose(state, direction);
    const isMoving = speedFactor > IDLE_SPEED_FACTOR_THRESHOLD;

    AnimationComp.movementState[eid] = movementKeyToEnum(movKey);

    const { movementOwned, combatOwned } = computeOwnership(
      state,
      isMoving,
      movParams.basePose,
      combatPose,
    );

    // ── 5. Lower-body procedural ──
    if (movKey === 'walk' || movKey === 'run') {
      let walkCycle = AnimationComp.walkCycle[eid];
      walkCycle += dt * movParams.cycleSpeed * speedFactor;
      if (walkCycle > Math.PI * 2) walkCycle -= Math.PI * 2;
      AnimationComp.walkCycle[eid] = walkCycle;

      const legBones = intersectBones(movementOwned, LOWER_BODY_BONES);
      applyWalkCycle(bones, walkCycle, movParams.legSwing, legBones);
    } else {
      // Idle/crouch/jump base pose into legs (and spine if owned).
      const legBones = intersectBones(movementOwned, LOWER_BODY_BONES);
      applyPoseLayer(
        bones,
        prevSnapshot,
        movParams.basePose,
        effectiveT,
        legBones,
      );
    }

    // Movement layer's spine pass (only if it owns spine — combat may
    // override). Separate pass so leg apply above can stay lean.
    if (movementOwned.has('spine')) {
      applyPoseLayer(
        bones,
        prevSnapshot,
        movParams.basePose,
        effectiveT,
        SPINE_SET,
      );
    }

    // ── 6. Idle arm-swing (only when no combat) ──
    if (state === CombatState.Idle && isMoving && (movKey === 'walk' || movKey === 'run')) {
      const armSwingPose = computeIdleArmSwingPose(
        AnimationComp.walkCycle[eid],
        movParams.armSwing,
      );
      applyPoseLayer(
        bones,
        prevSnapshot,
        armSwingPose,
        effectiveT,
        SHOULDERS_SET,
      );
    }

    // ── 7. Upper-body combat (always — Idle uses IDLE_POSE ready stance) ──
    if (state === CombatState.Release) {
      // Hybrid: arc swing for arm bones; keyframe slerp for the rest.
      // Per-weapon scaling (#132): thread `weaponIdToName[weaponId]` through
      // to the arc so heavier weapons get bigger swings. Unknown weapon IDs
      // (typo / out-of-range / future weapons) fall back to Longsword inside
      // `computeArcSwingPose`. Cast to `WeaponName` is safe — the map is
      // typed `string[]` but every entry is a known WeaponName.
      const weaponId = CombatStateComp.weaponId[eid];
      const weaponName = (weaponIdToName[weaponId] ?? 'Longsword') as WeaponName;
      const arcPose = computeArcSwingPose(direction, weaponName, phaseT);
      const armOwned = intersectBones(combatOwned, ARC_SWING_OWNED_BONES);
      // Arc swing: target moves with phaseT, so we use crossfadeT alone
      // for the slerp blend factor — once the crossfade has ramped up
      // the bone IS exactly on the arc at every phaseT. Using
      // `max(phaseT, crossfadeT)` here would double-blend (target moves
      // AND blend factor moves) and visually drag.
      const arcEasedT = smoothstepEase(crossfadeT);
      applyPoseLayer(bones, prevSnapshot, arcPose, arcEasedT, armOwned);

      // Non-arm combat bones (chest, neck, head, left arm, upper_arm_R,
      // possibly spine) follow the keyframe pose under the standard
      // effectiveT.
      const nonArmCombat = subtractBones(combatOwned, ARC_SWING_OWNED_BONES);
      applyPoseLayer(
        bones,
        prevSnapshot,
        combatPose,
        combatBlendT,
        nonArmCombat,
      );
    } else {
      // Pure keyframe slerp — covers Idle (IDLE_POSE), Windup, Recovery,
      // Blocking, Parry, HitStun. Windup/Recovery ride the per-state time
      // curves (combatPhaseBlend) so the draw fills its whole phase and
      // the recovery follows through past guard before settling.
      applyPoseLayer(
        bones,
        prevSnapshot,
        combatPose,
        combatBlendT,
        combatOwned,
      );
    }

    // ── 7.5 Pitch aim (#goal-2026-07 hit-accuracy pass) ──
    // During attack states, lean the chest by the aim pitch so the swing
    // plane follows the camera vertically — aim at the head, the blade
    // sweeps at head height; aim at the legs, it sweeps low. The tracer
    // and the six body hitboxes read these same bones, so the DAMAGE
    // volume tilts with the visual automatically. Rotation.x is written
    // by MovementSystem for the local player (camera pitch, positive =
    // looking up) and streamed onto remote puppets via the `pitch` field
    // of the state message (RemotePlayers.pushRemoteState); bots leave it 0.
    // Premultiplied AFTER the combat layer so it composes with (rather
    // than fights) the keyframe/arc pose; clamped so full-vertical aim
    // doesn't fold the model in half.
    if (
      state === CombatState.Windup ||
      state === CombatState.Release ||
      state === CombatState.Recovery
    ) {
      const aimPitch = Rotation.x[eid];
      if (aimPitch !== 0) {
        const chestBone = bones['chest'];
        if (chestBone) {
          const lean = Math.max(
            -PITCH_AIM_MAX_RAD,
            Math.min(PITCH_AIM_MAX_RAD, aimPitch),
          );
          // Rotation about +X maps front-of-body points (−Z) upward:
          // y' = y·cos θ + d·sin θ for a point d ahead. So chest X = +pitch
          // raises the swing in front when looking up and drops it when
          // looking down (verified against the tracer debug segments —
          // the naive "negate it" guess tilts the arc the wrong way).
          _euler.set(lean, 0, 0, 'XYZ');
          _swayQuat.setFromEuler(_euler);
          chestBone.quaternion.premultiply(_swayQuat);
        }
      }
    }

    // ── 8. Hit-react overlay (only in HitStun, only when fresh) ──
    if (
      state === CombatState.HitStun &&
      HitReactComp.active[eid] === 1 &&
      HitReactComp.magnitude[eid] > 0
    ) {
      const ticksAlive =
        getCurrentFixedTick() - HitReactComp.spawnedAtTick[eid];
      const durationTicks = HitReactComp.durationTicks[eid];
      const t =
        durationTicks > 0
          ? Math.max(0, Math.min(1, ticksAlive / durationTicks))
          : 0;
      applyHitReactLean(
        bones['spine'] ?? null,
        bones['chest'] ?? null,
        HitReactComp.dirX[eid],
        HitReactComp.dirY[eid],
        HitReactComp.dirZ[eid],
        HitReactComp.magnitude[eid],
        t,
      );
    }

    // ── 9. Idle breathing sway ──
    if (state === CombatState.Idle && movKey === 'idle') {
      const breathSway =
        Math.sin(_elapsedTime * Math.PI * 2 * BREATH_FREQUENCY) *
        BREATH_AMPLITUDE;
      const chestBone = bones['chest'];
      if (chestBone) {
        _euler.set(breathSway, 0, breathSway * 0.5, 'XYZ');
        _swayQuat.setFromEuler(_euler);
        chestBone.quaternion.multiply(_swayQuat);
      }
    }

  }
}

/**
 * Reset the animation system's module-level state (elapsed time +
 * per-entity snapshots). Called by tests for deterministic state.
 */
export function resetAnimationSystem(): void {
  _elapsedTime = 0;
  prevPoseSnapshots.clear();
}
