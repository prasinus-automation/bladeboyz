import { CombatStateEnum, CombatInput } from './states';
import { AttackDirection } from './directions';
import type { WeaponConfig } from '../weapons/WeaponConfig';

/**
 * Per-entity combat finite state machine.
 *
 * Pure TypeScript logic — no Three.js, no Rapier dependency.
 * Designed to be unit-testable in isolation and future-networkable.
 *
 * All timing is in ticks (1 tick = 1/60s).
 * All turncaps are in radians/tick.
 */
export class CombatFSM {
  /** Current FSM state */
  private state: CombatStateEnum = CombatStateEnum.Idle;

  /** Ticks remaining in current timed state (0 = no timer) */
  private ticksRemaining = 0;

  /** Current attack direction */
  private direction: AttackDirection = AttackDirection.None;

  /** Weapon configuration driving all timings */
  private weaponConfig: WeaponConfig;

  /** Buffered attack input for combo support */
  private bufferedAttack = false;

  /** Buffered attack direction for combo */
  private bufferedDirection: AttackDirection = AttackDirection.None;

  /** Whether this entity is currently holding block input */
  private blockHeld = false;

  /** Stamina cost of the last transition (read by stamina system) */
  private lastStaminaCost = 0;

  constructor(weaponConfig: WeaponConfig) {
    this.weaponConfig = weaponConfig;
  }

  // ── Getters ──────────────────────────────────────────────

  getCurrentState(): CombatStateEnum {
    return this.state;
  }

  getTicksRemaining(): number {
    return this.ticksRemaining;
  }

  getAttackDirection(): AttackDirection {
    return this.direction;
  }

  getWeaponConfig(): WeaponConfig {
    return this.weaponConfig;
  }

  /**
   * Returns the current turncap in radians/tick.
   * The camera system reads this to clamp mouse look.
   */
  getCurrentTurncap(): number {
    const cfg = this.weaponConfig;
    switch (this.state) {
      case CombatStateEnum.Idle:
        return cfg.turncapIdle;
      case CombatStateEnum.Windup:
      case CombatStateEnum.Riposte:
        return cfg.turncapWindup;
      case CombatStateEnum.Release:
        return cfg.turncapRelease;
      case CombatStateEnum.Recovery:
        return cfg.turncapRecovery;
      case CombatStateEnum.Block:
      case CombatStateEnum.ParryWindow:
        return cfg.turncapBlock;
      case CombatStateEnum.Feint:
        return cfg.turncapFeint;
      case CombatStateEnum.Clash:
      case CombatStateEnum.Stunned:
      case CombatStateEnum.HitStun:
        return 0; // Cannot turn while stunned/clashing
      default:
        return cfg.turncapIdle;
    }
  }

  /**
   * Returns stamina cost of the last transition.
   * Stamina system should read and clear this each tick.
   */
  getStaminaCost(): number {
    return this.lastStaminaCost;
  }

  /** Reset stamina cost after the stamina system has consumed it */
  clearStaminaCost(): void {
    this.lastStaminaCost = 0;
  }

  // ── State transitions ───────────────────────────────────

  /**
   * Query whether a given input can trigger a transition from the current state.
   */
  canTransition(input: CombatInput, direction?: AttackDirection): boolean {
    switch (this.state) {
      case CombatStateEnum.Idle:
        return input === CombatInput.AttackStart ||
               input === CombatInput.BlockStart ||
               input === CombatInput.HitReceived;

      case CombatStateEnum.Windup:
        // Morph: attack in different direction
        if (input === CombatInput.AttackStart && direction !== undefined && direction !== this.direction) {
          return true;
        }
        return input === CombatInput.FeintInput ||
               input === CombatInput.HitReceived ||
               input === CombatInput.ClashTriggered;

      case CombatStateEnum.Release:
        return input === CombatInput.AttackLanded ||
               input === CombatInput.HitReceived ||
               input === CombatInput.ClashTriggered;

      case CombatStateEnum.Recovery:
        // Buffer attacks for combos
        return input === CombatInput.AttackStart ||
               input === CombatInput.HitReceived;

      case CombatStateEnum.Block:
        return input === CombatInput.BlockEnd ||
               input === CombatInput.BlockHitReceived ||
               input === CombatInput.HitReceived;

      case CombatStateEnum.ParryWindow:
        return input === CombatInput.ParryTriggered ||
               input === CombatInput.BlockEnd ||
               input === CombatInput.HitReceived;

      case CombatStateEnum.Riposte:
        // Riposte acts like a windup — can be hit out of it
        return input === CombatInput.HitReceived ||
               input === CombatInput.ClashTriggered;

      case CombatStateEnum.Feint:
      case CombatStateEnum.Clash:
      case CombatStateEnum.Stunned:
      case CombatStateEnum.HitStun:
        // Locked — only external hit can override HitStun
        return input === CombatInput.HitReceived;

      default:
        return false;
    }
  }

