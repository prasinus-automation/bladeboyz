import { describe, it, expect, beforeEach } from 'vitest';
import { purchaseWeapon } from './PurchaseFlow';
import {
  setGold,
  getGold,
  resetWallet,
  addGold,
} from './Wallet';
import {
  initInventory,
  getInventory,
  resetInventorySystem,
} from '../ecs/systems/InventorySystem';
import { createFSM, fsmRegistry, CombatInput } from '../combat/CombatFSM';
import { weaponConfigs, registerWeapon } from '../weapons/WeaponConfig';
import { Direction } from '../combat/directions';
import { CombatStateComponent } from '../ecs/components';

// Import the real weapon configs so they auto-register, matching the runtime.
import '../weapons/longsword';
import '../weapons/mace';
import '../weapons/dagger';
import '../weapons/battleaxe';

const PLAYER_EID = 99;

function ensureUnsellableWeapon(): void {
  if (weaponConfigs['NotForSale']) return;
  // Register a weapon that has NO entry in `weaponPrices` so we can test
  // the `unknown_weapon` failure mode against a registered-but-priceless
  // weapon, not just a totally-missing string. This exercises the path
  // where the weapon exists in `weaponConfigs` but `getWeaponPrice`
  // returns undefined.
  const dirs = [
    Direction.Left,
    Direction.Right,
    Direction.Overhead,
    Direction.Stab,
  ];
  const dirRecord = <T>(val: T): Record<Direction, T> => {
    const r: any = {};
    for (const d of dirs) r[d] = val;
    return r;
  };
  registerWeapon({
    name: 'NotForSale',
    damage: dirRecord({ head: 10, torso: 5, limb: 3 }),
    windup: dirRecord(10),
    release: dirRecord(10),
    recovery: dirRecord(15),
    comboRecovery: dirRecord(10),
    parryWindow: 8,
    parryRecovery: 8,
    blockBreakStunTicks: 20,
    staminaCost: { attack: 5, block: 3, parry: 2 },
    turncap: { windup: 0.04, release: 0.02, recovery: 0.05, hitStun: 0.005 },
    tracerPoints: [[0, 0, 0]],
    range: 1.0,
    blockStaminaDrain: 5,
    parryStunTicks: 10,
    hitStunTicks: 5,
  });
}

beforeEach(() => {
  resetWallet();
  resetInventorySystem();
  fsmRegistry.clear();
  ensureUnsellableWeapon();
  // Player starts owning only the Dagger (matches runtime starter inventory)
  initInventory(PLAYER_EID, ['Dagger'], 'Dagger');
  // Reset CombatStateComponent so weaponId reads/writes are deterministic
  CombatStateComponent.weaponId[PLAYER_EID] = 0;
});

describe('purchaseWeapon — success path', () => {
  it('returns ok and reports the price paid', () => {
    setGold(500);
    const result = purchaseWeapon(PLAYER_EID, 'Mace');
    expect(result).toEqual({ ok: true, weaponName: 'Mace', pricePaid: 100 });
  });

  it('deducts gold by exactly the price', () => {
    setGold(500);
    purchaseWeapon(PLAYER_EID, 'Mace');
    expect(getGold()).toBe(400);
  });

  it('adds the weapon to the inventory', () => {
    setGold(500);
    purchaseWeapon(PLAYER_EID, 'Longsword');
    const inv = getInventory(PLAYER_EID)!;
    expect(inv.weapons).toContain('Longsword');
  });

  it('equips the purchased weapon (per architect note option A)', () => {
    setGold(500);
    purchaseWeapon(PLAYER_EID, 'Battleaxe');
    const inv = getInventory(PLAYER_EID)!;
    expect(inv.equippedWeapon).toBe('Battleaxe');
  });

  it('updates CombatStateComponent.weaponId on equip', () => {
    setGold(500);
    purchaseWeapon(PLAYER_EID, 'Battleaxe');
    // weaponIdToName = ['Longsword', 'Mace', 'Dagger', 'Battleaxe'] — Battleaxe is 3
    expect(CombatStateComponent.weaponId[PLAYER_EID]).toBe(3);
  });

  it('allows spending the entire balance (exact-funds purchase)', () => {
    setGold(100);
    const result = purchaseWeapon(PLAYER_EID, 'Mace');
    expect(result.ok).toBe(true);
    expect(getGold()).toBe(0);
  });
});

describe('purchaseWeapon — unknown_weapon', () => {
  it('returns failure when weapon name is not in price table', () => {
    setGold(500);
    const result = purchaseWeapon(PLAYER_EID, 'CompletelyMadeUpWeapon');
    expect(result).toEqual({ ok: false, reason: 'unknown_weapon' });
  });

  it('returns failure when weapon exists in registry but has no price', () => {
    setGold(500);
    const result = purchaseWeapon(PLAYER_EID, 'NotForSale');
    expect(result).toEqual({ ok: false, reason: 'unknown_weapon' });
  });

  it('does not deduct gold on unknown_weapon', () => {
    setGold(500);
    purchaseWeapon(PLAYER_EID, 'CompletelyMadeUpWeapon');
    expect(getGold()).toBe(500);
  });

  it('does not add the weapon to inventory on unknown_weapon', () => {
    setGold(500);
    purchaseWeapon(PLAYER_EID, 'CompletelyMadeUpWeapon');
    const inv = getInventory(PLAYER_EID)!;
    expect(inv.weapons).not.toContain('CompletelyMadeUpWeapon');
  });
});

