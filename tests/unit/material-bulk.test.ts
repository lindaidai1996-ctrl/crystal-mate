import { describe, expect, it } from 'vitest';
import { emptyMaterial } from '../../src/lib/material-defaults';
import { MAX_STOCK } from '../../src/lib/inventory';
import {
  bulkSaleValues,
  bulkStockQuantity,
  bulkTagChanges,
  materialBulkUpdateSchema,
  togglePageSelection,
} from '../../src/lib/material-bulk';

describe('bulk material selection', () => {
  it('selects and deselects only the current page while retaining other pages', () => {
    const first = togglePageSelection([], ['a', 'b'], true);
    const both = togglePageSelection(first, ['c', 'd'], true);
    expect(togglePageSelection(both, ['a', 'b'], false)).toEqual(['c', 'd']);
    expect(togglePageSelection(both, ['c'], false)).toEqual(['a', 'b', 'd']);
    expect(togglePageSelection(both, ['a'], true)).toHaveLength(4);
  });
});

describe('bulk material tags', () => {
  const id = 'clx1234567890123456789012';
  const otherId = 'clx1234567890123456789013';
  const base = {
    snapshot: { materials: [{ id, updatedAt: new Date().toISOString() }], entries: [] },
    entryIds: [],
  };

  it('adds only missing tags and keeps existing tags by default', () => {
    expect(bulkTagChanges(['existing', 'shared'], ['shared', 'new'], false)).toEqual({
      add: ['new'],
      remove: [],
    });
    expect(
      materialBulkUpdateSchema.parse({
        ...base,
        changes: { tags: { ids: [id], replace: false } },
      }).changes.tags,
    ).toEqual({ ids: [id], replace: false });
  });

  it('replaces old tags and allows clearing every tag', () => {
    expect(bulkTagChanges(['existing', 'shared'], ['shared', 'new'], true)).toEqual({
      add: ['new'],
      remove: ['existing'],
    });
    expect(bulkTagChanges(['existing'], [], true)).toEqual({ add: [], remove: ['existing'] });
    expect(
      materialBulkUpdateSchema.safeParse({
        ...base,
        changes: { tags: { ids: [], replace: true } },
      }).success,
    ).toBe(true);
  });

  it('rejects empty additive and duplicate tag selections', () => {
    for (const tags of [
      { ids: [], replace: false },
      { ids: [id, id], replace: false },
      { ids: [id, otherId], replace: 'yes' },
    ]) {
      expect(materialBulkUpdateSchema.safeParse({ ...base, changes: { tags } }).success).toBe(
        false,
      );
    }
  });
});

describe('bulk material quantities', () => {
  it('sets unknown quantities, including zero, and uses exact two-place gram arithmetic', () => {
    expect(
      bulkStockQuantity(null, 'BEAD', { mode: 'SET', quantities: { BEAD: 0 }, reason: '' }),
    ).toBe(0);
    expect(
      bulkStockQuantity(0.1, 'GRAM', { mode: 'ADD', quantities: { GRAM: 0.2 }, reason: '' }),
    ).toBe(0.3);
    expect(
      bulkStockQuantity(0.3, 'GRAM', { mode: 'SUBTRACT', quantities: { GRAM: 0.2 }, reason: '' }),
    ).toBe(0.1);
  });
  it('rejects unknown increments, negative results, overflow and invalid precision', () => {
    expect(() =>
      bulkStockQuantity(null, 'BEAD', { mode: 'ADD', quantities: { BEAD: 1 }, reason: '' }),
    ).toThrow('UNKNOWN_STOCK');
    expect(() =>
      bulkStockQuantity(1, 'BEAD', { mode: 'SUBTRACT', quantities: { BEAD: 2 }, reason: '' }),
    ).toThrow('STOCK_OUT_OF_RANGE');
    expect(() =>
      bulkStockQuantity(MAX_STOCK, 'BEAD', { mode: 'ADD', quantities: { BEAD: 1 }, reason: '' }),
    ).toThrow('STOCK_OUT_OF_RANGE');
    expect(() =>
      bulkStockQuantity(1, 'STRAND', { mode: 'SET', quantities: { STRAND: 1.1 }, reason: '' }),
    ).toThrow('QUANTITY_REQUIRED');
    expect(() =>
      bulkStockQuantity(1, 'GRAM', { mode: 'SET', quantities: { GRAM: 1.111 }, reason: '' }),
    ).toThrow('QUANTITY_REQUIRED');
  });
});

