import { defineQuery, addEntity, addComponent } from 'bitecs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { World } from '../../core/World';
import {
  CombatStateComponent,
  TracerTag,
  DamageEvent,
  Hitbox,
} from '../components';
import { CombatState, BodyRegion } from '../../combat/states';
import type { WeaponConfig, TracerPoint } from '../../weapons/WeaponConfig';

// ─── Types ───────────────────────────────────────────────────────────────────

/** World-space position of a tracer point */
interface TracerWorldPos {
  x: number;
  y: number;
  z: number;
}

/** Per-entity tracer state stored in a side-map (bitECS can't hold arrays) */
export interface TracerEntityState {
  /** Previous tick's world-space tracer positions */
  prevPositions: TracerWorldPos[];
  /** Whether prevPositions is valid (false on first tick of Release) */
  hasPrevious: boolean;
  /** Set of entity IDs already hit during this swing — prevents multi-hit */
  hitEntities: Set<number>;
}

/** Recorded tracer segment for debug visualization */
export interface TracerDebugSegment {
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Tick when this segment was recorded */
  birthTick: number;
}

// ─── Side-maps ───────────────────────────────────────────────────────────────

/**
 * Per-entity tracer state. Keyed by entity ID.
 * Managed by TracerSystem — created when entering Release, cleaned up on exit.
 */
export const tracerStates = new Map<number, TracerEntityState>();

/**
 * Maps weapon IDs to WeaponConfig objects.
 * Must be populated by entity factory code when equipping weapons.
 */
export const weaponConfigMap = new Map<number, WeaponConfig>();

/**
 * Maps entity IDs to their weapon bone (THREE.Bone or Object3D).
 * The bone's world matrix is used to transform tracer points to world space.
 * Must be populated by CharacterModel/entity factory code.
 */
export const weaponBoneMap = new Map<number, THREE.Object3D>();

/**
 * Maps Rapier collider handles to { ownerEid, bodyRegion }.
 * Populated when hitbox colliders are created.
 */
export const colliderToHitbox = new Map<
  number,
  { ownerEid: number; bodyRegion: BodyRegion }
>();

/**
 * Ring buffer of debug tracer segments for visualization.
 * TracerDebugRenderer reads from this.
 */
export const debugTracerSegments: TracerDebugSegment[] = [];

/** Current tick counter for debug segment aging */
let currentTick = 0;

/** Max age in ticks before debug segments are pruned (~0.5s at 60Hz = 30 ticks) */
const DEBUG_SEGMENT_MAX_AGE = 30;

// ─── Queries ─────────────────────────────────────────────────────────────────

const tracerQuery = defineQuery([CombatStateComponent, TracerTag]);

// ─── Reusable math objects (avoid per-frame allocation) ──────────────────────

const _localPoint = new THREE.Vector3();
const _worldPoint = new THREE.Vector3();
const _boneMatrix = new THREE.Matrix4();
const _sweepCenter = new THREE.Vector3();
const _sweepDir = new THREE.Vector3();
const _sweepQuat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

// ─── System ──────────────────────────────────────────────────────────────────

/**
 * TracerSystem — runs in fixedUpdate only.
 *
 * During the Release phase of an attack, transforms weapon tracer points from
 * local to world space each tick, then tests swept volumes between consecutive
 * tick positions against enemy hitbox sensor colliders using Rapier shape casts.
 *
 * On hit: creates a DamageEvent entity for same-tick processing.
 */
export function TracerSystem(world: World, _dt: number): void {
  currentTick++;

  // Prune old debug segments
  pruneDebugSegments();

  const entities = tracerQuery(world.ecs);

  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    const state = CombatStateComponent.state[eid] as CombatState;

    if (state === CombatState.Release) {
      processReleaseEntity(world, eid);
    } else {
      // Not in Release — clean up tracer state if it exists
      if (tracerStates.has(eid)) {
        tracerStates.delete(eid);
      }
    }
  }
}

/**
 * Process tracer detection for a single entity in Release state.
 */
