import { defineComponent, Types } from 'bitecs';
import type * as THREE from 'three';

/* ─── bitECS components (numbers only) ─── */

/** World-space position */
export const Position = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Previous tick position (for interpolation) */
export const PreviousPosition = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Euler rotation (radians) */
export const Rotation = defineComponent({
  x: Types.f32, // pitch
  y: Types.f32, // yaw
  z: Types.f32, // roll
});

/** Previous tick rotation (for interpolation) */
export const PreviousRotation = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Velocity vector */
export const Velocity = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Tag: entity is the local player */
export const Player = defineComponent();

/** Alias for Player tag (used by character model subsystem) */
export const IsPlayer = Player;

/**
 * Tag: entity is an AI-controlled bot. Stub component for #99 (warmup bots);
 * shipped here so #130's `processDeaths` can include bots in the kill/death
 * event pipeline alongside players without a follow-up plumbing PR.
 */
export const Bot = defineComponent();

/**
 * Tag: any non-player NPC (training dummies, future warmup bots, shopkeeps).
 *
 * Generalizes the legacy hardcoded `activeDummies: number[]` array — any system
 * that wants to act on every NPC (floating damage numbers, replication chrome,
 * killfeed labels, etc.) iterates `defineQuery([IsNPC])` instead.
 *
 * Supersedes the dummy/shopkeep coupling per `docs/training-dummies-and-bots-spec.md` §6.
 */
export const IsNPC = defineComponent();

/**
 * Tag: training dummy specifically (subset of `IsNPC`).
 *
 * Marks the entity as eligible for the auto-regen + `K`-key reset pipeline.
 * Bots get `IsNPC` but NOT `IsTrainingDummy` — they don't regen and don't
 * reset on `K`.
 */
export const IsTrainingDummy = defineComponent();

/**
 * Tag: entity is currently dead, awaiting respawn.
 *
 * Added by `processDeaths` (issue #130) when HP first crosses to 0; removed
 * by `processRespawns` (issue B in the spawn/death/respawn family) when the
 * RespawnPending timer expires. Replaces the legacy `respawnTimers` Map
 * side-table that previously lived in HealthSystem.
 *
 * Systems that should NOT run for dead entities (CombatSystem, MovementSystem)
 * early-out via `hasComponent(world.ecs, DeadTag, eid)`.
 *
 * See `docs/spawn-death-respawn.md` for the full lifecycle.
 */
export const DeadTag = defineComponent();

/**
 * RespawnPending — per-entity respawn countdown.
 *
 * `ticksRemaining` is decremented each fixed tick by HealthSystem; when it
 * hits 0 the entity is pushed into the `respawned` array and processRespawns
 * (issue B) handles teleport + HP/stamina restore.
 *
 * Stored as a component (not a side-table Map) so the future networking
 * layer can serialize remaining time per-entity in snapshots without a
 * separate replication path.
 */
export const RespawnPending = defineComponent({
  ticksRemaining: Types.ui16,
});

/**
 * Score — per-life and lifetime score tracking.
 *
 * - `kills`: total kills across all lives (incremented when this entity is
 *   credited as the killer in a `DeathEvent`).
 * - `deaths`: total deaths across all lives (incremented on every death).
 * - `goldThisLife`: gold earned during the current life. Reset to 0 in
 *   processDeaths. Total persistent gold lives elsewhere (issue #95 / Wallet).
 */
export const Score = defineComponent({
  kills: Types.ui16,
  deaths: Types.ui16,
  goldThisLife: Types.ui32,
});

/** Physics body reference (index into lookup table) */
export const PhysicsBody = defineComponent({
  bodyHandle: Types.ui32,
  colliderHandle: Types.ui32,
});

