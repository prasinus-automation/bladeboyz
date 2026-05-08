/**
 * PremiumShopTab — placeholder Premium (USD) tab inside the ShopPanel.
 *
 * Renders empty-state copy when no items are configured (the shipping default),
 * or an auto-fill grid of cards when placeholder items are passed in for
 * visual debugging. Buy buttons are disabled whenever the provider reports
 * `isAvailable() === false` (which is always, until Stripe etc. lands).
 */

import type { Currency, PaymentProvider, ShopItem, ShopTab } from './types';

/** Format a USD-cents price as `$X.YZ`. Always uses 2 decimals. */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars}.${remainder.toString().padStart(2, '0')}`;
}

export class PremiumShopTab implements ShopTab {
  id = 'premium';
  label = 'Premium (USD)';
  currency: Currency = 'usd';

  /** Currently mounted DOM root, if any. Used by `unmount()`. */
  private root: HTMLElement | null = null;
  /** Buy button click handlers, kept for cleanup */
  private buyHandlers: Array<{ el: HTMLButtonElement; fn: () => void }> = [];

  constructor(
    private provider: PaymentProvider,
    /** Empty by default → empty-state copy. Pass items for visual debugging. */
    private items: ShopItem[] = [],
  ) {}

  mount(container: HTMLElement): void {
    this.root = container;

    if (this.items.length === 0) {
      this.renderEmptyState(container);
      return;
    }

    this.renderGrid(container);
  }

  unmount(): void {
    for (const { el, fn } of this.buyHandlers) {
      el.removeEventListener('click', fn);
    }
    this.buyHandlers = [];
    if (this.root) {
      this.root.innerHTML = '';
      this.root = null;
    }
  }

  private renderEmptyState(container: HTMLElement): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'shop-premium-empty';
    wrapper.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 48px 16px;
      text-align: center;
    `;

    const headline = document.createElement('div');
    headline.textContent = 'Coming soon — premium cosmetics';
    headline.style.cssText = `
      font-size: 18px;
      color: #aaa;
      letter-spacing: 1px;
      margin-bottom: 12px;
    `;

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Real-money cosmetic items will appear here. No gameplay impact.';
    subtitle.style.cssText = `
      font-size: 12px;
      color: #999;
      max-width: 400px;
      line-height: 1.5;
    `;

    wrapper.appendChild(headline);
    wrapper.appendChild(subtitle);
    container.appendChild(wrapper);
  }

  private renderGrid(container: HTMLElement): void {
    const grid = document.createElement('div');
    grid.className = 'shop-premium-grid';
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
      padding: 16px;
    `;

    const available = this.provider.isAvailable();

    for (const item of this.items) {
      grid.appendChild(this.renderCard(item, available));
    }

    container.appendChild(grid);
  }

  private renderCard(item: ShopItem, providerAvailable: boolean): HTMLElement {
    const card = document.createElement('div');
    card.className = 'shop-premium-card';
    card.style.cssText = `
      border: 1px solid #444;
      background: rgba(40, 40, 50, 0.8);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;

    const name = document.createElement('div');
    name.className = 'shop-premium-card-name';
    name.textContent = item.name;
    name.style.cssText = `
      font-size: 13px;
      font-weight: bold;
      color: #ccc;
    `;

    const desc = document.createElement('div');
    desc.className = 'shop-premium-card-desc';
    desc.textContent = item.description;
    desc.style.cssText = `
      font-size: 11px;
      color: #999;
      flex: 1;
    `;

    const price = document.createElement('div');
    price.className = 'shop-premium-card-price';
    price.textContent = formatUsd(item.price);
    price.style.cssText = `
      font-size: 14px;
      color: #ffcc00;
      margin-top: 4px;
    `;

    const buyBtn = document.createElement('button');
    buyBtn.className = 'shop-premium-buy-btn';
    buyBtn.textContent = 'Buy';
    buyBtn.disabled = !providerAvailable;
    if (!providerAvailable) {
      buyBtn.title = 'Coming soon';
    }
    buyBtn.style.cssText = providerAvailable
      ? `
        background: #ffcc00;
        border: none;
        color: #222;
        font-family: monospace;
        font-size: 12px;
        font-weight: bold;
        padding: 6px 0;
        cursor: pointer;
        margin-top: 4px;
      `
      : `
        background: #333;
        border: 1px solid #555;
        color: #777;
        font-family: monospace;
        font-size: 12px;
        padding: 6px 0;
        cursor: not-allowed;
        opacity: 0.6;
        margin-top: 4px;
      `;

    if (providerAvailable) {
      const fn = (): void => {
        // Fire-and-forget — UI feedback can be wired up alongside #96.
        void this.provider.start(item);
      };
      buyBtn.addEventListener('click', fn);
      this.buyHandlers.push({ el: buyBtn, fn });
    }

    card.appendChild(name);
    card.appendChild(desc);
    card.appendChild(price);
    card.appendChild(buyBtn);
    return card;
  }
}
