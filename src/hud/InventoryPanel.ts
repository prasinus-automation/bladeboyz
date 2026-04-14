/**
 * InventoryPanel — HTML overlay for viewing and managing inventory.
 *
 * Press "I" to toggle open/close. Opening releases pointer lock and pauses input.
 * Closing unpauses input; pointer lock re-acquired on next canvas click.
 *
 * Follows the existing HUD pattern: imperative DOM, inline CSS, no framework.
 */

import { InputManager } from '../input/InputManager';
import { getInventory, equipWeapon } from '../ecs/systems/InventorySystem';
import { weaponConfigs } from '../weapons/WeaponConfig';


/** Gear slot placeholder names */
const GEAR_SLOTS = ['Head', 'Chest', 'Legs', 'Boots'] as const;

export class InventoryPanel {
  private container: HTMLDivElement;
  private backdrop: HTMLDivElement;
  private weaponsGrid: HTMLDivElement;
  private weaponGearSlot: HTMLDivElement;
  private _isOpen = false;
  private _onKeyDown: (e: KeyboardEvent) => void;

  constructor(
    private input: InputManager,
    private playerEid: number,
  ) {
    // Semi-transparent backdrop
    this.backdrop = document.createElement('div');
    this.backdrop.id = 'inventory-backdrop';
    this.backdrop.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 200;
      display: none;
    `;
    this.backdrop.addEventListener('click', (e) => {
      // Close if clicking backdrop (not panel)
      if (e.target === this.backdrop) this.close();
    });

    // Main panel
    this.container = document.createElement('div');
    this.container.id = 'inventory-panel';
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

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #444;
      background: rgba(30, 30, 45, 0.9);
    `;

    const title = document.createElement('span');
    title.textContent = 'INVENTORY';
    title.style.cssText = `
      font-size: 18px;
      font-weight: bold;
      letter-spacing: 2px;
      color: #ccc;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.id = 'inventory-close-btn';
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
    titleBar.appendChild(closeBtn);
    this.container.appendChild(titleBar);

    // Content area
    const content = document.createElement('div');
    content.style.cssText = `padding: 16px;`;

    // Weapons section
    const weaponsHeader = document.createElement('div');
    weaponsHeader.textContent = 'WEAPONS';
    weaponsHeader.style.cssText = `
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 1px;
      color: #aaa;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #333;
    `;
    content.appendChild(weaponsHeader);

    this.weaponsGrid = document.createElement('div');
    this.weaponsGrid.id = 'inventory-weapons-grid';
    this.weaponsGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
      margin-bottom: 24px;
    `;
    content.appendChild(this.weaponsGrid);

    // Gear section
    const gearHeader = document.createElement('div');
    gearHeader.textContent = 'GEAR';
    gearHeader.style.cssText = `
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 1px;
      color: #aaa;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #333;
    `;
    content.appendChild(gearHeader);

    const gearGrid = document.createElement('div');
    gearGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    `;

    // Functional weapon gear slot (displays currently equipped weapon)
    this.weaponGearSlot = document.createElement('div');
    this.weaponGearSlot.id = 'gear-slot-weapon';
    this.weaponGearSlot.style.cssText = `
      border: 2px solid #ffcc00;
      padding: 12px;
      text-align: center;
      background: rgba(255, 204, 0, 0.1);
    `;
    this.buildWeaponGearSlotContent(null);
    gearGrid.appendChild(this.weaponGearSlot);

    // Placeholder armor slots
    for (const slot of GEAR_SLOTS) {
      const slotEl = document.createElement('div');
      slotEl.style.cssText = `
        border: 1px solid #333;
        padding: 12px;
        text-align: center;
        background: rgba(40, 40, 50, 0.6);
        opacity: 0.5;
      `;
      const slotName = document.createElement('div');
      slotName.textContent = slot;
      slotName.style.cssText = `font-size: 12px; color: #888; margin-bottom: 4px;`;
      const slotStatus = document.createElement('div');
      slotStatus.textContent = 'Coming Soon';
      slotStatus.style.cssText = `font-size: 10px; color: #555; font-style: italic;`;
      slotEl.appendChild(slotName);
      slotEl.appendChild(slotStatus);
      gearGrid.appendChild(slotEl);
    }
    content.appendChild(gearGrid);

    this.container.appendChild(content);

    // Append to body
    document.body.appendChild(this.backdrop);
    document.body.appendChild(this.container);