  /**
   * Attempt a state transition. Returns true if the transition occurred.
   */
  transition(input: CombatInput, direction: AttackDirection = AttackDirection.None): boolean {
    if (!this.canTransition(input, direction)) {
      return false;
    }

    switch (this.state) {
      case CombatStateEnum.Idle:
        return this.handleIdleTransition(input, direction);

      case CombatStateEnum.Windup:
        return this.handleWindupTransition(input, direction);

      case CombatStateEnum.Release:
        return this.handleReleaseTransition(input);

      case CombatStateEnum.Recovery:
        return this.handleRecoveryTransition(input, direction);

      case CombatStateEnum.Block:
        return this.handleBlockTransition(input);

      case CombatStateEnum.ParryWindow:
        return this.handleParryWindowTransition(input);

      case CombatStateEnum.Riposte:
        return this.handleRiposteTransition(input);

      case CombatStateEnum.Feint:
      case CombatStateEnum.Clash:
      case CombatStateEnum.Stunned:
      case CombatStateEnum.HitStun:
        // Only HitReceived can interrupt these (re-enter HitStun)
        if (input === CombatInput.HitReceived) {
          this.enterHitStun();
          return true;
        }
        return false;

      default:
        return false;
    }
  }

  // ── Tick ─────────────────────────────────────────────────

  /**
   * Advance the FSM by one tick. Decrements timers and auto-transitions
   * when they expire. Must be called once per fixedUpdate.
   */
  tick(): void {
    if (this.ticksRemaining > 0) {
      this.ticksRemaining--;

      if (this.ticksRemaining === 0) {
        this.onTimerExpired();
      }
    }
  }

  // ── Force state (for external systems like networking) ──

  /**
   * Force the FSM into a specific state. Use sparingly — mainly for
   * network sync or debug tooling.
   */
  forceState(state: CombatStateEnum, ticks: number, dir: AttackDirection = AttackDirection.None): void {
    this.state = state;
    this.ticksRemaining = ticks;
    this.direction = dir;
    this.bufferedAttack = false;
    this.lastStaminaCost = 0;
  }

  /** Swap weapon config (e.g., on weapon pickup) */
  setWeaponConfig(config: WeaponConfig): void {
    this.weaponConfig = config;
  }

  // ── Private: state entry helpers ────────────────────────

  private enterState(state: CombatStateEnum, ticks: number, dir: AttackDirection = this.direction): void {
    this.state = state;
    this.ticksRemaining = ticks;
    this.direction = dir;
  }

  private enterWindup(dir: AttackDirection): void {
    this.enterState(CombatStateEnum.Windup, this.weaponConfig.windupTicks, dir);
    this.lastStaminaCost = this.weaponConfig.staminaCostAttack;
    this.bufferedAttack = false;
  }

  private enterRelease(): void {
    this.enterState(CombatStateEnum.Release, this.weaponConfig.releaseTicks);
  }

  private enterRecovery(combo = false): void {
    const ticks = combo ? this.weaponConfig.comboRecoveryTicks : this.weaponConfig.recoveryTicks;
    this.enterState(CombatStateEnum.Recovery, ticks);
  }

  private enterBlock(): void {
    // Block starts with ParryWindow sub-state
    this.enterState(CombatStateEnum.ParryWindow, this.weaponConfig.parryWindowTicks, AttackDirection.None);
    this.blockHeld = true;
  }

  private enterFeint(): void {
    this.enterState(CombatStateEnum.Feint, this.weaponConfig.feintRecoveryTicks);
    this.lastStaminaCost = this.weaponConfig.staminaCostFeint;
  }

  private enterHitStun(): void {
    this.enterState(CombatStateEnum.HitStun, this.weaponConfig.hitStunTicks, AttackDirection.None);
    this.bufferedAttack = false;
  }

  private enterClash(): void {
    this.enterState(CombatStateEnum.Clash, this.weaponConfig.clashTicks, AttackDirection.None);
    this.bufferedAttack = false;
  }

  private enterRiposte(dir: AttackDirection): void {
    this.enterState(CombatStateEnum.Riposte, this.weaponConfig.riposteWindupTicks, dir);
    this.lastStaminaCost = this.weaponConfig.staminaCostAttack;
  }

  // ── Private: transition handlers ────────────────────────

  private handleIdleTransition(input: CombatInput, dir: AttackDirection): boolean {
    switch (input) {
      case CombatInput.AttackStart:
        if (dir === AttackDirection.None) return false;
        this.enterWindup(dir);
        return true;

      case CombatInput.BlockStart:
        this.enterBlock();
        return true;

      case CombatInput.HitReceived:
        this.enterHitStun();
        return true;

      default:
        return false;
    }
  }

