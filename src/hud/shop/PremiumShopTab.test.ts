import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PremiumShopTab, formatUsd } from './PremiumShopTab';
import { MockPaymentProvider, type PaymentProvider, type ShopItem } from './types';

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('formatUsd', () => {
  it('formats whole dollars', () => {
    expect(formatUsd(500)).toBe('$5.00');
  });

  it('formats sub-dollar amounts with leading zeros', () => {
    expect(formatUsd(7)).toBe('$0.07');
  });

  it('formats common price points', () => {
    expect(formatUsd(499)).toBe('$4.99');
    expect(formatUsd(1299)).toBe('$12.99');
  });

  it('handles zero', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });
});

describe('PremiumShopTab', () => {
  let container: HTMLElement;
  let provider: PaymentProvider;

  beforeEach(() => {
    container = makeContainer();
    provider = new MockPaymentProvider();
  });

  afterEach(() => {
    container.remove();
  });

  describe('identity', () => {
    it('has id "premium"', () => {
      const tab = new PremiumShopTab(provider);
      expect(tab.id).toBe('premium');
    });

    it('has label "Premium (USD)"', () => {
      const tab = new PremiumShopTab(provider);
      expect(tab.label).toBe('Premium (USD)');
    });

    it('has currency "usd"', () => {
      const tab = new PremiumShopTab(provider);
      expect(tab.currency).toBe('usd');
    });
  });

  describe('empty state (default)', () => {
    it('renders empty-state copy when no items configured', () => {
      const tab = new PremiumShopTab(provider);
      tab.mount(container);
      expect(container.textContent).toContain('Coming soon');
      expect(container.textContent).toContain('premium cosmetics');
    });

    it('renders subtitle clarifying no gameplay impact', () => {
      const tab = new PremiumShopTab(provider);
      tab.mount(container);
      expect(container.textContent).toContain('No gameplay impact');
    });

    it('does not render any buy buttons when empty', () => {
      const tab = new PremiumShopTab(provider);
      tab.mount(container);
      expect(container.querySelectorAll('.shop-premium-buy-btn').length).toBe(0);
    });

    it('does not render a grid when empty', () => {
      const tab = new PremiumShopTab(provider);
      tab.mount(container);
      expect(container.querySelector('.shop-premium-grid')).toBeNull();
      expect(container.querySelector('.shop-premium-empty')).not.toBeNull();
    });
  });

  describe('grid with items', () => {
    const items: ShopItem[] = [
      {
        id: 'red-skin',
        name: 'Crimson Blade',
        description: 'A red skin',
        price: 499,
        currency: 'usd',
      },
      {
        id: 'gold-skin',
        name: 'Gold Blade',
        description: 'Shiny',
        price: 999,
        currency: 'usd',
      },
    ];

    it('renders one card per item', () => {
      const tab = new PremiumShopTab(provider, items);
      tab.mount(container);
      const cards = container.querySelectorAll('.shop-premium-card');
      expect(cards.length).toBe(2);
    });

    it('renders item name and description', () => {
      const tab = new PremiumShopTab(provider, items);
      tab.mount(container);
      expect(container.textContent).toContain('Crimson Blade');
      expect(container.textContent).toContain('A red skin');
    });

    it('formats price as USD', () => {
      const tab = new PremiumShopTab(provider, items);
      tab.mount(container);
      expect(container.textContent).toContain('$4.99');
      expect(container.textContent).toContain('$9.99');
    });

    it('Buy button is disabled when provider.isAvailable() === false', () => {
      const tab = new PremiumShopTab(provider, items);
      tab.mount(container);
      const buttons = container.querySelectorAll('.shop-premium-buy-btn') as NodeListOf<HTMLButtonElement>;
      expect(buttons.length).toBe(2);
      buttons.forEach((btn) => {
        expect(btn.disabled).toBe(true);
      });
    });

    it('disabled Buy button has "Coming soon" tooltip', () => {
      const tab = new PremiumShopTab(provider, items);
      tab.mount(container);
      const btn = container.querySelector('.shop-premium-buy-btn') as HTMLButtonElement;
      expect(btn.title).toBe('Coming soon');
    });

    it('Buy button is enabled when provider.isAvailable() === true', () => {
      const liveProvider: PaymentProvider = {
        isAvailable: () => true,
        start: async () => ({ status: 'success', transactionId: 'tx_1' }),
      };
      const tab = new PremiumShopTab(liveProvider, items);
      tab.mount(container);
      const buttons = container.querySelectorAll('.shop-premium-buy-btn') as NodeListOf<HTMLButtonElement>;
      buttons.forEach((btn) => {
        expect(btn.disabled).toBe(false);
      });
    });

    it('uses an auto-fill grid layout', () => {
      const tab = new PremiumShopTab(provider, items);
      tab.mount(container);
      const grid = container.querySelector('.shop-premium-grid') as HTMLElement;
      expect(grid).not.toBeNull();
      expect(grid.style.display).toBe('grid');
      expect(grid.style.gridTemplateColumns).toContain('auto-fill');
    });
  });

  describe('unmount', () => {
    it('clears DOM on unmount', () => {
      const tab = new PremiumShopTab(provider);
      tab.mount(container);
      expect(container.children.length).toBeGreaterThan(0);
      tab.unmount();
      expect(container.children.length).toBe(0);
    });

    it('is safe to call before mount', () => {
      const tab = new PremiumShopTab(provider);
      expect(() => tab.unmount()).not.toThrow();
    });

    it('removes Buy click listeners on unmount', () => {
      let calls = 0;
      const liveProvider: PaymentProvider = {
        isAvailable: () => true,
        start: async () => {
          calls++;
          return { status: 'success', transactionId: 'tx' };
        },
      };
      const items: ShopItem[] = [
        { id: 'x', name: 'X', description: '', price: 100, currency: 'usd' },
      ];
      const tab = new PremiumShopTab(liveProvider, items);
      tab.mount(container);
      const btn = container.querySelector('.shop-premium-buy-btn') as HTMLButtonElement;

      // Capture listener target before unmount detaches it from the DOM
      tab.unmount();
      btn.click();
      expect(calls).toBe(0);
    });
  });
});
