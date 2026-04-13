/**
 * CombatFSM — Per-entity finite state machine for directional melee combat.
 *
 * Pure TypeScript logic — no Three.js, no Rapier, no DOM dependencies.
 * All timing is in ticks (1 tick = 1/60th second at 60Hz fixed update).
 *
 * The FSM manages state transitions, timer countdowns, turncap lookup,
 * and combo buffering. External systems read the FSM's current state
 * to drive animations, hit detection, and stamina costs.
 */

import { CombatState } from './states';
import { AttackDirection, BlockDirection } from './directions';
import type { WeaponConfig } from '../weapons/WeaponConfig';

// ── Input types ──────────────────────────────────────────

/** Inputs the FSM can react to */
export const enum CombatInput {
  Attack = 0,
  Block = 1,
  ReleaseBlock = 2,
  /** Feint = right-click during windup */
  Feint = 3,
  /** External: target was hit while in Release */
  HitLanded = 4,
  /** External: entity was hit while not blocking correctly */
  HitReceived = 5,
  /** External: entity blocked an attack (correct direction) */
  BlockedHit = 6,
  /** External: entity was parried */
  WasParried = 7,
  /** External: parry window entity received a hit */
  ParryTriggered = 8,
}

// ── Stamina cost event type ──────────────────────────────

export interface FSMStaminaEvent {
  type: 'attack' | 'block' | 'parry' | 'feint';
}

// ── FSM class ────────────────────────────────────────────

export class CombatFSM {
  private _state: CombatState = CombatState.Idle;
  private _ticksRemaining = 0;
  private _attackDirection: AttackDirection = AttackDirection.Stab;
  private _blockDirection: BlockDirection = BlockDirection.Top;
  private _weaponConfig: WeaponConfig;

  /** Buffered attack input during Recovery for combo chaining */
  private _comboBuffered = false;
  private _comboDirection: AttackDirection = AttackDirection.Stab;

  /** Pending stamina events produced this tick, consumed by CombatSystem */
  private _pendingStaminaEvents: FSMStaminaEvent[] = [];

  /** Whether the current recovery is a combo recovery (shorter timing) */
  private _isComboRecovery = false;

  constructor(weaponConfig: WeaponConfig) {
    this._weaponConfig = weaponConfig;
  }

  // ── Getters ──────────────────────────────────────────

  get state(): CombatState {
    return this._state;
  }

  get ticksRemaining(): number {
    return this._ticksRemaining;
  }

  get attackDirection(): AttackDirection {
    return this._attackDirection;
  }

  get blockDirection(): BlockDirection {
    return this._blockDirection;
  }

  get weaponConfig(): WeaponConfig {
    return this._weaponConfig;
  }

  /** Drain pending stamina events (caller is responsible for applying them) */
  drainStaminaEvents(): FSMStaminaEvent[] {
    const events = this._pendingStaminaEvents;
    this._pendingStaminaEvents = [];
    return events;
  }

  /** Set a new weapon config (e.g., on weapon switch) */
  setWeaponConfig(config: WeaponConfig): void {
    this._weaponConfig = config;
  }

  // ── Turncap ──────────────────────────────────────────

  /**
   * Get the current maximum turn rate in radians/tick.
   * Returns Infinity when there is no cap (Idle, Block, etc.).
   */
  getCurrentTurncap(): number {
    switch (this._state) {
      case CombatState.Windup:
        return this._weaponConfig.turncap.windup;
      case CombatState.Release:
      case CombatState.Riposte:
        return this._weaponConfig.turncap.release;
      case CombatState.Recovery:
      case CombatState.Feint:
        return this._weaponConfig.turncap.recovery;
      default:
        return Infinity;
    }
  }

  // ── Transition logic ─────────────────────────────────

