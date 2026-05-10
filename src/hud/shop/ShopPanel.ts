/**
 * ShopPanel — HTML overlay for the in-game shop.
 *
 * Mirrors the InventoryPanel structure (imperative DOM, inline CSS, no framework)
 * but adds a tab strip so multiple shop categories can share the same overlay.
 *
 * Default tabs: a stub "Weapons (Gold)" placeholder (replaced by #96) and the
 * scaffolded "Premium (USD)" tab. New tabs can be added via `addTab()`.
 *
 * Open/close releases pointer lock and pauses input the same way InventoryPanel
 * does. Escape and click-outside close the panel.
 */

import { InputManager } from '../../input/InputManager';
import { PremiumShopTab } from './PremiumShopTab';
import { MockPaymentProvider, type PaymentProvider, type ShopTab } from './types';

/** Stub Weapons tab — placeholder until #96 lands. */
class StubWeaponsShopTab implements ShopTab {
  id = 'weapons';
  label = 'Weapons (Gold)';
  currency = 'gold' as const;

  mount(container: HTMLElement): void {
    container.textContent = 'Weapons shop coming in #96';
    container.style.cssText = `
      padding: 24px;
      text-align: center;
      color: #aaa;
      font-style: italic;
    `;
  }

  unmount(): void {
    /* Body container is cleared by ShopPanel before next mount */
  }
}

export class ShopPanel {
  private container: HTMLDivElement;
  private backdrop: HTMLDivElement;
  private tabStrip: HTMLDivElement;
  private bodyContainer: HTMLDivElement;
  private _isOpen = false;
  private _onKeyDown: (e: KeyboardEvent) => void;

  /** Registered tabs in display order */
  private tabs: ShopTab[] = [];
  /** Tab id -> button element, for active-state styling */
  private tabButtons: Map<string, HTMLButtonElement> = new Map();
  /** Currently mounted tab (null until `open()` mounts the first one) */
  private activeTab: ShopTab | null = null;

  constructor(
    private input: InputManager,
    options?: { provider?: PaymentProvider; registerDefaultTabs?: boolean },
  ) {
    // Backdrop
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
      if (e.target === this.backdrop) this.close();
    });

    // Main panel
    this.container = document.createElement('div');
    this.container.id = 'shop-panel';
    this.container.style.cssText = `
      position: fixed;
      top: 15%; left: 20%;
      width: 60%; height: 70%;
      background: rgba(20, 20, 30, 0.95);
      border: 1px solid #555;
      z-index: 201;
      display: none;
      pointer-events: auto;
      font-family: monospace;
      color: #ccc;
      overflow: hidden;
      flex-direction: column;
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
      flex-shrink: 0;
    `;

    const title = document.createElement('span');
    title.textContent = 'SHOP';
    title.style.cssText = `
      font-size: 18px;
      font-weight: bold;
      letter-spacing: 2px;
      color: #ccc;
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
    titleBar.appendChild(closeBtn);
    this.container.appendChild(titleBar);

    // Tab strip
    this.tabStrip = document.createElement('div');
    this.tabStrip.id = 'shop-tab-strip';
    this.tabStrip.style.cssText = `
      display: flex;
      flex-direction: row;
      border-bottom: 1px solid #444;
      background: rgba(25, 25, 38, 0.9);
      flex-shrink: 0;
    `;
    this.container.appendChild(this.tabStrip);

    // Body container — tabs mount here
    this.bodyContainer = document.createElement('div');
    this.bodyContainer.id = 'shop-body';
    this.bodyContainer.style.cssText = `
      flex: 1;
      overflow-y: auto;
      position: relative;
    `;
    this.container.appendChild(this.bodyContainer);

    // Append to body
    document.body.appendChild(this.backdrop);
    document.body.appendChild(this.container);

    // Register default tabs unless caller opts out
    if (options?.registerDefaultTabs !== false) {
      const provider = options?.provider ?? new MockPaymentProvider();
      this.addTab(new StubWeaponsShopTab());
      this.addTab(new PremiumShopTab(provider));
    }

    // Keyboard listener — Escape closes (no toggle hotkey yet; #96 will wire E)
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

  /** Register a new tab. Tabs are rendered in registration order. */
  addTab(tab: ShopTab): void {
    this.tabs.push(tab);

    const btn = document.createElement('button');
    btn.className = 'shop-tab-btn';
    btn.dataset.tabId = tab.id;
    btn.textContent = tab.label;
    btn.style.cssText = this.tabButtonInactiveCss();
    btn.addEventListener('click', () => this.switchTab(tab.id));
    this.tabStrip.appendChild(btn);
    this.tabButtons.set(tab.id, btn);

    // If this is the first tab and the panel is already open, mount it
    if (this.tabs.length === 1 && this._isOpen) {
      this.switchTab(tab.id);
    }
  }

  /** Switch to the named tab. No-op if it's already active or unknown. */
  switchTab(tabId: string): void {
    const next = this.tabs.find((t) => t.id === tabId);
    if (!next) return;
    if (this.activeTab && this.activeTab.id === tabId) return;

    if (this.activeTab) {
      this.activeTab.unmount();
    }
    // Clear body before mounting the new tab — tab impls don't need to clean up
    // children themselves, only their event listeners / observers.
    this.bodyContainer.innerHTML = '';
    next.mount(this.bodyContainer);
    this.activeTab = next;

    // Update active styling
    for (const [id, btn] of this.tabButtons) {
      btn.style.cssText = id === tabId
        ? this.tabButtonActiveCss()
        : this.tabButtonInactiveCss();
    }
  }

  /** Toggle open/close */
  toggle(): void {
    if (this._isOpen) this.close();
    else this.open();
  }

  /** Open the shop panel and mount the first registered tab */
  open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    this.backdrop.style.display = 'block';
    this.container.style.display = 'flex';

    // Mount the first tab if nothing is active yet
    if (!this.activeTab && this.tabs.length > 0) {
      this.switchTab(this.tabs[0].id);
    }

    // Release pointer lock and pause input
    if (typeof document.exitPointerLock === 'function') {
      document.exitPointerLock();
    }
    this.input.paused = true;
  }

  /** Close the shop panel */
  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    this.backdrop.style.display = 'none';
    this.container.style.display = 'none';

    this.input.paused = false;
  }

  /** Clean up DOM and listeners */
  dispose(): void {
    document.removeEventListener('keydown', this._onKeyDown);
    if (this.activeTab) {
      this.activeTab.unmount();
      this.activeTab = null;
    }
    this.backdrop.remove();
    this.container.remove();
  }

  private tabButtonInactiveCss(): string {
    return `
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: #aaa;
      font-family: monospace;
      font-size: 14px;
      letter-spacing: 1px;
      padding: 10px 18px;
      cursor: pointer;
    `;
  }

  private tabButtonActiveCss(): string {
    return `
      background: none;
      border: none;
      border-bottom: 2px solid #ffcc00;
      color: #ffcc00;
      font-family: monospace;
      font-size: 14px;
      letter-spacing: 1px;
      padding: 10px 18px;
      cursor: pointer;
    `;
  }
}