describe('bulk material pricing', () => {
  const strand = () => ({
    ...emptyMaterial(),
    purchaseUnitPrice: '10.01',
    purchaseGramPrice: '2.00',
    purchaseGramManual: true,
    childCount: 10,
    childUnitPrice: '1.00',
    childPriceSource: 'CUSTOM' as const,
    saleUnitPrice: '99.00',
    saleUnitManual: true,
  });
  it('recalculates prices per entry using current rounding and resets manual overrides', () => {
    expect(bulkSaleValues(strand(), { rule: 'PERCENT_50' })).toMatchObject({
      saleUnitPrice: '16.00',
      saleGramPrice: '3.00',
      saleChildUnitPrice: '2.00',
      saleUnitManual: false,
    });
    expect(bulkSaleValues(strand(), { rule: 'FIXED_AMOUNT', value: '2.00' }).saleUnitPrice).toBe(
      '12.01',
    );
    expect(bulkSaleValues(strand(), { rule: 'CUSTOM_PERCENT', value: '10.00' }).saleUnitPrice).toBe(
      '12.00',
    );
    expect(bulkSaleValues(strand(), { rule: 'COST' }).saleUnitPrice).toBe('10.01');
  });
  it('keeps custom price fields that were not supplied and synchronizes gram unit price', () => {
    expect(
      bulkSaleValues(strand(), {
        rule: 'CUSTOM_AMOUNT',
        prices: { STRAND: { saleChildUnitPrice: '5.00' } },
      }),
    ).toMatchObject({ saleUnitPrice: '99.00', saleChildUnitPrice: '5.00' });
    expect(
      bulkSaleValues(
        { ...emptyMaterial(), unit: 'GRAM', purchaseGramPrice: '8.00', saleGramPrice: '9.00' },
        { rule: 'CUSTOM_AMOUNT', prices: { GRAM: { saleGramPrice: '12.50' } } },
      ),
    ).toMatchObject({ saleUnitPrice: '12.50', saleGramPrice: '12.50' });
    expect(() => bulkSaleValues(strand(), { rule: 'CUSTOM_AMOUNT', prices: {} })).toThrow(
      'PRICE_REQUIRED',
    );
    expect(() =>
      bulkSaleValues({ ...strand(), purchaseUnitPrice: '9999999999.99' }, { rule: 'PERCENT_60' }),
    ).toThrow('PRICE_OUT_OF_RANGE');
  });
  it('accepts a category-only patch and rejects empty or unrelated changes', () => {
    const id = 'clx1234567890123456789012';
    const base = {
      snapshot: { materials: [{ id, updatedAt: new Date().toISOString() }], entries: [] },
      entryIds: [],
    };
    expect(
      materialBulkUpdateSchema.parse({ ...base, changes: { categoryId: id } }).changes,
    ).toEqual({ categoryId: id });
    expect(materialBulkUpdateSchema.safeParse({ ...base, changes: {} }).success).toBe(false);
    expect(
      materialBulkUpdateSchema.safeParse({ ...base, changes: { name: 'not supported' } }).success,
    ).toBe(false);
    expect(
      materialBulkUpdateSchema.safeParse({
        ...base,
        changes: { stock: { mode: 'SET', quantities: { BEAD: 0.5 } } },
      }).success,
    ).toBe(false);
  });
});
