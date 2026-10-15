import { describe, expect, it } from 'vitest';
import {
  categorySchema,
  listSchema,
  marketingToggleSchema,
  productSchema,
  tagSchema,
} from '../../src/lib/validation';
import {
  formatCategoryPrefix,
  formatProductCode,
  getNextCategoryPrefix,
} from '../../src/lib/product-code';

const validProduct = {
  code: 'CR-001',
  name: '紫水晶',
  description: '',
  categoryId: 'clx1234567890123456789012',
  priceCents: 12900,
  currency: 'CNY',
  stock: 1,
  published: false,
  imageKeys: [],
};

describe('catalog validation', () => {
  it('accepts nonnegative inventory and filters', () => {
    expect(productSchema.parse(validProduct).stock).toBe(1);
    expect(productSchema.parse({ ...validProduct, stock: 0 }).stock).toBe(0);
    expect(productSchema.parse({ ...validProduct, stock: 2 }).stock).toBe(2);
    expect(productSchema.parse({ ...validProduct, stock: 2147483647 }).stock).toBe(2147483647);
    expect(listSchema.parse({ page: '2', stock: '0' })).toMatchObject({ page: 2, stock: '0' });
    expect(listSchema.parse({ stock: '1' }).stock).toBe('1');
    expect(categorySchema.parse({ name: '  紫水晶  ' }).name).toBe('紫水晶');
  });

  it('rejects invalid inventory and price', () => {
    for (const stock of [-1, 1.5, 2147483648]) {
      expect(productSchema.safeParse({ ...validProduct, stock }).success).toBe(false);
    }
    expect(productSchema.safeParse({ ...validProduct, priceCents: -1 }).success).toBe(false);
    expect(productSchema.safeParse({ ...validProduct, priceCents: 12.5 }).success).toBe(false);
  });

  it('rejects duplicate or untrusted image keys', () => {
    expect(productSchema.safeParse({ ...validProduct, imageKeys: ['a', 'a'] }).success).toBe(false);
    expect(productSchema.safeParse({ ...validProduct, currency: 'USD' }).success).toBe(false);
  });

  it('trims tag names and accepts case-distinct names', () => {
    expect(tagSchema.parse({ name: ' Rose ' }).name).toBe('Rose');
    expect(tagSchema.parse({ name: 'rose' }).name).toBe('rose');
    expect(tagSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(tagSchema.safeParse({ name: 'a'.repeat(61) }).success).toBe(false);
  });

  it('accepts optional unique tag IDs and rejects invalid or repeated IDs', () => {
    const tagId = 'clx1234567890123456789012';
    expect(productSchema.parse(validProduct).tagIds).toBeUndefined();
    expect(productSchema.parse({ ...validProduct, tagIds: [] }).tagIds).toEqual([]);
    expect(productSchema.parse({ ...validProduct, tagIds: [tagId] }).tagIds).toEqual([tagId]);
    expect(productSchema.safeParse({ ...validProduct, tagIds: [tagId, tagId] }).success).toBe(
      false,
    );
    expect(productSchema.safeParse({ ...validProduct, tagIds: ['invalid'] }).success).toBe(false);
    expect(listSchema.parse({ tagId }).tagId).toBe(tagId);
    expect(listSchema.safeParse({ tagId: 'invalid' }).success).toBe(false);
  });

  it('limits direct marketing updates to the three cabochon list switches', () => {
    for (const field of ['videoShot', 'xiaohongshuVideoPublished', 'xiaohongshuListed']) {
      expect(marketingToggleSchema.parse({ field, value: true })).toEqual({ field, value: true });
    }
    expect(marketingToggleSchema.safeParse({ field: 'douyinListed', value: true }).success).toBe(
      false,
    );
    expect(marketingToggleSchema.safeParse({ field: 'videoShot', value: 'true' }).success).toBe(
      false,
    );
    expect(
      marketingToggleSchema.safeParse({ field: 'videoShot', value: true, stock: 0 }).success,
    ).toBe(false);
  });
});

describe('product code generation', () => {
  it('generates category prefixes in alphabetic sequence', () => {
    expect(formatCategoryPrefix(0)).toBe('A');
    expect(formatCategoryPrefix(25)).toBe('Z');
    expect(formatCategoryPrefix(26)).toBe('AA');
    expect(formatCategoryPrefix(27)).toBe('AB');
    expect(getNextCategoryPrefix(['A', 'B', 'Z', null])).toBe('C');
  });

  it('uses category prefixes and a one-based four-digit count', () => {
    expect(formatProductCode('A', 0)).toBe('A0001');
    expect(formatProductCode('B', 0)).toBe('B0001');
    expect(formatProductCode('C', 0)).toBe('C0001');
    expect(formatProductCode('AA', 9)).toBe('AA0010');
  });
});
