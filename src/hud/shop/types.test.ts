import { describe, it, expect } from 'vitest';
import { MockPaymentProvider, type ShopItem } from './types';

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();

  const sampleItem: ShopItem = {
    id: 'placeholder',
    name: 'Placeholder',
    description: 'sample',
    price: 499,
    currency: 'usd',
  };

  it('isAvailable() returns false', () => {
    expect(provider.isAvailable()).toBe(false);
  });

  it('start() resolves to { status: "unavailable" }', async () => {
    const result = await provider.start(sampleItem);
    expect(result).toEqual({ status: 'unavailable' });
  });

  it('start() does not throw for any item shape', async () => {
    await expect(
      provider.start({
        id: 'foo',
        name: 'Foo',
        description: '',
        price: 0,
        currency: 'usd',
      }),
    ).resolves.toEqual({ status: 'unavailable' });
  });
});