describe('purchaseWeapon — already_owned', () => {
  it('returns failure when the weapon is already in inventory', () => {
    setGold(500);
    // Buy first
    purchaseWeapon(PLAYER_EID, 'Mace');
    // Buy again
    const result = purchaseWeapon(PLAYER_EID, 'Mace');
    expect(result).toEqual({ ok: false, reason: 'already_owned' });
  });

  it('does not deduct gold on second-buy attempt', () => {
    setGold(500);
    purchaseWeapon(PLAYER_EID, 'Mace');
    const goldAfterFirst = getGold();
    purchaseWeapon(PLAYER_EID, 'Mace');
    expect(getGold()).toBe(goldAfterFirst);
  });

  it('returns already_owned for the starter Dagger', () => {
    setGold(500);
    const result = purchaseWeapon(PLAYER_EID, 'Dagger');
    // Dagger is in starter inventory; even though its price is 0,
    // already_owned takes precedence over insufficient/zero-cost flow.
    expect(result).toEqual({ ok: false, reason: 'already_owned' });
  });
});

describe('purchaseWeapon — insufficient_gold', () => {
  it('returns failure when balance is below price', () => {
    setGold(50);
    const result = purchaseWeapon(PLAYER_EID, 'Mace'); // costs 100
    expect(result).toEqual({ ok: false, reason: 'insufficient_gold' });
  });

  it('returns failure at the exact threshold of insufficiency', () => {
    setGold(99);
    const result = purchaseWeapon(PLAYER_EID, 'Mace'); // costs 100
    expect(result.ok).toBe(false);
  });

  it('does not deduct gold on insufficient funds', () => {
    setGold(50);
    purchaseWeapon(PLAYER_EID, 'Mace');
    expect(getGold()).toBe(50);
  });

  it('does not change inventory on insufficient funds', () => {
    setGold(50);
    purchaseWeapon(PLAYER_EID, 'Mace');
    const inv = getInventory(PLAYER_EID)!;
    expect(inv.weapons).toEqual(['Dagger']);
    expect(inv.equippedWeapon).toBe('Dagger');
  });
});

describe('purchaseWeapon — no_inventory', () => {
  it('returns failure when entity has no inventory record', () => {
    setGold(500);
    const result = purchaseWeapon(/* unknown */ 12345, 'Mace');
    expect(result).toEqual({ ok: false, reason: 'no_inventory' });
  });

  it('does not deduct gold when inventory is missing', () => {
    setGold(500);
    purchaseWeapon(12345, 'Mace');
    expect(getGold()).toBe(500);
  });
});

describe('purchaseWeapon — fsm_busy', () => {
  it('returns failure when FSM is not Idle (validate up front, do NOT spend)', () => {
    setGold(500);
    // Register an FSM and put it in a non-Idle state
    const fsm = createFSM(PLAYER_EID, weaponConfigs['Dagger']);
    // Use the FSM API to enter Windup (simulating mid-combat)
    // `transition` returns true if the transition occurred.
    const ok = fsm.transition(
      CombatInput.Attack,
      Direction.Stab,
    );
    expect(ok).toBe(true); // sanity: we are now mid-combat
    expect(fsm.state).not.toBe(0); // not Idle

    const result = purchaseWeapon(PLAYER_EID, 'Mace');
    expect(result).toEqual({ ok: false, reason: 'fsm_busy' });
  });

  it('does not deduct gold when fsm_busy', () => {
    setGold(500);
    const fsm = createFSM(PLAYER_EID, weaponConfigs['Dagger']);
    fsm.transition(CombatInput.Attack, Direction.Stab);
    purchaseWeapon(PLAYER_EID, 'Mace');
    expect(getGold()).toBe(500);
  });

  it('does not modify inventory when fsm_busy', () => {
    setGold(500);
    const fsm = createFSM(PLAYER_EID, weaponConfigs['Dagger']);
    fsm.transition(CombatInput.Attack, Direction.Stab);
    purchaseWeapon(PLAYER_EID, 'Mace');
    const inv = getInventory(PLAYER_EID)!;
    expect(inv.weapons).not.toContain('Mace');
    expect(inv.equippedWeapon).toBe('Dagger');
  });

  it('treats absence of FSM as Idle (entity has no combat data)', () => {
    setGold(500);
    // No createFSM call — pure economy entity
    expect(fsmRegistry.has(PLAYER_EID)).toBe(false);
    const result = purchaseWeapon(PLAYER_EID, 'Mace');
    expect(result.ok).toBe(true);
  });
});

describe('purchaseWeapon — atomicity', () => {
  it('does not partially mutate when validation fails after one check passes', () => {
    // Start with low gold — even though weapon is unknown, gold should not
    // move. Confirms validate-then-mutate ordering.
    setGold(50);
    const result = purchaseWeapon(PLAYER_EID, 'CompletelyMadeUpWeapon');
    expect(result.ok).toBe(false);
    expect(getGold()).toBe(50);
    expect(getInventory(PLAYER_EID)!.weapons).toEqual(['Dagger']);
  });

  it('post-success state matches: gold decreased exactly, weapon owned, weapon equipped', () => {
    setGold(500);
    const result = purchaseWeapon(PLAYER_EID, 'Longsword');
    expect(result.ok).toBe(true);
    expect(getGold()).toBe(500 - 150);
    const inv = getInventory(PLAYER_EID)!;
    expect(inv.weapons).toContain('Longsword');
    expect(inv.equippedWeapon).toBe('Longsword');
  });

  it('subsequent earnings then second purchase work together', () => {
    setGold(50);
    expect(purchaseWeapon(PLAYER_EID, 'Mace').ok).toBe(false);
    addGold(100); // total 150
    const second = purchaseWeapon(PLAYER_EID, 'Mace');
    expect(second.ok).toBe(true);
    expect(getGold()).toBe(50);
  });
});
