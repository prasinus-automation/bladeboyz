import type { AttackDirection, BodyRegion } from '../combat/states';

/** A point in weapon-local space where tracer detection samples [x, y, z] */
export type TracerPoint = [number, number, number];

/** Per-direction timing (in ticks at 60Hz) */
export interface DirectionTiming {
  windupTicks: number;
  releaseTicks: number;
  recoveryTicks: number;
  comboRecoveryTicks: number;
  feintWindowTicks: number;
  morphWindowTicks: number;
}

/** Damage values keyed by body region */
export type RegionDamage = Partial<Record<BodyRegion, number>>;

/** Per-direction damage values */
export type DirectionDamage = Partial<Record<AttackDirection, RegionDamage>>;

/** Full weapon configuration — all combat behavior is data-driven from this */
export interface WeaponConfig {
  name: string;

  /** Tracer sample points along the blade in weapon-local space */
  tracerPoints: TracerPoint[];

  /** Timing per attack direction */
  timing: Partial<Record<AttackDirection, DirectionTiming>>;

  /** Damage per attack direction per body region */
  damage: DirectionDamage;

  /** Base stamina cost to swing */
  staminaCost: number;

  /** Stamina drained from blocker on hit */
  blockStaminaDrain: number;

  /** Extra recovery ticks applied to attacker on parry */
  parryStunTicks: number;

  /** HitStun ticks applied to the target on unblocked hit */
  hitStunTicks: number;

  /** Turn-rate cap multipliers per state (1.0 = normal) */
  turncaps: Partial<Record<number, number>>;

  /** Length of weapon (used for debug viz) */
  length: number;
}

/** Global weapon config registry by weapon name */
export const weaponConfigs = new Map<string, WeaponConfig>();
