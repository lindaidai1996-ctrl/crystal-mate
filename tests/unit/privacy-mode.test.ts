import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  current: null as null | {
    subscribe: (listener: () => void) => () => void;
    snapshot: () => boolean;
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useSyncExternalStore: (
      subscribe: (listener: () => void) => () => void,
      snapshot: () => boolean,
      serverSnapshot: () => boolean,
    ) => {
      store.current = { subscribe, snapshot };
      return actual.useSyncExternalStore(subscribe, snapshot, serverSnapshot);
    },
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { Sensitive, setPrivacyMode } from '@/components/privacyMode';
import { ProductPricingFields } from '@/components/product-pricing-fields';
import { MaterialSaleFields } from '@/components/materialManagement/materialSaleFields';
import { emptyMaterial } from '@/lib/material-defaults';
import { PurchaseFields } from '@/components/materialManagement/purchaseFields';
import { emptyPurchase } from '@/lib/material-purchase';

let browser: EventTarget & { localStorage: Storage };
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    } as unknown as Storage,
  });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('React', React);
  setPrivacyMode(false);
  renderToStaticMarkup(React.createElement(Sensitive, null, 'internal cost'));
});
afterEach(() => vi.unstubAllGlobals());

describe('privacy mode', () => {
  it('hides sensitive values in the server preview before browser preferences are available', () => {
    expect(renderToStaticMarkup(React.createElement(Sensitive, null, '987.65'))).toBe('');
  });

  it('persists toggles, notifies this tab and removes subscriptions on cleanup', () => {
    const listener = vi.fn();
    const unsubscribe = store.current!.subscribe(listener);
    setPrivacyMode(true);
    expect(values.get('crystal-mate:privacy-mode')).toBe('true');
    expect(store.current!.snapshot()).toBe(true);
    setPrivacyMode(false);
    expect(store.current!.snapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setPrivacyMode(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('reads an existing browser preference and responds to another tab', () => {
    const listener = vi.fn();
    const unsubscribe = store.current!.subscribe(listener);
    values.set('crystal-mate:privacy-mode', 'true');
    browser.dispatchEvent(
      Object.assign(new Event('storage'), { key: 'crystal-mate:privacy-mode' }),
    );
    expect(listener).toHaveBeenCalledOnce();
    expect(store.current!.snapshot()).toBe(true);
    unsubscribe();
  });

  it('still switches when browser storage cannot be written', () => {
    vi.mocked(browser.localStorage.setItem).mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    setPrivacyMode(true);
    expect(store.current!.snapshot()).toBe(true);
    setPrivacyMode(false);
    expect(store.current!.snapshot()).toBe(false);
  });

  it('keeps product sale prices while hiding markup rules and inputs', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductPricingFields, {
        cost: '123.45',
        value: {
          price: '456.78',
          saleRule: 'FIXED_AMOUNT',
          saleRuleValue: '333.33',
          saleManual: false,
        },
      }),
    );
    expect(html).toContain('456.78');
    expect(html).not.toContain('333.33');
    expect(html).not.toContain('saleRule');
    expect(html).not.toContain('fixedAmount');
  });

  it('keeps material sale prices while hiding profit and markup rules', () => {
    const html = renderToStaticMarkup(
      React.createElement(MaterialSaleFields, {
        values: {
          ...emptyMaterial(),
          purchaseUnitPrice: '123.45',
          saleUnitPrice: '456.78',
          saleRule: 'FIXED_AMOUNT',
          saleRuleValue: '333.33',
        },
        onChange: vi.fn(),
        onRuleChange: vi.fn(),
        onAdopt: vi.fn(),
      }),
    );
    expect(html).toContain('456.78');
    expect(html).not.toContain('333.33');
    expect(html).not.toContain('123.45');
    expect(html).not.toContain('estimatedProfit');
    expect(html).not.toContain('saleRule');
  });

  it('keeps purchase quantity and weight fields while hiding purchase amounts', () => {
    const html = renderToStaticMarkup(
      React.createElement(PurchaseFields, {
        values: { ...emptyMaterial(), purchaseUnitPrice: '123.45', purchaseGramPrice: '67.89' },
        purchase: emptyPurchase(),
        quantity: 12,
        quantityUnknown: false,
        onQuantityChange: vi.fn(),
        onUnknownChange: vi.fn(),
        onPurchaseChange: vi.fn(),
        onModeChange: vi.fn(),
        onValueChange: vi.fn(),
      }),
    );
    expect(html).toContain('value="12"');
    expect(html).toContain('unitWeight');
    expect(html).not.toContain('123.45');
    expect(html).not.toContain('67.89');
    expect(html).not.toContain('unitPurchasePrice');
  });
});
