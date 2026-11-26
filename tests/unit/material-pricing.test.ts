import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computePricing,
  recentStart,
  summarizePurchases,
} from '@/lib/material-pricing/calculations';
import {
  pricingGroupSchema,
  pricingGroupUpdateSchema,
  type PricingPurchase,
} from '@/lib/material-pricing/contracts';
import { signCostBasis, readCostBasis } from '@/lib/material-pricing/basis';
import { calculateDiyCost, calculateDiyQuote } from '@/lib/product-diy-cost';
import { diySource, diyDataSchema, emptyDiyData } from '@/lib/diyImageImport/contracts';

const now = new Date('2026-11-20T03:00:00Z');
const config = pricingGroupSchema.parse({
  name: 'S925亮银',
  materialIds: [],
  lossRate: '20',
  marketLinked: false,
  pricingRule: 'MARGIN',
  pricingValue: '30',
});
const purchase = (patch: Partial<PricingPurchase> = {}): PricingPurchase => ({
  id: 'purchase-a',
  materialId: 'material',
  materialName: 'silver',
  batchId: 'batch',
  batchName: 'batch',
  distributorId: 'supplier-a',
  distributorName: 'A',
  receivedAt: '2026-11-15',
  amount: '1200',
  weight: '100',
  ...patch,
});
afterEach(() => vi.unstubAllEnvs());
describe('unified material pricing', () => {
  it('weights real amounts and grams, includes explicit zero and explains missing and future purchases', () => {
    const rows = [
      purchase(),
      purchase({ id: 'b', amount: '200', weight: '10', distributorId: 'supplier-b' }),
      purchase({ id: 'free', amount: '0', weight: '10' }),
      purchase({ id: 'missing', amount: null }),
      purchase({ id: 'weight', weight: '0' }),
      purchase({ id: 'future', receivedAt: '2026-11-21' }),
    ];
    const result = summarizePurchases(rows, '20', now);
    expect(result.totals).toEqual({
      amount: '1400.00',
      weight: '120.00',
      count: 3,
      rawCost: '11.67',
      adjustedCost: '14.58',
    });
    expect(result.excluded.map((row) => row.reason).sort()).toEqual([
      'FUTURE_DATE',
      'INVALID_WEIGHT',
      'MISSING_AMOUNT',
    ]);
    expect(result.distributors).toHaveLength(2);
    expect(result.distributors.find((row) => row.id === 'supplier-b')?.adjustedCost).toBe('25.00');
  });
  it('does not round average costs before loss compensation and applies loss exactly once', () => {
    const summary = summarizePurchases([purchase({ amount: '1', weight: '3' })], '20', now);
    expect(summary.totals.rawCost).toBe('0.33');
    expect(summary.totals.adjustedCost).toBe('0.42');
    const preview = computePricing(
      { ...config, pricingRule: 'PERCENT', pricingValue: '30' },
      summary,
      null,
      now,
    );
    expect(preview.suggestedPrice).toBe('0.55');
    expect(
      computePricing({ ...config, pricingRule: 'PERCENT', pricingValue: '30' }, summary, null, now),
    ).toEqual(preview);
  });
  it('matches weekend purchases to the preceding trading day without raising selling prices with replacement costs', () => {
    const summary = summarizePurchases([purchase()], '20', now); // Sunday, November 15.
    const market = {
      quote: {
        price: 12,
        previousClose: 11,
        open: null,
        high: null,
        low: null,
        change: 1,
        changePercent: 9,
        updatedAt: now.toISOString(),
      },
      points: [
        { date: '2026-11-13', price: 10 },
        { date: '2026-11-16', price: 99 },
      ],
    };
    const result = computePricing({ ...config, marketLinked: true }, summary, market, now);
    expect(result).toMatchObject({
      replacementCost: '14.00',
      adjustedReplacementCost: '17.50',
      pricingCost: '15.00',
      suggestedPrice: '21.43',
      warning: null,
    });
    expect(result.market?.purchaseAverage).toBe('10.00000000');
  });
  it.each([5, 30])(
    'uses all history for selling prices independently of silver at %s',
    (silver) => {
      const summary = summarizePurchases(
        [
          purchase({ id: 'old', receivedAt: '2025-01-01', amount: '8000', weight: '1000' }),
          purchase(),
          purchase({ id: 'recent', amount: '400', weight: '20' }),
          purchase({ id: 'future', receivedAt: '2026-11-21', amount: '90000' }),
          purchase({ id: 'missing', amount: null }),
        ],
        '20',
        now,
      );
      const market = {
        quote: {
          price: silver,
          previousClose: 10,
          open: null,
          high: null,
          low: null,
          change: silver - 10,
          changePercent: 0,
          updatedAt: now.toISOString(),
        },
        points: [{ date: '2026-11-13', price: 10 }],
      };
      const input = { ...config, pricingRule: 'PERCENT' as const, pricingValue: '50' };
      const plain = computePricing(input, summary, null, now);
      const linked = computePricing({ ...input, marketLinked: true }, summary, market, now);
      expect(summary.totals.rawCost).toBe('8.57');
      expect(summary.recent.rawCost).toBe('13.33');
      expect(linked).toMatchObject({
        pricingCost: '10.71',
        suggestedPrice: '16.08',
        warning: null,
      });
      expect(linked.suggestedPrice).toBe(plain.suggestedPrice);
      expect(linked.replacementCost).toBe(silver === 5 ? '8.33' : '33.33');
      expect(linked.market?.purchaseAverage).toBe('10.00000000');
    },
  );
  it('falls back explicitly for unavailable history, no recent samples and invalid replacement estimates', () => {
    const input = { ...config, marketLinked: true };
    const summary = summarizePurchases([purchase()], '20', now);
    expect(computePricing(input, summary, null, now)).toMatchObject({
      warning: 'MARKET_UNAVAILABLE',
      suggestedPrice: '21.43',
    });
    const old = summarizePurchases([purchase({ receivedAt: '2025-01-01' })], '20', now);
    expect(computePricing(input, old, null, now).warning).toBe('NO_RECENT_SAMPLES');
    const result = computePricing(
      input,
      summary,
      {
        quote: {
          price: 1,
          previousClose: 1,
          change: 0,
          changePercent: 0,
          open: null,
          high: null,
          low: null,
          updatedAt: now.toISOString(),
        },
        points: [{ date: '2026-11-13', price: 100 }],
      },
      now,
    );
    expect(result.warning).toBe('INVALID_REPLACEMENT');
    expect(result.pricingCost).toBe('15.00');
  });
  it('handles 0%, near-total losses, unknown costs, and all pricing rules without float rounding', () => {
    const summary = summarizePurchases([purchase()], '0', now);
    expect(summary.totals.adjustedCost).toBe('12.00');
    const rules = [
      ['PERCENT', '30', '15.60'],
      ['FIXED', '2', '14.00'],
      ['CUSTOM', '18.23', '18.23'],
      ['MARGIN', '30', '17.15'],
    ] as const;
    for (const [pricingRule, pricingValue, expected] of rules)
      expect(
        computePricing({ ...config, lossRate: '0', pricingRule, pricingValue }, summary, null, now)
          .suggestedPrice,
      ).toBe(expected);
    expect(summarizePurchases([purchase()], '99.99', now).totals.adjustedCost).toBe('120000.00');
    expect(
      computePricing(config, summarizePurchases([], '20', now), null, now).suggestedPrice,
    ).toBeNull();
    for (const lossRate of ['-1', '100', '0.001'])
      expect(pricingGroupSchema.safeParse({ ...config, lossRate }).success).toBe(false);
    expect(pricingGroupSchema.safeParse({ ...config, pricingValue: '100' }).success).toBe(false);
    expect(pricingGroupUpdateSchema.safeParse({ ...config, version: 2 }).success).toBe(true);
    expect(recentStart(new Date('2026-11-19T16:00:00Z'))).toBe('2026-08-23');
  });
  it('binds cost provenance to its group and price version, rejecting altered tokens', () => {
    vi.stubEnv('AUTH_SECRET', 'unit-pricing-secret');
    const basis = {
      groupId: 'cm000000000000000000000001',
      publicationId: 'cm000000000000000000000002',
      name: '清迈银',
      rawCost: '12.00',
      adjustedCost: '15.00',
      lossRate: '20.00',
      capturedAt: now.toISOString(),
    };
    const token = signCostBasis(basis);
    expect(readCostBasis(token)).toEqual(basis);
    expect(readCostBasis(token + 'x')).toBeNull();
    const [payload, signature] = token.split('.');
    const altered = Buffer.from(JSON.stringify({ ...basis, lossRate: '0' })).toString('base64url');
    expect(readCostBasis(`${altered}.${signature}`)).toBeNull();
    expect(readCostBasis(`${payload}.${signature}.extra`)).toBeNull();
  });
  it('calculates multiple group rows and legacy silver once and supports an image draft containing only group rows', () => {
    const line = {
      groupId: 'cm000000000000000000000001',
      publicationId: 'cm000000000000000000000002',
      costBasisToken: 'stored-token',
      quantity: '2',
      unitCost: '15',
      quoteUnitPrice: '25',
    };
    const source = {
      origin: 'DIY' as const,
      quantity: 3,
      notes: '',
      materials: [],
      cabochons: [],
      extraCosts: [],
      pricingLines: [line, { ...line, quantity: '1', unitCost: '10', quoteUnitPrice: '20' }],
    };
    expect(calculateDiyCost(source)).toEqual({ perUnitCost: '40.00', totalCost: '120.00' });
    expect(calculateDiyQuote(source)).toEqual({ perUnitQuote: '70.00', totalQuote: '210.00' });
    expect(
      calculateDiyCost({
        ...source,
        silverCost: { weightGrams: '1', costGramPrice: '5', quoteGramPrice: '8' },
      })?.perUnitCost,
    ).toBe('45.00');
    const draft = { ...emptyDiyData(), quantity: 3, pricingLines: [line] };
    expect(diySource(draft)?.pricingLines).toEqual([line]);
    expect(calculateDiyCost(diySource(draft)!)).toEqual({
      perUnitCost: '30.00',
      totalCost: '90.00',
    });
    expect(diySource({ ...draft, pricingLines: [] })).toBeNull();
    const incompleteDraft = { ...draft, pricingLines: [{ ...line, quantity: '', unitCost: '' }] };
    expect(diyDataSchema.safeParse(incompleteDraft).success).toBe(true);
    expect(diySource(incompleteDraft)).toBeNull();
  });
});
