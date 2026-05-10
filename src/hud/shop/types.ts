/**
 * Shop type definitions and payment provider contract.
 *
 * Forward-compatible interface so a real payment provider (Stripe etc.) can be
 * wired in later without UI changes. Currently no real payment integration —
 * UI surface only.
 */

export type Currency = 'gold' | 'usd';

export interface ShopItem {
  /** Stable id for tracking — used by future provider transactions */
  id: string;
  /** Display name */
  name: string;
  /** Display description */
  description: string;
  /** Price in smallest unit: gold = integer; usd = cents (e.g. 499 = $4.99) */
  price: number;
  /** Currency the price is denominated in */
  currency: Currency;
  /** Optional asset key for future 3D preview rendering */
  previewMesh?: string;
}

/**
 * A tab inside the ShopPanel. Implementations own their own DOM and
 * mount/unmount lifecycle so the panel can swap content cheaply.
 */
export interface ShopTab {
  /** Stable id (e.g. 'weapons', 'premium') */
  id: string;
  /** Human-readable label shown in the tab strip */
  label: string;
  /** Currency this tab transacts in */
  currency: Currency;
  /** Render content into the supplied container element */
  mount(container: HTMLElement): void;
  /** Tear down DOM / listeners. Called before switching tabs. */
  unmount(): void;
}

/**
 * Result of a purchase attempt.
 *
 * `unavailable` is returned when no provider is wired — the scaffold default.
 */
export type PurchaseResult =
  | { status: 'success'; transactionId: string }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string }
  | { status: 'unavailable' };

/**
 * Payment provider contract. Replace `MockPaymentProvider` with e.g.
 * `StripePaymentProvider` later — `PremiumShopTab` works unchanged.
 */
export interface PaymentProvider {
  /** Whether the provider is configured and ready to start a checkout */
  isAvailable(): boolean;
  /** Begin a purchase flow for the given item */
  start(item: ShopItem): Promise<PurchaseResult>;
}

/**
 * No-op payment provider used for the placeholder Premium tab.
 * Always reports unavailable; `start()` resolves to `{ status: 'unavailable' }`.
 */
export class MockPaymentProvider implements PaymentProvider {
  isAvailable(): boolean {
    return false;
  }

  async start(_item: ShopItem): Promise<PurchaseResult> {
    return { status: 'unavailable' };
  }
}