/** Movement state flags */
export const MovementState = defineComponent({
  /** 1 = grounded, 0 = airborne */
  grounded: Types.ui8,
  /** 1 = sprinting */
  sprinting: Types.ui8,
  /** 1 = crouching */
  crouching: Types.ui8,
  /** Current speed factor (0..1, for acceleration ramp) */
  speedFactor: Types.f32,
  /**
   * Vertical velocity for jump/gravity bookkeeping (units/s).
   * Authoritative for kinematic gravity simulation. Replaces use of
   * `Velocity.y` in MovementSystem (issue #104).
   */
  verticalVelocity: Types.f32,
  /** Tick of last successful jump (for jump cooldown / debug) */
  lastJumpTick: Types.i32,
});

/**
 * MovementIntent — per-tick movement commands written by an "agent"
 * (the local player's InputSystem, an AI controller, or a network
 * deserializer) and consumed by MovementSystem.
 *
 * - moveX, moveZ are world-space normalized direction (length 0 or 1).
 * - sprint, crouch, jumpRequested are 0/1 flags.
 * - jumpRequested is edge-triggered: written 1 only on the rising edge
 *   of the jump input, cleared back to 0 by MovementSystem after the
 *   jump is consumed (or each tick by the writer if not consumed).
 *
 * This is the seam where future AI controllers and network input
 * packets plug in. See AGENTS.md "Character Controller" and issue #86.
 */
export const MovementIntent = defineComponent({
  moveX: Types.f32,
  moveZ: Types.f32,
  sprint: Types.ui8,
  crouch: Types.ui8,
  jumpRequested: Types.ui8,
});

/**
 * CharacterModel — stores a numeric ID used to look up
 * the Three.js Group in the meshRegistry.
 */
export const CharacterModel = defineComponent({
  /** Key into meshRegistry */
  id: Types.ui32,
});

/**
 * Hitboxes — stores Rapier collider handles for each body region.
 * Handles are u32 indices into the Rapier world.
 * A value of 0xFFFFFFFF means "no collider".
 */
export const Hitboxes = defineComponent({
  head: Types.ui32,
  torso: Types.ui32,
  armLeft: Types.ui32,
  armRight: Types.ui32,
  legLeft: Types.ui32,
  legRight: Types.ui32,
});

/**
 * Combat state component — tracks current FSM state and attack info.
 * bitECS only supports numeric values, so states/directions are enum ints.
 */
export const CombatStateComponent = defineComponent({
  /** Current CombatState enum value */
  state: Types.ui8,
  /**
   * Current `Direction` enum value (FSM v2 #139). Both `attackDirection` and
   * `blockDirection` now hold the same unified Direction value — they're
   * a transitional pair until issue C (#136) collapses
   * `CombatStateComponent` + `CombatStateComp` into a single component.
   */
  attackDirection: Types.ui8,
  /** Same value as `attackDirection` (FSM v2 #139). */
  blockDirection: Types.ui8,
  /** Ticks remaining in current state */
  ticksRemaining: Types.ui16,
  /** Weapon config index (maps to side-table) */
  weaponId: Types.ui8,
});

/** Health component */
export const Health = defineComponent({
  current: Types.f32,
  max: Types.f32,
});

/** Gold currency held by a player entity. */
export const Gold = defineComponent({
  amount: Types.ui32,
});

/** Stamina component */
export const Stamina = defineComponent({
  current: Types.f32,
  max: Types.f32,
});

/**
 * Hitbox component — marks an entity as having hitbox sensor colliders.
 * The ownerEid links a hitbox collider entity back to its parent combatant.
 * bodyRegion stores the BodyRegion enum value.
 */
export const Hitbox = defineComponent({
  /** Entity ID of the combatant who owns this hitbox */
  ownerEid: Types.ui32,
  /** BodyRegion enum value */
  bodyRegion: Types.ui8,
  /** Rapier collider handle for lookup */
  colliderHandle: Types.ui32,
});

/**
 * TracerTag — marks an entity as participating in tracer-based hit detection.
 * Actual tracer state (previous positions, hit set) is stored in a side-map
 * because bitECS components can't hold arrays/objects.
 */