function processReleaseEntity(world: World, eid: number): void {
  const weaponId = CombatStateComponent.weaponId[eid];
  const config = weaponConfigMap.get(weaponId);
  if (!config) return;

  const bone = weaponBoneMap.get(eid);
  if (!bone) return;

  // Get weapon bone world matrix
  bone.updateWorldMatrix(true, false);
  _boneMatrix.copy(bone.matrixWorld);

  // Transform tracer points to world space
  const worldPositions = transformTracerPoints(config.tracerPoints, _boneMatrix);

  // Get or create tracer state
  let tracerState = tracerStates.get(eid);
  if (!tracerState) {
    tracerState = {
      prevPositions: worldPositions,
      hasPrevious: false,
      hitEntities: new Set(),
    };
    tracerStates.set(eid, tracerState);
    // First tick — store positions but skip detection (no prev data)
    tracerState.prevPositions = worldPositions;
    tracerState.hasPrevious = true;
    return;
  }

  if (!tracerState.hasPrevious) {
    tracerState.prevPositions = worldPositions;
    tracerState.hasPrevious = true;
    return;
  }

  // For each pair of adjacent tracer points, sweep between ticks
  const attackDir = CombatStateComponent.attackDirection[eid];

  for (let t = 0; t < worldPositions.length - 1; t++) {
    // Swept quad vertices:
    // prev_i, curr_i, curr_i+1, prev_i+1
    const prevA = tracerState.prevPositions[t];
    const currA = worldPositions[t];
    const prevB = tracerState.prevPositions[t + 1];
    const currB = worldPositions[t + 1];

    // Record debug segments
    debugTracerSegments.push(
      { from: new THREE.Vector3(prevA.x, prevA.y, prevA.z), to: new THREE.Vector3(currA.x, currA.y, currA.z), birthTick: currentTick },
      { from: new THREE.Vector3(prevB.x, prevB.y, prevB.z), to: new THREE.Vector3(currB.x, currB.y, currB.z), birthTick: currentTick },
      { from: new THREE.Vector3(currA.x, currA.y, currA.z), to: new THREE.Vector3(currB.x, currB.y, currB.z), birthTick: currentTick },
    );

    // Sweep each tracer segment (from prevA→currA and prevB→currB)
    // Use the midpoint of the quad as the swept shape center
    sweepTracerSegment(world, eid, prevA, currA, config, attackDir, tracerState);
    sweepTracerSegment(world, eid, prevB, currB, config, attackDir, tracerState);
  }

  // Store current positions as previous for next tick
  tracerState.prevPositions = worldPositions;
}

/**
 * Transform tracer points from weapon-local space to world space.
 */
function transformTracerPoints(
  points: TracerPoint[],
  worldMatrix: THREE.Matrix4,
): TracerWorldPos[] {
  const result: TracerWorldPos[] = [];
  for (let i = 0; i < points.length; i++) {
    const [lx, ly, lz] = points[i];
    _localPoint.set(lx, ly, lz);
    _worldPoint.copy(_localPoint).applyMatrix4(worldMatrix);
    result.push({ x: _worldPoint.x, y: _worldPoint.y, z: _worldPoint.z });
  }
  return result;
}

/**
 * Sweep a thin shape from prevPos to currPos using Rapier shape intersection.
 * Uses intersectionsWithShape at the midpoint with a thin cuboid oriented along the sweep.
 */
