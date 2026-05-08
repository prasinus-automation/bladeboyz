# Animation Architecture — Third-Person Rebuild Spec

**Status**: Architect spec, ready for implementation.
**Tracks**: Issue #110 (this doc), parent #89 (third-person animation rebuild).
**Sibling implementation issues**: B (FSM phase-t API), C (`AnimationSystem` rebuild), D (pose data + viewmodel sync).
**Depends on**: #88 Combat FSM v2 (state list and 4-direction enum).

This document is the **contract** that the rebuild PRs implement. No runtime
code changes belong in #110 — only this doc and the AGENTS.md cross-reference.

The diagnosis of what's broken in the current system lives in §10 (Migration
notes). The rest of the doc describes what to build.

---

## 1. Skeleton bone graph

The bone hierarchy is defined in `src/rendering/CharacterModel.ts`. The header
comment at lines 10-28 of that file is **wrong** — it claims thighs hang under
`chest`, but the code at lines 124, 134 (`makeBone('thigh_L', spine)`,
`makeBone('thigh_R', spine)`) parents thighs to `spine`. **Trust code, not the
comment.** The correct hierarchy:

```
root                            (0, 0, 0)
└─ spine                        (0, THIGH+SHIN+FOOT_H, 0)         hip height
   ├─ chest                     (0, TORSO_H * 0.5, 0)
   │  ├─ neck                   (0, TORSO_H * 0.5, 0)
   │  │  └─ head                (0, NECK_LEN, 0)
   │  ├─ shoulder_L             (-(TORSO_W/2 + LIMB_THICK/2), TORSO_H*0.45, 0)
   │  │  └─ upper_arm_L         (0, -UPPER_ARM_LEN/2, 0)
   │  │     └─ forearm_L        (0, -UPPER_ARM_LEN/2, 0)
   │  │        └─ hand_L        (0, -FOREARM_LEN, 0)
   │  └─ shoulder_R             (TORSO_W/2 + LIMB_THICK/2, TORSO_H*0.45, 0)
   │     └─ upper_arm_R         (0, -UPPER_ARM_LEN/2, 0)
   │        └─ forearm_R        (0, -UPPER_ARM_LEN/2, 0)
   │           └─ hand_R        (0, -FOREARM_LEN, 0)
   │              └─ weapon_attach   (0, -HAND_SIZE/2, 0); rotation.x = π
   ├─ thigh_L                   (-0.1, 0, 0)
   │  └─ shin_L                 (0, -THIGH_LEN, 0)
   │     └─ foot_L              (0, -SHIN_LEN, 0)
   └─ thigh_R                   (0.1, 0, 0)
      └─ shin_R                 (0, -THIGH_LEN, 0)
         └─ foot_R              (0, -SHIN_LEN, 0)
```

Per-bone summary (constants from `CharacterModel.ts:31-43`):

| Bone           | Parent       | Local rest-pose offset                                  | Rest Euler   |
|----------------|--------------|---------------------------------------------------------|--------------|
| `root`         | (group)      | `(0, 0, 0)` — feet                                     | `(0,0,0)`    |
| `spine`        | `root`       | `(0, THIGH_LEN + SHIN_LEN + FOOT_H, 0)` ≈ `(0, 0.86, 0)` | `(0,0,0)` |
| `chest`        | `spine`      | `(0, TORSO_H * 0.5, 0)` = `(0, 0.25, 0)`               | `(0,0,0)`    |
| `neck`         | `chest`      | `(0, TORSO_H * 0.5, 0)` = `(0, 0.25, 0)`               | `(0,0,0)`    |
| `head`         | `neck`       | `(0, NECK_LEN, 0)` = `(0, 0.08, 0)`                    | `(0,0,0)`    |
| `shoulder_L`   | `chest`      | `(-(TORSO_W/2 + LIMB_THICK/2), TORSO_H*0.45, 0)` = `(-0.285, 0.225, 0)` | `(0,0,0)` |
| `upper_arm_L`  | `shoulder_L` | `(0, -UPPER_ARM_LEN/2, 0)` = `(0, -0.14, 0)`           | `(0,0,0)`    |
| `forearm_L`    | `upper_arm_L`| `(0, -UPPER_ARM_LEN/2, 0)` = `(0, -0.14, 0)`           | `(0,0,0)`    |
| `hand_L`       | `forearm_L`  | `(0, -FOREARM_LEN, 0)` = `(0, -0.26, 0)`               | `(0,0,0)`    |
| `shoulder_R`   | `chest`      | `(TORSO_W/2 + LIMB_THICK/2, TORSO_H*0.45, 0)` = `(0.285, 0.225, 0)` | `(0,0,0)` |
| `upper_arm_R`  | `shoulder_R` | `(0, -UPPER_ARM_LEN/2, 0)` = `(0, -0.14, 0)`           | `(0,0,0)`    |
| `forearm_R`    | `upper_arm_R`| `(0, -UPPER_ARM_LEN/2, 0)` = `(0, -0.14, 0)`           | `(0,0,0)`    |
| `hand_R`       | `forearm_R`  | `(0, -FOREARM_LEN, 0)` = `(0, -0.26, 0)`               | `(0,0,0)`    |
| `weapon_attach`| `hand_R`     | `(0, -HAND_SIZE/2, 0)` = `(0, -0.05, 0)`               | `(π, 0, 0)`  |
| `thigh_L`      | `spine`      | `(-0.1, 0, 0)`                                          | `(0,0,0)`    |
| `shin_L`       | `thigh_L`    | `(0, -THIGH_LEN, 0)` = `(0, -0.4, 0)`                  | `(0,0,0)`    |
| `foot_L`       | `shin_L`     | `(0, -SHIN_LEN, 0)` = `(0, -0.38, 0)`                  | `(0,0,0)`    |
| `thigh_R`      | `spine`      | `(0.1, 0, 0)`                                           | `(0,0,0)`    |
| `shin_R`       | `thigh_R`    | `(0, -THIGH_LEN, 0)` = `(0, -0.4, 0)`                  | `(0,0,0)`    |
| `foot_R`       | `shin_R`     | `(0, -SHIN_LEN, 0)` = `(0, -0.38, 0)`                  | `(0,0,0)`    |

