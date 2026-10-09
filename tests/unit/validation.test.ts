import { describe, expect, it } from 'vitest';
import { categorySchema, listSchema, productSchema } from '../../src/lib/validation';

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
  it('accepts a unique piece and filters', () => {
    expect(productSchema.parse(validProduct).stock).toBe(1);
    expect(listSchema.parse({ page: '2', stock: '0' })).toMatchObject({ page: 2, stock: '0' });
    expect(categorySchema.parse({ name: '  紫水晶  ' }).name).toBe('紫水晶');
  });

  it('rejects multi-unit inventory and invalid price', () => {
    expect(productSchema.safeParse({ ...validProduct, stock: 2 }).success).toBe(false);
    expect(productSchema.safeParse({ ...validProduct, priceCents: -1 }).success).toBe(false);
    expect(productSchema.safeParse({ ...validProduct, priceCents: 12.5 }).success).toBe(false);
  });

  it('rejects duplicate or untrusted image keys', () => {
    expect(productSchema.safeParse({ ...validProduct, imageKeys: ['a', 'a'] }).success).toBe(false);
    expect(productSchema.safeParse({ ...validProduct, currency: 'USD' }).success).toBe(false);
  });
});