  /**
   * Check whether a given input can produce a transition from the current state.
   */
  canTransition(input: CombatInput): boolean {
    switch (input) {
      case CombatInput.Attack:
        return (
          this._state === CombatState.Idle ||
          this._state === CombatState.Recovery || // combo buffer
          this._state === CombatState.Windup // morph (different direction)
        );

      case CombatInput.Block:
        return this._state === CombatState.Idle;

      case CombatInput.ReleaseBlock:
        return (
          this._state === CombatState.Block ||
          this._state === CombatState.ParryWindow
        );

      case CombatInput.Feint:
        return this._state === CombatState.Windup;

      case CombatInput.HitReceived:
        return (
          this._state !== CombatState.HitStun &&
          this._state !== CombatState.Stunned
        );

      case CombatInput.BlockedHit:
        return (
          this._state === CombatState.Block ||
          this._state === CombatState.ParryWindow
        );

      case CombatInput.WasParried:
        return this._state === CombatState.Release;

      case CombatInput.ParryTriggered:
        return this._state === CombatState.ParryWindow;

      case CombatInput.HitLanded:
        return this._state === CombatState.Release;

      default:
        return false;
    }
  }

  /**
   * Attempt a state transition based on the given input and direction.
   * Returns true if a transition occurred.
   */
  transition(
    input: CombatInput,
    attackDir?: AttackDirection,
    blockDir?: BlockDirection,
  ): boolean {
    if (!this.canTransition(input)) return false;

    switch (input) {
      case CombatInput.Attack:
        return this._handleAttack(attackDir ?? AttackDirection.Stab);

      case CombatInput.Block:
        return this._handleBlock(blockDir ?? BlockDirection.Top);

      case CombatInput.ReleaseBlock:
        return this._handleReleaseBlock();

      case CombatInput.Feint:
        return this._handleFeint();

      case CombatInput.HitReceived:
        return this._handleHitReceived();

      case CombatInput.BlockedHit:
        return this._handleBlockedHit();

      case CombatInput.WasParried:
        return this._handleWasParried();

      case CombatInput.ParryTriggered:
        return this._handleParryTriggered();

      case CombatInput.HitLanded:
        // Hit landed — no state change for attacker, they continue through Release
        return true;

      default:
        return false;
    }
  }

  // ── Tick (called once per fixed update) ──────────────

  /**
   * Advance the FSM by one tick. Decrements timers and auto-transitions
   * when timers expire.
   */
  tick(): void {
    if (this._ticksRemaining > 0) {
      this._ticksRemaining--;

      if (this._ticksRemaining === 0) {
        this._onTimerExpired();
      }
    }
  }

  // ── Private: input handlers ──────────────────────────

  private _handleAttack(direction: AttackDirection): boolean {
    if (this._state === CombatState.Recovery) {
      // Buffer combo input — will fire when Recovery timer expires
      this._comboBuffered = true;
      this._comboDirection = direction;
      return true;
    }

    if (this._state === CombatState.Windup) {
      // Morph: change attack direction, restart windup
      if (direction === this._attackDirection) return false; // same direction = no morph
      this._attackDirection = direction;
      this._ticksRemaining = this._weaponConfig.windup[direction];
      // No extra stamina cost for morph
      return true;
    }

    // Idle → Windup
    this._enterWindup(direction);
    return true;
  }

  private _handleBlock(direction: BlockDirection): boolean {
    this._blockDirection = direction;
    this._state = CombatState.ParryWindow;
    this._ticksRemaining = this._weaponConfig.parryWindow;
    return true;
  }

  private _handleReleaseBlock(): boolean {
    this._state = CombatState.Idle;
    this._ticksRemaining = 0;
    return true;
  }

  private _handleFeint(): boolean {
    // Windup → Feint → Recovery
    this._state = CombatState.Feint;
    // Feint has a brief duration then auto-transitions to Recovery
    this._ticksRemaining = 3; // brief feint animation (~50ms)
    this._pendingStaminaEvents.push({ type: 'feint' });
    return true;
  }

  private _handleHitReceived(): boolean {
    this._state = CombatState.HitStun;
    this._ticksRemaining = this._weaponConfig.hitStunTicks;
    this._comboBuffered = false;
    return true;
  }

  private _handleBlockedHit(): boolean {
    // Stay in Block state, stamina drain handled externally
    this._pendingStaminaEvents.push({ type: 'block' });
    return true;
  }

  private _handleWasParried(): boolean {
    // Attacker gets stunned from parry
    this._state = CombatState.Stunned;
    this._ticksRemaining = this._weaponConfig.parryStunTicks;
    this._comboBuffered = false;
    return true;
  }