Note: `weapon_attach` has `rotation.x = Math.PI` in third-person (flips +Y to
point outward from the hand). This is **different from the viewmodel**, where
`vm_weapon_attach` is rotated `Math.PI * 0.85` for a slightly forward grip
(see `ViewmodelRenderer.ts` and AGENTS.md "First-Person Viewmodel").

---

## 2. Rest pose convention

### World axes

- **+Y up, -Z forward, +X right** — Three.js standard, confirmed by
  `MovementSystem.ts:131-133`:
  ```ts
  // Forward is -Z in Three.js convention
  moveX = strafe * cosYaw - forward * sinYaw;
  moveZ = -strafe * sinYaw - forward * cosYaw;
  ```
- Yaw = 0 looks down `-Z`.

### Bone-local rest semantics

Limbs hang along **-Y** at rest (every limb's child offset has a negative Y
component). The standard "raise arm forward in front of body" motion is a
**negative X rotation** of `upper_arm_R` (rotates the local -Y down-axis
toward -Z forward). The standard "elbow bend" is a **negative X rotation**
of `forearm_R` (folding the forearm back up toward the shoulder).

Per-bone neutral:

| Bone              | Rest semantic                                                    |
|-------------------|------------------------------------------------------------------|
| `spine`           | torso vertical, hips at `y ≈ 0.86`                              |
| `chest`           | upper torso vertical, no twist                                   |
| `neck`            | head straight up                                                  |
| `head`            | facing forward (-Z)                                              |
| `shoulder_L/R`    | clavicle horizontal, no shrug                                    |
| `upper_arm_L/R`   | arm hangs straight down at the side                              |
| `forearm_L/R`     | elbow extended (forearm continues straight down)                 |
| `hand_L/R`        | palm facing inward toward thigh                                  |
| `weapon_attach`   | weapon grip points up out of the hand (after the `π` flip applied at rest) |
| `thigh_L/R`       | leg straight down                                                |
| `shin_L/R`        | knee extended                                                    |
| `foot_L/R`        | sole flat on ground (slight +Z geom offset for toe forward)      |

### Pose deltas

All keyframe poses (`Pose` / `BoneRotation` in `src/animation/AnimationData.ts`)
are expressed as **deltas from rest**, in **Euler XYZ radians**:

```ts
export interface BoneRotation {
  x?: number;
  y?: number;
  z?: number;
}
export type Pose = Record<string, BoneRotation>;
```

A bone omitted from a `Pose` object means "no opinion" — the layered
composition rule (§5) determines whether the layer that owns that bone leaves
it at rest or hands ownership to a different layer. Crucially, "no opinion"
must NOT mean "slerp toward identity" if another layer owns the bone — that
is the bug fixed in §5.

Euler order is **XYZ**, matching `AnimationSystem.ts:66`:
`_euler.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0, 'XYZ')`. The rebuild keeps
this order (changing it would invalidate every existing pose).

---

## 3. Animation read-model component

**The animation systems read from `CombatStateComp`** (the animation-facing
mirror). They do **not** read from `CombatStateComponent` (the FSM mirror).
They never write to either.

After issue #B lands, `CombatStateComp` gains one new field:

```ts
export const CombatStateComp = defineComponent({
  state:         Types.ui8,    // CombatState enum value
  direction:     Types.ui8,    // attack OR block direction (context-dependent)
  phaseElapsed:  Types.ui16,   // ticks since entering current state
  phaseTotal:    Types.ui16,   // total ticks for current state, 0 if no fixed duration
  weaponId:     Types.ui8,
  // NEW (added in #B):
  phaseT:        Types.f32,    // CombatFSM.getPhaseT() result, in [0, 1]
});
```

`phaseT` semantics:

- `CombatSystem` writes `phaseT = fsm.getPhaseT()` once per fixed tick after
  ticking the FSM. Computed as `1 - (ticksRemaining / phaseTotal)` clamped to
  `[0, 1]`. For states with no fixed duration (`Idle`, `Blocking`),
  `getPhaseT()` returns `0`.