function sweepTracerSegment(
  world: World,
  attackerEid: number,
  prevPos: TracerWorldPos,
  currPos: TracerWorldPos,
  config: WeaponConfig,
  attackDir: number,
  tracerState: TracerEntityState,
): void {
  // Calculate sweep vector
  const dx = currPos.x - prevPos.x;
  const dy = currPos.y - prevPos.y;
  const dz = currPos.z - prevPos.z;
  const sweepLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Skip if tracer barely moved (avoid degenerate shapes)
  if (sweepLength < 0.001) return;

  // Midpoint of the sweep
  _sweepCenter.set(
    (prevPos.x + currPos.x) * 0.5,
    (prevPos.y + currPos.y) * 0.5,
    (prevPos.z + currPos.z) * 0.5,
  );

  // Orientation: align cuboid Z-axis along sweep direction
  _sweepDir.set(dx, dy, dz).normalize();

  // Build rotation quaternion from default Z-forward to sweep direction
  const dotUp = Math.abs(_sweepDir.dot(_up));
  if (dotUp > 0.999) {
    // Nearly parallel to up — use X as reference axis
    _sweepQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _sweepDir);
  } else {
    _sweepQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _sweepDir);
  }

  // Thin cuboid: small X/Y extent (blade thickness), Z = half sweep length
  const BLADE_HALF_THICKNESS = 0.03;
  const BLADE_HALF_WIDTH = 0.02;
  const shape = new RAPIER.Cuboid(
    BLADE_HALF_WIDTH,
    BLADE_HALF_THICKNESS,
    sweepLength * 0.5,
  );

  const shapePos = new RAPIER.Vector3(
    _sweepCenter.x,
    _sweepCenter.y,
    _sweepCenter.z,
  );
  const shapeRot = new RAPIER.Quaternion(
    _sweepQuat.x,
    _sweepQuat.y,
    _sweepQuat.z,
    _sweepQuat.w,
  );

  // Query intersections with sensor colliders
  world.rapierWorld.intersectionsWithShape(
    shapePos,
    shapeRot,
    shape,
    (collider) => {
      // Only interested in sensor colliders (hitboxes)
      if (!collider.isSensor()) return true; // continue

      const handle = collider.handle;
      const hitboxInfo = colliderToHitbox.get(handle);
      if (!hitboxInfo) return true; // unknown collider, skip

      // Don't hit yourself
      if (hitboxInfo.ownerEid === attackerEid) return true;

      // Already hit this entity this swing?
      if (tracerState.hitEntities.has(hitboxInfo.ownerEid)) return true;

      // Register the hit — first region wins, no multi-region per swing
      tracerState.hitEntities.add(hitboxInfo.ownerEid);

      // Create a DamageEvent entity for same-tick processing
      emitDamageEvent(
        world,
        hitboxInfo.ownerEid,
        attackerEid,
        config,
        attackDir,
        hitboxInfo.bodyRegion,
      );

      return true; // continue checking (other entities might be in the sweep)
    },
  );
}

/**
 * Create a DamageEvent ECS entity for same-tick processing by DamageSystem.
 */
function emitDamageEvent(
  world: World,
  targetEid: number,
  attackerEid: number,
  config: WeaponConfig,
  attackDir: number,
  bodyRegion: BodyRegion,
): void {
  // Look up damage from weapon config
  const directionDamage = config.damage[attackDir as keyof typeof config.damage];
  const damage = directionDamage?.[bodyRegion] ?? 0;

  if (damage <= 0) return;

  const eventEid = addEntity(world.ecs);
  addComponent(world.ecs, DamageEvent, eventEid);

  DamageEvent.targetEid[eventEid] = targetEid;
  DamageEvent.attackerEid[eventEid] = attackerEid;
  DamageEvent.damage[eventEid] = damage;
  DamageEvent.bodyRegion[eventEid] = bodyRegion;
  DamageEvent.attackDirection[eventEid] = attackDir;
  DamageEvent.processed[eventEid] = 0;
}

/**
 * Remove debug segments older than DEBUG_SEGMENT_MAX_AGE ticks.
 */
function pruneDebugSegments(): void {
  const cutoff = currentTick - DEBUG_SEGMENT_MAX_AGE;
  let writeIdx = 0;
  for (let i = 0; i < debugTracerSegments.length; i++) {
    if (debugTracerSegments[i].birthTick >= cutoff) {
      debugTracerSegments[writeIdx] = debugTracerSegments[i];
      writeIdx++;
    }
  }
  debugTracerSegments.length = writeIdx;
}

/**
 * Reset tracer state for an entity. Call when a swing ends
 * (transitioning out of Release).
 */
export function resetTracerState(eid: number): void {
  tracerStates.delete(eid);
}
