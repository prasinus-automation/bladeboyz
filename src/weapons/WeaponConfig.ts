/**
 * Data-driven weapon configuration.
 * All timing values are in ticks (1 tick = 1/60s).
 * All turncap values are in radians per tick.
 */
export interface WeaponConfig {
  /** Display name */
  name: string;

  /** Unique identifier for lookup tables */
  id: number;

  // --- Timing (ticks) ---

  /** Windup duration before the blade becomes active */
  windupTicks: number;
  /** Release (active swing) duration */
  releaseTicks: number;
  /** Recovery after a swing completes */
  recoveryTicks: number;
  /** Shorter recovery when chaining a combo */
  comboRecoveryTicks: number;
  /** Riposte windup duration (faster than normal windup) */
  riposteWindupTicks: number;
  /** Feint recovery duration */
  feintRecoveryTicks: number;
  /** Parry window duration at start of block (ticks) */
  parryWindowTicks: number;
  /** HitStun duration when struck (universal, but stored per weapon for flexibility) */
  hitStunTicks: number;
  /** Clash stagger duration */
  clashTicks: number;

  // --- Turncaps (radians per tick) ---

  /** Turn rate during Idle (no restriction — set very high) */
  turncapIdle: number;
  /** Turn rate during Windup */
  turncapWindup: number;
  /** Turn rate during Release (most restrictive) */
  turncapRelease: number;
  /** Turn rate during Recovery */
  turncapRecovery: number;
  /** Turn rate while blocking */
  turncapBlock: number;
  /** Turn rate during Feint recovery */
  turncapFeint: number;

  // --- Damage & Stamina ---

  /** Base damage on hit */
  damage: number;
  /** Stamina cost to start an attack */
  staminaCostAttack: number;
  /** Stamina cost to feint */
  staminaCostFeint: number;
  /** Stamina drained from blocker on blocked hit */
  staminaDrainBlock: number;
}

/** Global weapon config registry keyed by weapon ID */
export const weaponRegistry = new Map<number, WeaponConfig>();

export function registerWeapon(config: WeaponConfig): void {
  weaponRegistry.set(config.id, config);
}