- The animation systems read `phaseT` directly. They no longer need to
  recompute `phaseElapsed * FIXED_TIMESTEP / (phaseTotal * FIXED_TIMESTEP)` —
  that math is now inside the FSM where it belongs.
- `phaseElapsed` and `phaseTotal` stay for tick-precise consumers
  (DirectionIndicator's parry-window text, future server-side replay
  validation). Animation reads `phaseT` only.

`CombatStateComponent` (the FSM mirror) remains the source for `weaponId` /
`attackDirection` / `blockDirection` writes by `CombatSystem`. Animation does
not write to either component. **Read-only contract** (§6).

**Long-term recommendation (out of scope for this rebuild)**: unify
`CombatStateComp` and `CombatStateComponent` into a single `CombatState`
component, as proposed in `docs/combat-fsm-v2.md` §9. The animation rebuild
must work with the current dual-component shape; the unification can land
later without forcing another animation rewrite. When it does, the rebuild's
read-model just changes from `CombatStateComp.*` to `CombatState.*` — every
field used here exists on the unified component.

---

## 4. Hybrid pose strategy

Two pose sources, picked per state:

### Keyframe slerp (Idle, Blocking, Parry, HitStun, Windup, Recovery)

For all non-attack states, plus attack `Windup` and `Recovery` phases:

```
let prevPose = stateChangeSnapshot[eid][boneName]   // captured at instant of state change
let targetPose = getCombatPose(state, direction)
let easedT = smoothstep(phaseT)                     // C¹ continuous ease-in-out
let q = slerp(prevPose, targetPose, easedT)
bone.quaternion.copy(q)
```

`smoothstep(t) = t * t * (3 - 2 * t)` (cubic Hermite), mapped over the
already-clamped `[0, 1]` of `phaseT`. Smoothstep is enough for MVP — no need
for cubic-bezier weapon-specific easing in v1.

**`prevPose` is captured at the instant the state changes** (a one-time
snapshot per transition), NOT the live bone rotation each frame. This is the
single most important correctness rule of the rebuild — it produces proper
phase-progress motion from "what the body was doing" toward "what the state
wants" instead of the exponential settling toward target produced by the
current `bone.quaternion.slerp(_targetQuat, blendFactor)` pattern at
`AnimationSystem.ts:122`.