  private _handleParryTriggered(): boolean {
    // Successful parry — transition to Riposte-ready state
    // The parry window entity enters Riposte, which acts like Windup
    // but with Release-level turncap for the counter-attack
    this._state = CombatState.Riposte;
    // Riposte windup is shorter than normal — use the stab windup as baseline
    this._ticksRemaining = Math.max(
      3,
      Math.floor(this._weaponConfig.windup[this._attackDirection] * 0.5),
    );
    this._pendingStaminaEvents.push({ type: 'parry' });
    return true;
  }

  // ── Private: state entry helpers ─────────────────────

  private _enterWindup(direction: AttackDirection): void {
    this._state = CombatState.Windup;
    this._attackDirection = direction;
    this._ticksRemaining = this._weaponConfig.windup[direction];
    this._pendingStaminaEvents.push({ type: 'attack' });
  }

  private _enterRelease(): void {
    this._state = CombatState.Release;
    this._ticksRemaining = this._weaponConfig.release[this._attackDirection];
  }

  private _enterRecovery(isCombo: boolean): void {
    this._state = CombatState.Recovery;
    this._isComboRecovery = isCombo;
    const timings = isCombo
      ? this._weaponConfig.comboRecovery
      : this._weaponConfig.recovery;
    this._ticksRemaining = timings[this._attackDirection];
  }

  // ── Private: timer expiry auto-transitions ───────────

  private _onTimerExpired(): void {
    switch (this._state) {
      case CombatState.Windup:
        // Windup → Release
        this._enterRelease();
        break;

      case CombatState.Release:
        // Release → Recovery
        this._enterRecovery(false);
        break;

      case CombatState.Recovery:
        if (this._comboBuffered) {
          // Combo chain: Recovery → Windup with combo recovery
          const dir = this._comboDirection;
          this._comboBuffered = false;
          this._enterWindup(dir);
        } else {
          this._state = CombatState.Idle;
        }
        break;

      case CombatState.ParryWindow:
        // Parry window expired → transition to regular Block
        this._state = CombatState.Block;
        this._ticksRemaining = 0; // Block has no timer (held state)
        break;

      case CombatState.Riposte:
        // Riposte windup complete → Release
        this._enterRelease();
        break;

      case CombatState.Feint:
        // Feint → Recovery (full recovery, not combo)
        this._enterRecovery(false);
        break;

      case CombatState.HitStun:
        // HitStun → Recovery
        this._enterRecovery(false);
        break;

      case CombatState.Stunned:
        // Stunned (from parry) → Recovery
        this._enterRecovery(false);
        break;

      case CombatState.Clash:
        // Clash → Recovery
        this._enterRecovery(false);
        break;

      default:
        // Idle, Block — no auto-transition
        break;
    }
  }

  // ── Utility ──────────────────────────────────────────

  /**
   * Get the stamina cost for the current transition/state.
   * Returns the cost type string or null if no cost applies.
   */
  getStaminaCostType(): 'attack' | 'block' | 'parry' | 'feint' | null {
    switch (this._state) {
      case CombatState.Windup:
      case CombatState.Release:
        return 'attack';
      case CombatState.Block:
      case CombatState.ParryWindow:
        return 'block';
      case CombatState.Riposte:
        return 'parry';
      case CombatState.Feint:
        return 'feint';
      default:
        return null;
    }
  }

  /** Force-reset to Idle (e.g., on death/respawn) */
  reset(): void {
    this._state = CombatState.Idle;
    this._ticksRemaining = 0;
    this._comboBuffered = false;
    this._pendingStaminaEvents = [];
    this._isComboRecovery = false;
  }
}

// ── FSM Registry (side-table for per-entity instances) ───

/** Map<entityId, CombatFSM> — bitECS can't store objects in components */
export const fsmRegistry = new Map<number, CombatFSM>();

/** Create and register an FSM for an entity */
export function createFSM(entityId: number, weaponConfig: WeaponConfig): CombatFSM {
  const fsm = new CombatFSM(weaponConfig);
  fsmRegistry.set(entityId, fsm);
  return fsm;
}

/** Remove an entity's FSM */
export function removeFSM(entityId: number): void {
  fsmRegistry.delete(entityId);
}