export const TracerTag = defineComponent();

/**
 * WeaponPickup — marks an entity as a ground-spawned weapon pickup.
 *
 * Numeric only (bitECS constraint). The string `weaponName` and the
 * Three.js Group/Material refs live in the side-table `pickupRegistry`
 * (see `src/inventory/PickupRegistry.ts`).
 *
 * - weaponId: index into `weaponIdToName` (CombatSystem.ts) — used for
 *   networking-friendly serialization once that lands.
 * - spawnTick: tick the pickup was created on (for despawn timer + age math).
 * - despawnTick: tick the pickup will be auto-removed (consumed by #A2).
 *
 * See parent issue #94 for the full lifecycle and #109 for the foundation
 * scope. No behavior here — drop/pickup/despawn live in #A2.
 */
export const WeaponPickup = defineComponent({
  weaponId: Types.ui8,
  spawnTick: Types.ui32,
  despawnTick: Types.ui32,
});

/**
 * DamageEvent component — written by TracerSystem, consumed by DamageSystem.
 * Represents a pending damage event to be processed in the same tick.
 */
export const DamageEvent = defineComponent({
  /** Entity receiving damage */
  targetEid: Types.ui32,
  /** Entity dealing damage */
  attackerEid: Types.ui32,
  /** Raw damage amount */
  damage: Types.f32,
  /** BodyRegion hit */
  bodyRegion: Types.ui8,
  /** `Direction` enum value of the attack (FSM v2 #139) */
  attackDirection: Types.ui8,
  /** Whether this event has been processed (1 = processed) */
  processed: Types.ui8,
});

/**
 * Combat state — mirrors the combat FSM's current state.
 * Written by the CombatSystem (fixedUpdate), read by the AnimationSystem (update).
 *
 * - state: CombatState enum value
 * - direction: `Direction` enum value (FSM v2 #139 — single unified enum)
 * - phaseElapsed: ticks elapsed in current phase
 * - phaseTotal: total ticks for current phase (from weapon config)
 * - phaseT: normalized phase progress in [0, 1] (mirrors CombatFSM.getPhaseT())
 * - weaponId: index into weaponRegistry for timing lookups
 */
export const CombatStateComp = defineComponent({
  state: Types.ui8,
  direction: Types.ui8,
  phaseElapsed: Types.ui16,
  phaseTotal: Types.ui16,
  phaseT: Types.f32,
  weaponId: Types.ui8,
});

/**
 * HitReactComp — populated by DamageSystem on every successful hit.
 * Read by AnimationSystem to drive a directional stagger lean.
 *
 * `dirX/dirY/dirZ` form a unit vector in the target's body-local space
 * pointing FROM the attacker TO the target (i.e., the direction the hit
 * pushes the target). Stored as 3 separate floats because bitECS only
 * supports scalar fields.
 *
 * `magnitude` is normalized in [0, 1] (typically `damage / weapon.maxDamage`).
 *
 * `active = 1` until `currentTick >= spawnedAtTick + durationTicks`,
 * at which point HitReactSystem clears it to 0. Animation reads `active`
 * to decide whether to apply the lean.
 */
export const HitReactComp = defineComponent({
  dirX: Types.f32,
  dirY: Types.f32,
  dirZ: Types.f32,
  magnitude: Types.f32,
  spawnedAtTick: Types.ui32,
  durationTicks: Types.ui16,
  active: Types.ui8,
});

/**
 * BotBrain — per-bot AI state (warmup bots, #119 / spec §4). Attached only
 * to entities that also carry the `Bot` tag. `BotAISystem` reads/writes
 * this each fixed tick and translates decisions into `MovementIntent`
 * (the documented AI seam) + CombatFSM `Attack` inputs.
 *
 * - `targetEid`: entity the bot chases (the local player today; a
 *   networked player eid post-#92).
 * - `mode`: 0 = Approach, 1 = Engage, 2 = Reposition (spec §4 mini-FSM).
 * - `lastSwingTick`: fixed-tick stamp pacing the swing cooldown.
 * - `meleeRange`: distance (m) at which Approach hands over to Engage.
 */
