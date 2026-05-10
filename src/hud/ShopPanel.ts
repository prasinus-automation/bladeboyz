/**
 * ShopPanel — HTML overlay for the in-game shopkeep.
 *
 * Opens via the KeyE handler when the player is near the shopkeep NPC
 * (see `InteractionSystem` and the wiring in `main.ts`).
 *
 * Mirrors `InventoryPanel` line-for-line for structure: backdrop, container,
 * ESC + click-outside close, pointer-lock release on open, `input.paused`
 * gating. Differs in content: a header gold balance + a per-weapon row list
 * with Buy/Owned/Not enough gold buttons.
 *
 * Purchases go through `purchaseWeapon()` from `src/economy/PurchaseFlow.ts`,
 * which is the atomic validate-then-mutate API that will become server-
 * authoritative when networking lands. The panel only renders state and
 * surfaces failure messages.
 *
 * Issue #123.
 */

import { InputManager } from '../input/InputManager';
import { weaponConfigs } from '../weapons/WeaponConfig';
import { getWeaponPrice } from '../economy/Prices';
import { getGold, onGoldChange } from '../economy/Wallet';
import {
  purchaseWeapon,
  type PurchaseFailureReason,
} from '../economy/PurchaseFlow';
import {
  getInventory,
  onEquip,
  offEquip,
  type EquipEvent,
} from '../ecs/systems/InventorySystem';

/**
 * How long a per-row error message stays visible after a failed purchase.
 * (e.g. "Not enough gold" / "Already owned"). Short enough to feel reactive.
 */
const ROW_MESSAGE_TIMEOUT_MS = 2500;

/**
 * Map a `purchaseWeapon` failure reason to a human-readable message.
 */
function describeFailure(reason: PurchaseFailureReason): string {
  switch (reason) {
    case 'unknown_weapon':
      return 'Not for sale';
    case 'already_owned':
      return 'Already owned';
    case 'insufficient_gold':
      return 'Not enough gold';
    case 'fsm_busy':
      return 'Finish your swing first';
    case 'no_inventory':
      return 'No inventory';
  }
}

/**
 * Compute average head/torso/limb damage across all attack directions for a
 * weapon, returning a single readable summary number per zone. Avoids
 * dumping the full damage table in the UI.
 */
function averageDamage(
  config: import('../weapons/WeaponConfig').WeaponConfig,
): { head: number; torso: number; limb: number } {
  // Iterate the actual values present so removed directions (e.g. Underhand
  // post FSM v2) don't get sampled twice. `Direction` is a numeric const
  // enum, so Record<Direction, T> stores keys as stringified ints — using
  // Object.values sidesteps the key-cast.
  const entries = Object.values(config.damage);
  if (entries.length === 0) return { head: 0, torso: 0, limb: 0 };
  let h = 0,
    t = 0,
    l = 0;
  for (const dmg of entries) {
    h += dmg.head;
    t += dmg.torso;
    l += dmg.limb;
  }
  const n = entries.length;
  return {
    head: Math.round(h / n),
    torso: Math.round(t / n),
    limb: Math.round(l / n),
  };
}

/**
 * Convert windup+release ticks into a milliseconds-based swing-time number.
 * Humans read "350ms" more easily than "21 ticks". Average across directions
 * since per-direction values rarely differ enough to matter for shop display.
 */
function meanSwingTimeMs(
  config: import('../weapons/WeaponConfig').WeaponConfig,
): number {
  const windupTicks = Object.values(config.windup);
  const releaseTicks = Object.values(config.release);
  const n = Math.min(windupTicks.length, releaseTicks.length);
  if (n === 0) return 0;
  let totalTicks = 0;
  for (let i = 0; i < n; i++) {
    totalTicks += windupTicks[i] + releaseTicks[i];
  }
  const meanTicks = totalTicks / n;
  return Math.round(meanTicks * (1000 / 60));
}

export class ShopPanel {
  private container: HTMLDivElement;
  private backdrop: HTMLDivElement;
  private goldLabel: HTMLDivElement;
  private rowsContainer: HTMLDivElement;
  private _isOpen = false;
  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onGoldChangeUnsub: () => void;
  private _onEquipListener: (event: EquipEvent) => void;