    // Keyboard listener for I and Escape
    this._onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyI') {
        e.preventDefault();
        this.toggle();
      } else if (e.code === 'Escape' && this._isOpen) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    document.addEventListener('keydown', this._onKeyDown);
  }

  /** Whether the inventory panel is currently open */
  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Toggle inventory open/close */
  toggle(): void {
    if (this._isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Open the inventory panel */
  open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    this.refresh();
    this.backdrop.style.display = 'block';
    this.container.style.display = 'block';

    // Release pointer lock and pause input
    if (typeof document.exitPointerLock === 'function') {
      document.exitPointerLock();
    }
    this.input.paused = true;
  }

  /** Close the inventory panel */
  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    this.backdrop.style.display = 'none';
    this.container.style.display = 'none';

    // Unpause input — pointer lock re-acquired on next canvas click
    this.input.paused = false;
  }

  /** Update the weapon gear slot content based on the equipped weapon */
  private buildWeaponGearSlotContent(equippedWeapon: string | null): void {
    this.weaponGearSlot.innerHTML = '';

    const label = document.createElement('div');
    label.textContent = 'Weapon';
    label.style.cssText = `font-size: 11px; color: #ffcc00; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;`;
    this.weaponGearSlot.appendChild(label);

    if (equippedWeapon) {
      // Weapon icon (rotated rectangle, same style as weapons grid)
      const icon = document.createElement('div');
      icon.style.cssText = `
        width: 40px; height: 8px;
        background: #ffcc00;
        margin: 0 auto 8px;
        transform: rotate(-30deg);
      `;
      this.weaponGearSlot.appendChild(icon);

      const nameEl = document.createElement('div');
      nameEl.className = 'gear-weapon-name';
      nameEl.textContent = equippedWeapon;
      nameEl.style.cssText = `font-size: 14px; font-weight: bold; color: #ffcc00;`;
      this.weaponGearSlot.appendChild(nameEl);

      // Stats summary if config exists
      const config = weaponConfigs[equippedWeapon];
      if (config) {
        const stats = document.createElement('div');
        stats.style.cssText = `font-size: 10px; color: #999; margin-top: 4px;`;
        stats.textContent = `Range: ${config.range}`;
        this.weaponGearSlot.appendChild(stats);
      }

      this.weaponGearSlot.style.borderColor = '#ffcc00';
      this.weaponGearSlot.style.background = 'rgba(255, 204, 0, 0.1)';
      this.weaponGearSlot.style.opacity = '1';
    } else {
      const empty = document.createElement('div');
      empty.textContent = 'None';
      empty.style.cssText = `font-size: 12px; color: #666; font-style: italic;`;
      this.weaponGearSlot.appendChild(empty);

      this.weaponGearSlot.style.borderColor = '#555';
      this.weaponGearSlot.style.background = 'rgba(40, 40, 50, 0.6)';
      this.weaponGearSlot.style.opacity = '0.7';
    }
  }

  /** Refresh the weapons grid from current inventory data */
  refresh(): void {
    this.weaponsGrid.innerHTML = '';
    const inv = getInventory(this.playerEid);
    if (!inv) {
      this.buildWeaponGearSlotContent(null);
      return;
    }

    // Update weapon gear slot
    this.buildWeaponGearSlotContent(inv.equippedWeapon ?? null);

    for (const weaponName of inv.weapons) {
      const config = weaponConfigs[weaponName];
      const isEquipped = weaponName === inv.equippedWeapon;

      const card = document.createElement('div');
      card.className = 'inventory-weapon-card';
      card.style.cssText = `
        border: 2px solid ${isEquipped ? '#ffcc00' : '#444'};
        padding: 12px;
        text-align: center;
        cursor: ${isEquipped ? 'default' : 'pointer'};
        background: ${isEquipped ? 'rgba(255, 204, 0, 0.1)' : 'rgba(40, 40, 50, 0.8)'};
        transition: border-color 0.15s;
      `;

      // Weapon icon (colored box matching aesthetic)
      const icon = document.createElement('div');
      icon.style.cssText = `
        width: 40px; height: 8px;
        background: ${isEquipped ? '#ffcc00' : '#888'};
        margin: 0 auto 8px;
        transform: rotate(-30deg);
      `;

      const name = document.createElement('div');
      name.textContent = weaponName;
      name.style.cssText = `
        font-size: 13px;
        font-weight: bold;
        color: ${isEquipped ? '#ffcc00' : '#ccc'};
        margin-bottom: 4px;
      `;

      const statusEl = document.createElement('div');
      statusEl.style.cssText = `font-size: 10px; color: #888;`;

      if (isEquipped) {
        statusEl.textContent = 'EQUIPPED';
        statusEl.style.color = '#ffcc00';
      } else {
        statusEl.textContent = 'Click to equip';
      }

      // Stats line if config exists
      if (config) {
        const stats = document.createElement('div');
        stats.style.cssText = `font-size: 10px; color: #666; margin-top: 4px;`;
        stats.textContent = `Range: ${config.range}`;
        card.appendChild(icon);
        card.appendChild(name);
        card.appendChild(statusEl);
        card.appendChild(stats);
      } else {
        card.appendChild(icon);
        card.appendChild(name);
        card.appendChild(statusEl);
      }

      // Click handler to equip
      if (!isEquipped) {
        card.addEventListener('click', () => {
          this.handleEquip(weaponName);
        });
      }

      this.weaponsGrid.appendChild(card);
    }
  }

  /** Handle equipping a weapon */
  private handleEquip(weaponName: string): void {
    const success = equipWeapon(this.playerEid, weaponName);
    if (success) {
      this.refresh();
    }
  }

  /** Clean up all DOM elements and event listeners */
  dispose(): void {
    document.removeEventListener('keydown', this._onKeyDown);
    this.backdrop.remove();
    this.container.remove();
  }
}