export const BotBrain = defineComponent({
  targetEid: Types.ui32,
  mode: Types.ui8,
  lastSwingTick: Types.ui32,
  meleeRange: Types.f32,
  // Obstacle detour (the arena has pillars; the spec's "no pathfinding on
  // flat ground" breaks the moment a bot beelines head-on into one — the
  // character controller can't slide when travel is perpendicular to the
  // face). prevX/prevZ track last-tick position; `stuckTicks` counts ticks
  // of intending-to-move-but-not-moving; when it trips, the bot strafes
  // perpendicular until `detourUntilTick` (sign in `detourSign`: 0/1).
  prevX: Types.f32,
  prevZ: Types.f32,
  stuckTicks: Types.ui16,
  detourUntilTick: Types.ui32,
  detourSign: Types.ui8,
});

/**
 * KnockbackState — physical displacement applied to a target on unblocked
 * hits (per-weapon `WeaponConfig.knockback`). Written by DamageSystem;
 * consumed by MovementSystem for player-controlled entities (added to the
 * character-controller movement, input suppressed while `ticksRemaining > 0`)
 * and by KnockbackSystem for non-player entities (ballistic integration +
 * physics-body teleport, so training dummies literally go flying).
 *
 * `vx/vy/vz` is the current knockback velocity (m/s, world space).
 * `ticksRemaining` doubles as the "lost control" timer — heavy weapons set
 * it higher, so a warhammer launch keeps the victim tumbling with no
 * steering until they land.
 */
export const KnockbackState = defineComponent({
  vx: Types.f32,
  vy: Types.f32,
  vz: Types.f32,
  ticksRemaining: Types.ui16,
});

/**
 * Animation state — tracks blending progress for the animation system.
 *
 * Issue #128 rebuild: replaces the per-layer `upperBlend`/`lowerBlend`
 * pair with a single `crossfadeT` timer that ramps `0 → 1` over
 * `CROSSFADE_DURATION_SEC` after every state-or-direction transition.
 * The actual per-bone snapshot lives in a side-table (`prevPoseSnapshots`
 * inside `AnimationSystem.ts`) because bitECS only stores numeric fields.
 *
 * - crossfadeT: 0..1 progress of the post-transition crossfade. Drives
 *   `effectiveT = smoothstep(max(phaseT, crossfadeT))` per `docs/animation-architecture.md` §6.
 * - movementState: MovementState enum value (derived from `MovementState`
 *   ECS component, kept here so the HUD/debug overlay can read it).
 * - walkCycle: accumulated walk cycle phase (radians, wraps at 2π).
 * - prevCombatState: previous combat state for transition detection.
 * - prevDirection: previous direction for transition detection.
 */
export const AnimationComp = defineComponent({
  crossfadeT: Types.f32,
  movementState: Types.ui8,
  walkCycle: Types.f32,
  prevCombatState: Types.ui8,
  prevDirection: Types.ui8,
});

/* ─── Lookup tables for non-numeric data ─── */

export interface CharacterModelData {
  group: THREE.Group;
  skeleton: THREE.Skeleton;
  bones: Record<string, THREE.Bone>;
}

/** Map<entityId, Three.js group + skeleton data> */
export const meshRegistry = new Map<number, CharacterModelData>();

/** Map<entityId, per-region Rapier collider refs> */
export const hitboxColliderRegistry = new Map<
  number,
  Map<BodyRegion, import('@dimforge/rapier3d-compat').Collider>
>();

/* ─── Body region enum ─── */

export const enum BodyRegion {
  Head = 0,
  Torso = 1,
  ArmLeft = 2,
  ArmRight = 3,
  LegLeft = 4,
  LegRight = 5,
}