  /** Per-weapon-row error message timeouts so we can clear them on close/refresh. */
  private rowMessageTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    private input: InputManager,
    private playerEid: number,
  ) {
    // ── Backdrop ──
    this.backdrop = document.createElement('div');
    this.backdrop.id = 'shop-backdrop';
    this.backdrop.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 200;
      display: none;
    `;
    this.backdrop.addEventListener('click', (e) => {
      // Close only when the click target IS the backdrop (not a child).
      if (e.target === this.backdrop) this.close();
    });

    // ── Container ──
    this.container = document.createElement('div');
    this.container.id = 'shop-panel';
    this.container.style.cssText = `
      position: fixed;
      top: 15%; left: 20%;
      width: 60%; height: 70%;
      background: rgba(20, 20, 30, 0.95);
      border: 2px solid #555;
      z-index: 201;
      display: none;
      pointer-events: auto;
      font-family: monospace;
      color: #ddd;
      overflow-y: auto;
    `;

    // ── Title bar (title + gold balance + close button) ──
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #444;
      background: rgba(30, 30, 45, 0.9);
      gap: 16px;
    `;

    const title = document.createElement('span');
    title.textContent = 'Shopkeep — Wares';
    title.style.cssText = `
      font-size: 18px;
      font-weight: bold;
      letter-spacing: 1.5px;
      color: #ccc;
    `;

    this.goldLabel = document.createElement('div');
    this.goldLabel.id = 'shop-gold-label';
    this.goldLabel.style.cssText = `
      font-size: 16px;
      font-weight: bold;
      color: #ffd24a;
      flex: 1;
      text-align: right;
      margin-right: 8px;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.id = 'shop-close-btn';
    closeBtn.textContent = 'X';
    closeBtn.style.cssText = `
      background: none;
      border: 1px solid #666;
      color: #ccc;
      font-family: monospace;
      font-size: 16px;
      cursor: pointer;
      padding: 2px 8px;
      line-height: 1;
    `;
    closeBtn.addEventListener('click', () => this.close());

    titleBar.appendChild(title);
    titleBar.appendChild(this.goldLabel);
    titleBar.appendChild(closeBtn);
    this.container.appendChild(titleBar);

    // ── Body content ──
    const content = document.createElement('div');
    content.style.cssText = `padding: 12px 16px;`;

    // Section header
    const header = document.createElement('div');
    header.textContent = 'WEAPONS';
    header.style.cssText = `
      font-size: 13px;
      letter-spacing: 1.5px;
      color: #aaa;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #333;
    `;
    content.appendChild(header);

    // Weapon rows go here
    this.rowsContainer = document.createElement('div');
    this.rowsContainer.id = 'shop-weapon-rows';
    this.rowsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;
    content.appendChild(this.rowsContainer);

    // Footer hint
    const footer = document.createElement('div');
    footer.style.cssText = `
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid #333;
      text-align: center;
      font-size: 11px;
      color: #888;
    `;
    footer.textContent = 'Press ESC to close';
    content.appendChild(footer);

    this.container.appendChild(content);

    // Append to body
    document.body.appendChild(this.backdrop);
    document.body.appendChild(this.container);

    // ── Live updates ──

    // Update the header gold counter on Wallet changes (live even while open)
    this._onGoldChangeUnsub = onGoldChange((balance) => {
      this.renderGold(balance);
      // Buy buttons depend on the balance — re-render rows so disabled
      // states track gold changes (e.g. earning gold while shop is open).
      if (this._isOpen) this.refreshRows();
    });

    // Refresh rows on equip events (Owned / equipped indicator may change)
    this._onEquipListener = () => {
      if (this._isOpen) this.refreshRows();
    };
    onEquip(this._onEquipListener);

    // Initial render of header value (rows render lazily on open)
    this.renderGold(getGold());

    // ── Keyboard handler — Escape closes ──
    this._onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && this._isOpen) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    document.addEventListener('keydown', this._onKeyDown);
  }

  /** Whether the shop panel is currently open */
  get isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * Open the panel. The optional `_shopkeepEid` parameter is accepted for
   * future per-shopkeep inventory routing (#123 ships a single global wares
   * list). Currently unused but kept in the signature to avoid a breaking
   * API change later.
   */
  open(_shopkeepEid?: number): void {
    if (this._isOpen) return;
    this._isOpen = true;
    this.refreshRows();
    this.renderGold(getGold());
    this.backdrop.style.display = 'block';
    this.container.style.display = 'block';

    // Release pointer lock and pause input — same flow as InventoryPanel
    if (typeof document.exitPointerLock === 'function') {
      document.exitPointerLock();
    }
    this.input.paused = true;
  }

  /** Close the panel. Pointer lock re-acquires on next canvas click. */
  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    this.backdrop.style.display = 'none';
    this.container.style.display = 'none';

    // Clear any in-flight error messages
    for (const t of this.rowMessageTimeouts.values()) clearTimeout(t);
    this.rowMessageTimeouts.clear();

    this.input.paused = false;
  }

  /** Toggle open/close — symmetric with InventoryPanel.toggle(). */
  toggle(): void {
    if (this._isOpen) this.close();
    else this.open();
  }

  /** Tear down DOM + listeners. */
  dispose(): void {
    document.removeEventListener('keydown', this._onKeyDown);
    this._onGoldChangeUnsub();
    offEquip(this._onEquipListener);
    for (const t of this.rowMessageTimeouts.values()) clearTimeout(t);
    this.rowMessageTimeouts.clear();
    this.backdrop.remove();
    this.container.remove();
  }

  // ── Rendering ──

  private renderGold(balance: number): void {
    this.goldLabel.textContent = `💰 ${balance} gold`;
  }

  /**
   * Re-render the per-weapon rows from current state. Cheap enough to call
   * on every gold/inventory change because there are only a handful of
   * weapons.
   */
  private refreshRows(): void {
    this.rowsContainer.innerHTML = '';
    const inventory = getInventory(this.playerEid);
    const ownedWeapons = inventory ? inventory.weapons : [];
    const equippedWeapon = inventory ? inventory.equippedWeapon : null;
    const balance = getGold();

    // One row per registered weapon. Use weaponConfigs as the source of
    // truth so a new weapon shipped via `registerWeapon()` shows up
    // automatically (provided it has a price entry; weapons without a
    // price render with "Not for sale").
    for (const [name, config] of Object.entries(weaponConfigs)) {
      const price = getWeaponPrice(name);
      const owned = ownedWeapons.includes(name);
      const equipped = equippedWeapon === name;

      this.rowsContainer.appendChild(
        this.buildRow({
          weaponName: name,
          weaponConfig: config,
          price,
          owned,
          equipped,
          canAfford: price !== undefined && balance >= price,
        }),
      );
    }
  }

  private buildRow(args: {
    weaponName: string;
    weaponConfig: import('../weapons/WeaponConfig').WeaponConfig;
    /** undefined = not for sale; 0 = free; positive = gold cost */
    price: number | undefined;
    owned: boolean;
    equipped: boolean;
    canAfford: boolean;
  }): HTMLDivElement {
    const { weaponName, weaponConfig, price, owned, equipped, canAfford } = args;

    const row = document.createElement('div');
    row.className = 'shop-weapon-row';
    row.dataset.weaponName = weaponName;
    row.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 2fr auto auto;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid ${equipped ? '#3a8a3a' : '#333'};
      background: ${equipped ? 'rgba(58, 138, 58, 0.12)' : 'rgba(40, 40, 50, 0.6)'};
    `;

    // Name (with optional "(equipped)" tag)
    const nameCell = document.createElement('div');
    nameCell.className = 'shop-weapon-name';
    nameCell.style.cssText = `
      font-size: 14px;
      font-weight: bold;
      color: ${equipped ? '#9be09b' : '#ddd'};
    `;
    nameCell.textContent = equipped ? `${weaponName} (equipped)` : weaponName;

    // Stats summary: damage zones + range + swing time
    const statsCell = document.createElement('div');
    statsCell.className = 'shop-weapon-stats';
    statsCell.style.cssText = `
      font-size: 11px;
      color: #aaa;
      line-height: 1.4;
    `;
    const dmg = averageDamage(weaponConfig);
    const swingMs = meanSwingTimeMs(weaponConfig);
    statsCell.textContent =
      `Damage: ${dmg.head}/${dmg.torso}/${dmg.limb}  ·  ` +
      `Reach: ${weaponConfig.range.toFixed(2)}m  ·  ` +
      `Swing: ${swingMs}ms  ·  ` +
      `Stamina: ${weaponConfig.staminaCost.attack}`;

    // Price cell
    const priceCell = document.createElement('div');
    priceCell.className = 'shop-weapon-price';
    priceCell.style.cssText = `
      font-size: 13px;
      color: #ffd24a;
      min-width: 80px;
      text-align: right;
    `;
    if (price === undefined) {
      priceCell.textContent = 'Not for sale';
      priceCell.style.color = '#888';
    } else if (price === 0) {
      priceCell.textContent = 'FREE';
      priceCell.style.color = '#9be09b';
    } else {
      priceCell.textContent = `${price} g`;
    }

    // Buy button (or status indicator)
    const buyBtn = document.createElement('button');
    buyBtn.className = 'shop-buy-btn';
    buyBtn.dataset.weaponName = weaponName;
    buyBtn.style.cssText = `
      font-family: monospace;
      font-size: 12px;
      font-weight: bold;
      padding: 6px 14px;
      border-radius: 2px;
      min-width: 100px;
    `;

    if (owned) {
      // Already owned (incl. starter weapon): no purchase action.
      buyBtn.textContent = 'Owned';
      buyBtn.disabled = true;
      buyBtn.style.cssText += `
        background: #2a2a2a;
        border: 1px solid #444;
        color: #777;
        cursor: not-allowed;
      `;
    } else if (price === undefined) {
      buyBtn.textContent = '—';
      buyBtn.disabled = true;
      buyBtn.style.cssText += `
        background: #2a2a2a;
        border: 1px solid #444;
        color: #555;
        cursor: not-allowed;
      `;
    } else if (!canAfford) {
      buyBtn.textContent = 'Not enough gold';
      buyBtn.disabled = true;
      buyBtn.style.cssText += `
        background: #3a2a2a;
        border: 1px solid #553333;
        color: #aa6666;
        cursor: not-allowed;
      `;
    } else {
      buyBtn.textContent = 'Buy';
      buyBtn.style.cssText += `
        background: #ffcc00;
        border: 1px solid #ddaa00;
        color: #222;
        cursor: pointer;
      `;
      buyBtn.addEventListener('click', () => this.handleBuyClick(weaponName, row));
    }

    row.appendChild(nameCell);
    row.appendChild(statsCell);
    row.appendChild(priceCell);
    row.appendChild(buyBtn);

    // Inline error message slot (shown when a purchase attempt fails)
    const msg = document.createElement('div');
    msg.className = 'shop-weapon-msg';
    msg.style.cssText = `
      grid-column: 1 / -1;
      font-size: 11px;
      color: #f08080;
      margin-top: -2px;
      min-height: 14px;
    `;
    row.appendChild(msg);

    return row;
  }

  private handleBuyClick(weaponName: string, rowEl: HTMLElement): void {
    const result = purchaseWeapon(this.playerEid, weaponName);
    if (result.ok) {
      // refreshRows() will be triggered by the equip event listener wired in
      // the constructor (and Wallet onGoldChange). Belt-and-braces: refresh
      // synchronously here too so the UI updates even if those subscriptions
      // were ever detached.
      this.refreshRows();
      return;
    }

    // Surface failure inline. The row may have been re-rendered already if
    // gold changed concurrently; look up the current row by data attribute.
    const currentRow = this.rowsContainer.querySelector<HTMLElement>(
      `.shop-weapon-row[data-weapon-name="${CSS.escape(weaponName)}"]`,
    );
    const target = currentRow ?? rowEl;
    const msg = target.querySelector<HTMLElement>('.shop-weapon-msg');
    if (!msg) return;
    msg.textContent = describeFailure(result.reason);

    // Auto-clear the message after a beat so it doesn't linger forever.
    const existing = this.rowMessageTimeouts.get(weaponName);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      // Re-query in case the row was re-rendered while the timer ran.
      const liveRow = this.rowsContainer.querySelector<HTMLElement>(
        `.shop-weapon-row[data-weapon-name="${CSS.escape(weaponName)}"]`,
      );
      const liveMsg = liveRow?.querySelector<HTMLElement>('.shop-weapon-msg');
      if (liveMsg) liveMsg.textContent = '';
      this.rowMessageTimeouts.delete(weaponName);
    }, ROW_MESSAGE_TIMEOUT_MS);
    this.rowMessageTimeouts.set(weaponName, t);
  }
}