Snapshot captured per bone (each bone's quaternion at transition time), keyed
by entity id. Stored in a side-table; the snapshot is replaced (not blended
in) on every state change. See §9 pseudo-code.

For states with no fixed duration (`Idle`, `Blocking`), `phaseT` stays at
0 — but the *crossfade* still needs to drive the pose to the new target.
Pseudo-code in §9 reconciles this: the **crossfade** drives `easedT` for
no-duration states; `phaseT` drives it for fixed-duration states; whichever
is greater wins (matches the existing `Math.max(phaseBlend, upperBlend)`
pattern at `AnimationSystem.ts:233`).

### Arc-driven swing (Release only)

`Release` is the visually expressive moment of an attack. Slerping between
two static poses produces a "porridge" arc that doesn't read as a swing.
Replace it with **explicit arc motion** parameterized per direction × weapon.

```ts
interface ArcSwingParams {
  /** Bone whose rotation drives the swing */
  swingBone: 'shoulder_R' | 'upper_arm_R';
  /** Local axis the swing rotates around (rest-frame) */
  planeAxis: 'x' | 'y' | 'z';
  /** Rotation at phaseT = 0 (start of release), radians */
  startAngle: number;
  /** Rotation at phaseT = 1 (end of release), radians */
  endAngle: number;
  /** Forearm extension curve — peak extension reached at peakT */
  forearm: {
    /** Local axis for forearm extension (always 'x' — elbow flex) */
    /** Forearm angle at phaseT = 0 */
    startAngle: number;
    /** Forearm angle at phaseT = 1 */
    endAngle: number;
    /** Where in [0,1] the forearm hits its mid-swing extension */
    peakT: number;
    /** Rotation at peakT — usually closer to 0 (extended) than start/end */
    peakAngle: number;
  };
  /** Wrist rotation across the swing (hand_R) — optional */
  wristTwist?: { startZ: number; endZ: number };
  /** For Stab only: forward translation in addition to rotation */
  thrustTranslation?: { startZ: number; endZ: number };
}
```

Direction conventions (rest-frame axes):

| Direction  | swingBone     | planeAxis | startAngle (rad)  | endAngle (rad)    | Notes                                              |
|------------|---------------|-----------|-------------------|-------------------|----------------------------------------------------|
| `Overhead` | `upper_arm_R` | `x`       | `-110° → -120°`   | `-20° → -30°`     | Arm chops down — large negative-X rotation closes |
| `Left`     | `shoulder_R`  | `z`       | `-50° → -60°`     | `+40° → +50°`     | Right shoulder pulls away then sweeps left across |
| `Right`    | `shoulder_R`  | `z`       | `+50° → +60°`     | `-40° → -50°`     | Mirror of Left                                     |
| `Stab`     | `upper_arm_R` | `x`       | `-50°`            | `-65°`            | Mostly translation, small rotation; uses `thrustTranslation` |

Per-weapon overrides multiply each weapon's signature: dagger uses tighter
ranges, battleaxe wider, mace adds `wristTwist` for the rotational follow-
through. Concrete numeric tables go in the pose-data PR (#D), not here.

**Rest-frame axis mapping**: `planeAxis: 'z'` for `Left` and `Right`
swings means the rotation is around the local-Z of the right shoulder.
Because `shoulder_R`'s rest pose is unrotated, local-Z is also world-Z (when
the entity is facing +X). Local rotation around Z swings the arm in the X-Y
plane — that's the right shape for a horizontal slash relative to a body
facing forward.

Pseudo-code per Release tick:

```
t = clamp01(phaseT)
swing.rotation[planeAxis] = lerp(arc.startAngle, arc.endAngle, t)
forearm.rotation.x =
  t < peakT
    ? lerp(forearm.startAngle, forearm.peakAngle,  t / peakT)
    : lerp(forearm.peakAngle,  forearm.endAngle,  (t - peakT) / (1 - peakT))
if (wristTwist) hand.rotation.z = lerp(wristTwist.startZ, wristTwist.endZ, t)
if (thrustTranslation) hand.position.z = lerp(thrust.startZ, thrust.endZ, t)
```

Bones owned by an arc swing in Release: `shoulder_R`, `upper_arm_R`,
`forearm_R`, `hand_R` (and optional translation on `hand_R`'s position). All
four bones are in the upper-body owned set for the duration of `Release`
(§5). The `planeAxis` is the *primary* axis — other axes on `swingBone`
default to 0 during the swing (no fight with leftover Windup pose, because
the snapshot rule of §4-keyframe captured the windup-end pose and the arc
runs from `arc.startAngle` regardless).

**Why this works visually**: the arc gives a clean linear-in-radians sweep
the eye reads as a swing; the forearm peak gives the "snap" mid-strike; the
wrist twist (per weapon) sells follow-through. Slerping between two static
poses cannot produce these because the great-circle interpolation has the
wrong angular profile.

---

## 5. Layered composition

Three pose sources contribute to the final per-tick bone rotations. **Each
bone is owned by exactly one layer per tick.** Layer ownership is computed
into a `Set<string>` before pose application, and only the owning layer
writes the bone's quaternion.

### Layers

1. **Movement (lower-body procedural)**. Always active. Drives `thigh_L/R`,
   `shin_L/R`, `foot_L/R` from the procedural walk/run cycle keyed off
   `MovementState.speedFactor` (§6).
2. **Combat (upper-body keyframe + arc)**. Active when
   `combatState !== Idle`. Drives `shoulder_L/R, upper_arm_L/R, forearm_L/R,
   hand_L/R, neck, head` via §4 hybrid strategy.
3. **Idle arm-swing (upper-body procedural)**. Active when `combatState ===
   Idle` AND `MovementState.speedFactor > WALK_SPEED_THRESHOLD`. Drives
   `shoulder_L, shoulder_R` with the counter-swing of the walk cycle.

`spine` is **shared** with explicit precedence rules below.

### Precedence flowchart for `spine`

```
  combat pose has spine entry?
  ├─ YES → combat pose owns spine (apply via §4 hybrid)
  └─ NO  → movement params have spine entry?
           ├─ YES → movement pose owns spine
           └─ NO  → spine stays at rest (identity)
```

This solves the `AnimationSystem.ts:286-303` bug where the current code tries
to blend both layers' spine contributions with a fixed `0.6 / 0.4` ratio,
which (a) doesn't compose with the bone-by-bone slerp of §4 and (b) writes
identity to spine when neither layer has it. Under the new rule there is
exactly one writer per tick.

### Owned bone sets (per tick)

```
  movementOwned = LOWER_BODY_BONES  ∪  (combatState === Idle && speedFactor > 0
                                          ? {'shoulder_L','shoulder_R'}
                                          : {})
                                    ∪  (movementParams.basePose has 'spine'
                                          && !combatPose has 'spine'
                                          ? {'spine'}
                                          : {})

  combatOwned   = (combatState !== Idle ? UPPER_BODY_BONES : {})
                                    ∪  (combatPose has 'spine'
                                          ? {'spine'}
                                          : {})
                                    \  movementOwned
```

`UPPER_BODY_BONES` and `LOWER_BODY_BONES` already exist as exports in
`AnimationData.ts:401-411` and stay as-is. `SHARED_BONES` (currently
`{'spine'}`) becomes obsolete under the new rule and can be deleted in #C.

**Key invariant**: if a layer's pose object has no entry for a bone the
layer owns, the **layer leaves that bone at rest** (slerp toward identity is
fine, because the layer owns it). If a bone is NOT in the layer's owned set,
the layer **never touches it**. This is the rule that fixes the current
"upper-body Idle pose pulls legs back to rest" bug at
`AnimationSystem.ts:282`.

---

## 6. Tick contract

### Read / write split

| System                        | Phase           | Reads                                | Writes                                                           |
|-------------------------------|-----------------|--------------------------------------|------------------------------------------------------------------|
| `CombatSystem`                | `fixedUpdate`   | input, FSM, weapon config            | `CombatStateComp.*`, `CombatStateComponent.*`, FSM internal     |
| `MovementSystem`              | `fixedUpdate`   | input, physics                       | `Position`, `Velocity`, `MovementState`                          |
| `AnimationSystem`             | `update(dt)`    | `CombatStateComp`, `MovementState`, `meshRegistry` | bone quaternions only (`bones[name].quaternion`)     |
| `ViewmodelAnimationSystem`    | `update(dt)`    | `CombatStateComp` (player only)      | viewmodel bone quaternions only                                  |
| `HitReactSystem` (NEW; tiny)  | `fixedUpdate`   | `Health`, `DamageEvent`              | `HitReactComp`                                                   |

### Variable-rate, frame-rate-independent

Visible pose is `f(phaseT)`, **not** `f(phaseT, current bone rotation)`.
Concretely: at any frame the bone's quaternion is recomputed from the static
inputs (`prevPoseSnapshot`, `currentTargetPose`, `easedT`). Two frames at
the same `phaseT` produce the same pose. This is the property the current
system lacks.

### Crossfade across state transitions

When `state` or `direction` changes:

1. Snapshot every owned bone's *current* quaternion into
   `prevPoseSnapshot[eid]`.
2. Reset `crossfadeT[eid] = 0`.
3. The next frames apply `f(phaseT, prevPoseSnapshot, currentPose, easedT)`
   where `easedT = smoothstep(max(phaseT, crossfadeT))`.
4. `crossfadeT` ramps `dt / BLEND_DURATION` per frame (BLEND_DURATION ≈ 0.08 s,
   matches existing `DEFAULT_BLEND_DURATION` at `AnimationSystem.ts:42` and
   `ViewmodelAnimationSystem.ts:24`). Once `crossfadeT >= 1`, the crossfade
   is inert and `phaseT` alone drives the pose.

The crossfade is the **same timer** that handles the `Idle`/`Blocking`
case where `phaseT` stays at 0 — a single `effectiveT = max(phaseT,
crossfadeT)` covers both fixed-duration and no-duration states.

### Read-only contract for animation

Animation systems must NEVER:

- mutate the FSM (`fsmRegistry.get(eid).transition(...)`),
- mutate `CombatStateComp.*`,
- mutate `CombatStateComponent.*`,
- mutate `MovementState.*`,
- mutate any non-render component.

Only outputs: `bones[name].quaternion` (third-person), viewmodel bone
quaternions (first-person), and the local snapshot side-tables
(`prevPoseSnapshot`, `crossfadeT`, `walkCycle`) which are owned by the
animation systems themselves.

---

## 7. Hit-react / stagger

After #B introduces the component:

```ts
export const HitReactComp = defineComponent({
  /** Direction the hit came from, in body-local space (unit vector or zero) */
  directionLocalX:  Types.f32,
  directionLocalY:  Types.f32,
  directionLocalZ:  Types.f32,
  /** Hit magnitude in [0, 1] — scales the visual react */
  magnitude:        Types.f32,
  /** Tick at which DamageSystem populated this component */
  spawnedAtTick:    Types.ui32,
  /** Total ticks the react should drive animation */
  durationTicks:    Types.ui16,
});
```

### Population

`DamageSystem` populates `HitReactComp` on the **defender** entity at the
moment a hit is resolved (the same tick the FSM transitions to `HitStun`).
`directionLocal` is computed by transforming `attackerPosition - targetPosition`
into target body-local frame and projecting onto X/Z.

### Animation behavior

`AnimationSystem` reads `HitReactComp` only when
`CombatStateComp.state === HitStun`. While the component is fresh:

```
ticksAlive = currentTick - spawnedAtTick
reactBlendT = clamp01(ticksAlive / 6)              // ramp in over ~100ms
reactDecayT = clamp01((ticksAlive - 6) / (durationTicks - 6))   // settle to static HITSTUN_POSE
```

- For the first ~100ms (`reactBlendT < 1`), `spine` and `chest` tilt **away
  from `directionLocal`** — i.e. add a rotation whose axis is
  `cross(directionLocal, +Y)` (so a hit from in front pushes the spine
  backward). Tilt magnitude scales with `magnitude`.
- After ~100ms, `reactDecayT` blends from the early tilt back into the
  static `HITSTUN_POSE` (already defined in `AnimationData.ts:324`) for the
  remainder of the stun. The static pose still owns the upper body via the
  normal §4 keyframe pipeline; the hit-react adds an extra
  `multiply(reactQuat)` on `spine` and `chest`.

### Cleanup

`HitReactComp` is auto-cleared by a tiny `HitReactSystem` (or `HealthSystem`,
since it already iterates entities once per tick) when:

```
spawnedAtTick + durationTicks <= currentTick
```

After clearing, the component's fields go to 0 and `AnimationSystem` skips
the hit-react block (testing `magnitude > 0`).

The component is purely a **read-model for animation** — no FSM transitions
read it, no movement systems read it. If it gets stale (e.g. defender
respawns), the respawn handler explicitly clears it.

---

## 8. Viewmodel sync

### Shared blend utility

`AnimationSystem` (third-person) and `ViewmodelAnimationSystem` (first-
person) MUST share the per-bone blend pipeline. The current code duplicates
the `_targetQuat / boneRotationToQuat / slerp` flow in both files
(`AnimationSystem.ts:104-124` and `ViewmodelAnimationSystem.ts:120-132`),
which is what allowed the `prev = current_bone` bug to live in the third-
person system while the first-person system has the same bug independently.

The rebuild lifts the loop into a shared helper:

```ts
/**
 * Apply a target pose to a bone set, slerping from a captured prev-pose snapshot.
 *
 * @param bones        Bone hierarchy (third-person or viewmodel).
 * @param prevPose     Snapshot of bone quaternions captured at the last state change.
 *                     Keys are bone names; values are THREE.Quaternion.
 * @param currentPose  Target Pose (Record<boneName, BoneRotation>) in deltas-from-rest Euler.
 * @param easedT       Smoothstepped blend factor in [0, 1].
 * @param ownedBoneSet Bones this layer owns this tick.
 *                     Bones outside the set are NOT touched.
 */
function applyPoseLayer(
  bones: Record<string, THREE.Bone>,
  prevPose: Record<string, THREE.Quaternion>,
  currentPose: Pose,
  easedT: number,
  ownedBoneSet: ReadonlySet<string>,
): void;
```

Lives in `src/animation/poseBlending.ts` (NEW). Both
`AnimationSystem` and `ViewmodelAnimationSystem` import it.

The viewmodel passes its three-bone set (`{'upper_arm_R', 'forearm_R',
'hand_R'}`) as `ownedBoneSet`; the third-person system passes the result of
the §5 ownership computation. The utility is bone-set-agnostic by design.

### Blade timing constraint

The tracer arms at the moment `phaseT === 0` in `Release` (i.e. the first
tick the FSM is in `Release`) and disarms at `phaseT === 1` (last tick).
This is fixed by the FSM and out of scope here, but it sets the visual
constraint:

> First-person hand position at any `phaseT ∈ [0, 1]` during `Release`
> must visually correspond to the third-person hand position at the same
> `phaseT`.

In other words: an opponent watching me swing should see my third-person
arm at the same point in the arc that I see my own viewmodel arm. The
shared `phaseT` source guarantees this — both systems read the same
`CombatStateComp.phaseT`. The only way to break the constraint is for the
viewmodel and third-person to use **different arc-swing parameters** that
end up with the hand in different world-space positions at the same
`phaseT`. The pose-data PR (#D) is responsible for tuning the per-weapon
arc params so the world-space hand positions are visually consistent.

### Why not share pose data?

The viewmodel has *different* poses on purpose: the camera IS the
character's eyes, so swings need exaggeration to feel impactful, and poses
must stay within viewport bounds. `ViewmodelAnimationData.ts` keeps its
weapon-specific tables. The shared piece is the **blend pipeline**, not the
pose data.

---

## 9. Per-tick pose computation pseudo-code

This is the canonical implementation for one frame of
`AnimationSystem.update(dt)` after the rebuild. A frontend dev should be
able to write `AnimationSystem.ts` from this listing.

```
// ── Module-level state ─────────────────────────────────────
prevPoseSnapshot: Map<eid, Record<boneName, Quaternion>>   // captured at state-change
crossfadeT:       Map<eid, number>                          // 0..1, ramps over BLEND_DURATION
walkCyclePhase:   Map<eid, number>                          // accumulated radians, wraps at 2π
prevState:        Map<eid, CombatState>
prevDirection:    Map<eid, number>

// ── Per-frame ──────────────────────────────────────────────
function animationSystem(world, dt):
  for each entity in animatedQuery(world.ecs):
    eid = entity.id
    modelData = meshRegistry.get(CharacterModel.id[eid])
    if not modelData: continue
    bones = modelData.bones

    // ── 1. Read read-model ──
    state           = CombatStateComp.state[eid]
    direction       = CombatStateComp.direction[eid]
    phaseT          = CombatStateComp.phaseT[eid]                    // [0, 1] from #B
    weaponId        = CombatStateComp.weaponId[eid]
    speedFactor     = MovementState.speedFactor[eid]                 // [0, 1]
    isCrouching     = MovementState.crouching[eid] == 1              // fix the AnimationSystem.ts:249 TODO
    isGrounded      = MovementState.grounded[eid] == 1

    // ── 2. State-change snapshot ──
    if state != prevState[eid] or direction != prevDirection[eid]:
      snapshot = {}
      for each bone in bones:
        snapshot[bone.name] = bone.quaternion.clone()
      prevPoseSnapshot[eid] = snapshot
      crossfadeT[eid] = 0
      prevState[eid] = state
      prevDirection[eid] = direction

    // ── 3. Crossfade timer ──
    crossfadeT[eid] = min(1, crossfadeT[eid] + dt / BLEND_DURATION)
    effectiveT = smoothstep(max(phaseT, crossfadeT[eid]))             // [0, 1]

    // ── 4. Layer ownership (see §5) ──
    movKey      = movementKeyFromSpeedFactor(speedFactor, isGrounded, isCrouching)
                  // 'idle' | 'walk' | 'run' | 'jump' | 'crouch'
    movParams   = getMovementParams(movKey)
    combatPose  = (state == Idle) ? null : getCombatPose(state, direction, weaponId)
    isMoving    = speedFactor > IDLE_SPEED_FACTOR_THRESHOLD            // ≈ 0.05

    movementOwned = copy(LOWER_BODY_BONES)
    if state == Idle and isMoving:
      movementOwned.add('shoulder_L'); movementOwned.add('shoulder_R')
    if 'spine' in movParams.basePose and (combatPose == null or 'spine' not in combatPose):
      movementOwned.add('spine')

    combatOwned = combatPose == null ? {} : copy(UPPER_BODY_BONES)
    if combatPose != null and 'spine' in combatPose:
      combatOwned.add('spine')
    combatOwned = combatOwned \ movementOwned

    // ── 5. Lower-body procedural (always) ──
    if movKey == 'walk' or movKey == 'run':
      walkCyclePhase[eid] = (walkCyclePhase[eid] + dt * movParams.cycleSpeed * speedFactor) mod 2π
      applyWalkCycle(bones, walkCyclePhase[eid], movParams.legSwing, movementOwned)
    else:
      // basePose into legs (handles idle/crouch/jump)
      applyPoseLayer(bones, prevPoseSnapshot[eid], movParams.basePose, effectiveT, movementOwned ∩ LOWER_BODY_BONES)

    // ── 6. Idle arm-swing (only when no combat) ──
    if state == Idle and isMoving:
      shoulderSwingPose = computeShoulderSwingPose(walkCyclePhase[eid], movParams.armSwing)
      applyPoseLayer(bones, prevPoseSnapshot[eid], shoulderSwingPose, effectiveT,
                     {'shoulder_L', 'shoulder_R'})

    // ── 7. Upper-body combat (when state != Idle) ──
    if combatPose != null:
      if state == Release:
        // Hybrid: arc-driven swing for owned arm bones; keyframe slerp for non-arm upper bones (chest, neck, head).
        arcParams = getArcSwingParams(direction, weaponId)
        applyArcSwing(bones, prevPoseSnapshot[eid], arcParams, phaseT, combatOwned ∩ ARM_BONES_R)
        applyPoseLayer(bones, prevPoseSnapshot[eid], combatPose, effectiveT,
                       combatOwned \ ARM_BONES_R)
      else:
        // Pure keyframe slerp.
        applyPoseLayer(bones, prevPoseSnapshot[eid], combatPose, effectiveT, combatOwned)

    // ── 8. Hit-react (only in HitStun, only when component populated) ──
    if state == HitStun and HitReactComp.magnitude[eid] > 0:
      ticksAlive   = currentTick - HitReactComp.spawnedAtTick[eid]
      durationTicks= HitReactComp.durationTicks[eid]
      reactBlendT  = clamp01(ticksAlive / 6)
      reactDecayT  = clamp01((ticksAlive - 6) / max(1, durationTicks - 6))
      tiltMag      = HitReactComp.magnitude[eid] * (1 - reactDecayT) * reactBlendT
      tiltAxis     = cross(directionLocal, +Y).normalize()
      reactQuat    = quatFromAxisAngle(tiltAxis, tiltMag * MAX_TILT_RAD)
      bones['spine'].quaternion.multiply(reactQuat)        // additive on top of §7
      bones['chest'].quaternion.multiply(reactQuat)        // doubled on chest for visible tilt

    // ── 9. Idle breathing (existing behavior, kept) ──
    if state == Idle and movKey == 'idle':
      breathSway = sin(elapsedTime * 2π * BREATH_FREQUENCY) * BREATH_AMPLITUDE
      bones['chest'].quaternion.multiply(quatFromEuler(breathSway, 0, breathSway * 0.5))

  // ── Done — Three.js renders bones via SkinnedMesh in render(alpha) ──
```

Notes on the listing:

- `applyPoseLayer` is the shared helper from §8. `applyArcSwing` and
  `applyWalkCycle` are private to `AnimationSystem` (the viewmodel does
  not have legs).
- `ARM_BONES_R = {'shoulder_R', 'upper_arm_R', 'forearm_R', 'hand_R'}` —
  the bones the arc-swing owns during Release.
- `getArcSwingParams(direction, weaponId)` is implemented in #D's pose
  data tables.
- `currentTick` is read from `world.tickCounter` (already maintained by
  `GameLoop.fixedUpdate`).
- The viewmodel system follows the same pseudo-code with: only steps 1, 2,
  3, 7, plus the existing idle sway block in
  `ViewmodelAnimationSystem.ts:135-152`. No layer-ownership computation
  needed — the viewmodel always owns its three bones.

---

## 10. Migration notes

### Bugs the rebuild must fix

The diagnosis below maps to items 1-7 from the architect's plan comment on
issue #89. Each one is fixed by a specific section above.

1. **Pose interpolation uses live bone state, not a snapshot.**
   `AnimationSystem.ts:122` — `bone.quaternion.slerp(_targetQuat,
   blendFactor)`. Each frame slerps from "wherever the bone is right now"
   toward target with `blendFactor` ∈ [0, 1]. This produces exponential
   settling, not phase-progress motion. The bone never reaches the target
   if `blendFactor < 1`. **Fix**: §4 keyframe rule — slerp from
   `prevPoseSnapshot` (captured at state change), not from
   `bone.quaternion`.

2. **Phase blend treated as a slerp factor.**
   `AnimationSystem.ts:218-225` computes `phaseBlend` as
   `phaseElapsed / phaseTotal` then passes it as the slerp factor. This
   couples to bug #1 — even if the snapshot were correct, the per-frame
   slerp factor should be eased phase progress, not raw progress. **Fix**:
   §6 — `effectiveT = smoothstep(max(phaseT, crossfadeT))` is the slerp
   factor; the snapshot is the source.

3. **Bones absent from the combat pose are slerped toward identity.**
   `AnimationSystem.ts:117-120` — when `pose[boneName]` is undefined, the
   code sets target to identity and slerps. This is why the upper-body Idle
   pose pulls the legs back to a T-pose rest while the walk cycle is
   trying to drive them. **Fix**: §5 layer ownership — bones outside a
   layer's owned set are not touched.

4. **Two-layer spine blend hardcoded as 60/40.**
   `AnimationSystem.ts:294-303` — when both combat and movement want spine,
   averages with `slerp(_prevQuat, _targetQuat, 0.6)`. This drifts as the
   layers change and never composes cleanly with the per-bone slerp. **Fix**:
   §5 spine precedence — exactly one layer owns spine each tick, no
   blending.

5. **Movement state from velocity heuristic.**
   `AnimationSystem.ts:248`: `isGrounded = Math.abs(vy) < 0.5` and the
   sqrt-of-velocity threshold below. The character controller already
   maintains `MovementState.speedFactor` and `MovementState.grounded` —
   reading derived velocity is redundant and lags by a tick. **Fix**: §9
   pseudo-code reads `MovementState.speedFactor` and
   `MovementState.grounded` directly. Threshold becomes
   `IDLE_SPEED_FACTOR_THRESHOLD` (≈ 0.05).

6. **`isCrouching` hardcoded to `false`.**
   `AnimationSystem.ts:249`: `const isCrouching = false; // TODO`. Must
   read `MovementState.crouching[eid] == 1`. **Fix**: §9 pseudo-code line
   `isCrouching = MovementState.crouching[eid] == 1`.

7. **`_isComboRecovery` is set on FSM but never read by animation.**
   `CombatFSM.ts:331` — `this._isComboRecovery = isCombo` runs on every
   recovery entry, but the field is private and no system reads it
   afterward. The combo recovery has different timing
   (`comboRecovery[dir]` vs `recovery[dir]`) and should drive a *different*
   recovery animation (faster windback to ready). **Fix**: expose
   `isComboRecovery: boolean` as a public getter on `CombatFSM` (one-line
   change inside #B's FSM v2 work). `AnimationSystem` reads it via
   `CombatStateComp` (#B can store it in a spare bit of the existing
   `weaponId` ui8 OR add a new ui8 field — implementer's call). The pose
   data PR (#D) supplies a faster recovery pose for combo recoveries.

### Known dead-code crumbs to clean up while rebuilding

- The `Underhand` direction is being removed in FSM v2 (#88). Pose data
  (#D) drops `Underhand` entries from `ATTACK_ANIMATIONS` (and the
  viewmodel equivalent). The `Pose` records currently with `Underhand`
  keys (`AnimationData.ts:152-173` and the viewmodel file) become dead
  code — strip them in the same PR that drops the enum value.
- `ATTACK_ANIMATIONS[*].release` entries are replaced by arc-swing params
  under the hybrid strategy (§4). Keep them in the file only if a fallback
  is needed for unimplemented weapons; otherwise delete.
- `SHARED_BONES` (`AnimationData.ts:414-416`) becomes obsolete under the
  layer-ownership rule (§5). Delete in #C.
- The `breathing` block at `AnimationSystem.ts:306-314` is fine — keep it
  as step 9 of the pseudo-code.

### Two-component sync (kept for now)

`CombatStateComp` and `CombatStateComponent` remain dual until the
unification PR (`docs/combat-fsm-v2.md` §9). The animation rebuild reads
`CombatStateComp` only — when unification lands, it's a single search-and-
replace from `CombatStateComp` to the unified `CombatState`. No animation
re-architecture needed.

### Implementation sequence

The rebuild lands across four PRs:

| #   | Title                                                            | Depends on |
|-----|------------------------------------------------------------------|------------|
| 110 | Animation architecture spec (this doc)                           | —          |
| B   | FSM phase-t API + `phaseT` + `HitReactComp` + `isComboRecovery` getter | 110   |
| C   | `AnimationSystem` rebuild (snapshot, layer ownership, arc swing) | B          |
| D   | Pose data updates + viewmodel sync via shared blend utility       | B, C       |

#C and #D may overlap if they touch disjoint files; #D's pose tables can
land before #C's rewrite without breaking anything (the old system will
just continue to misuse them as it does today).