  private handleWindupTransition(input: CombatInput, dir: AttackDirection): boolean {
    switch (input) {
      case CombatInput.AttackStart:
        // Morph — restart windup with new direction
        if (dir !== AttackDirection.None && dir !== this.direction) {
          this.enterWindup(dir);
          return true;
        }
        return false;

      case CombatInput.FeintInput:
        this.enterFeint();
        return true;

      case CombatInput.HitReceived:
        this.enterHitStun();
        return true;

      case CombatInput.ClashTriggered:
        this.enterClash();
        return true;

      default:
        return false;
    }
  }

  private handleReleaseTransition(input: CombatInput): boolean {
    switch (input) {
      case CombatInput.AttackLanded:
        // Hit landed — continue release, target gets HitStun (handled externally)
        // Optionally could transition to Recovery early, but standard is to let release finish
        return true;

      case CombatInput.HitReceived:
        this.enterHitStun();
        return true;

      case CombatInput.ClashTriggered:
        this.enterClash();
        return true;

      default:
        return false;
    }
  }

  private handleRecoveryTransition(input: CombatInput, dir: AttackDirection): boolean {
    switch (input) {
      case CombatInput.AttackStart:
        // Buffer combo attack — will be consumed when recovery timer expires
        if (dir !== AttackDirection.None) {
          this.bufferedAttack = true;
          this.bufferedDirection = dir;
        }
        return true;

      case CombatInput.HitReceived:
        this.enterHitStun();
        return true;

      default:
        return false;
    }
  }

  private handleBlockTransition(input: CombatInput): boolean {
    switch (input) {
      case CombatInput.BlockEnd:
        this.blockHeld = false;
        this.enterState(CombatStateEnum.Idle, 0, AttackDirection.None);
        return true;

      case CombatInput.BlockHitReceived:
        // Successful block — attacker bounces to Recovery (handled externally)
        // Stamina drain handled by stamina system reading weapon config
        return true;

      case CombatInput.HitReceived:
        // Hit from wrong direction while blocking
        this.enterHitStun();
        return true;

      default:
        return false;
    }
  }

  private handleParryWindowTransition(input: CombatInput): boolean {
    switch (input) {
      case CombatInput.ParryTriggered:
        // Parry! Wait for attack input to riposte, or decay to block
        // For simplicity, auto-transition to Idle with a brief parry stagger on the attacker (external)
        // The player can then attack for a riposte
        this.enterState(CombatStateEnum.Idle, 0, AttackDirection.None);
        return true;

      case CombatInput.BlockEnd:
        this.blockHeld = false;
        this.enterState(CombatStateEnum.Idle, 0, AttackDirection.None);
        return true;

      case CombatInput.HitReceived:
        // Hit that bypasses parry (e.g., wrong direction)
        this.enterHitStun();
        return true;

      default:
        return false;
    }
  }

  private handleRiposteTransition(input: CombatInput): boolean {
    switch (input) {
      case CombatInput.HitReceived:
        this.enterHitStun();
        return true;

      case CombatInput.ClashTriggered:
        this.enterClash();
        return true;

      default:
        return false;
    }
  }

  // ── Private: timer expiry auto-transitions ──────────────

  private onTimerExpired(): void {
    switch (this.state) {
      case CombatStateEnum.Windup:
        this.enterRelease();
        break;

      case CombatStateEnum.Riposte:
        // Riposte windup → Release (same as normal windup)
        this.enterRelease();
        break;

      case CombatStateEnum.Release:
        this.enterRecovery(false);
        break;

      case CombatStateEnum.Recovery:
        // Check for buffered combo
        if (this.bufferedAttack && this.bufferedDirection !== AttackDirection.None) {
          this.bufferedAttack = false;
          // Combo: enter windup with combo recovery timing
          // The combo recovery already happened — go straight to windup
          this.enterWindup(this.bufferedDirection);
          return;
        }
        // Return to Idle
        this.enterState(CombatStateEnum.Idle, 0, AttackDirection.None);
        break;

      case CombatStateEnum.ParryWindow:
        // Parry window expired — transition to regular Block if still holding
        if (this.blockHeld) {
          this.enterState(CombatStateEnum.Block, 0, AttackDirection.None);
        } else {
          this.enterState(CombatStateEnum.Idle, 0, AttackDirection.None);
        }
        break;

      case CombatStateEnum.Feint:
        this.enterState(CombatStateEnum.Idle, 0, AttackDirection.None);
        break;

      case CombatStateEnum.Clash:
        this.enterState(CombatStateEnum.Idle, 0, AttackDirection.None);
        break;

      case CombatStateEnum.Stunned:
        this.enterState(CombatStateEnum.Idle, 0, AttackDirection.None);
        break;

      case CombatStateEnum.HitStun:
        this.enterRecovery(false);
        break;

      // Idle and Block have no timer
      default:
        break;
    }
  }
}
