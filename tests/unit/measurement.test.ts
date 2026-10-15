import { describe, expect, it } from 'vitest';
import { parseMeasurement } from '../../src/lib/parse-measurement';
import { measurementSchema, productSchema } from '../../src/lib/validation';

const product = {
  code: 'CAB-001',
  name: '蛋面',
  description: '',
  categoryId: 'clx1234567890123456789012',
  priceCents: 100,
  currency: 'CNY',
  stock: 1,
  published: false,
  imageKeys: [],
};

describe('measurement recognition', () => {
  it('maps one, two, and three dimensions', () => {
    expect(parseMeasurement('11')).toEqual({ lengthMm: 11, widthMm: 11, heightMm: 11 });
    expect(parseMeasurement('11x22')).toEqual({ lengthMm: 11, widthMm: 11, heightMm: 22 });
    expect(parseMeasurement('11*22')).toEqual({ lengthMm: 11, widthMm: 11, heightMm: 22 });
    expect(parseMeasurement(' 11 X 22 × 33 ')).toEqual({
      lengthMm: 11,
      widthMm: 22,
      heightMm: 33,
    });
    expect(parseMeasurement('11.25x22.5x33')).toEqual({
      lengthMm: 11.25,
      widthMm: 22.5,
      heightMm: 33,
    });
  });

  it('rejects malformed, nonpositive, and overprecision input', () => {
    for (const input of ['', '11x', '11x22x33x44', '11 22', '0x22', '-1', '1.234']) {
      expect(parseMeasurement(input)).toBeNull();
    }
  });
});

describe('product measurement input', () => {
  it('accepts a partial measurement or an explicit clear', () => {
    expect(productSchema.safeParse({ ...product, measurement: { lengthMm: 11.25 } }).success).toBe(
      true,
    );
    expect(productSchema.safeParse({ ...product, measurement: null }).success).toBe(true);
    expect(measurementSchema.safeParse({ widthMm: 0.01 }).success).toBe(true);
  });

  it('rejects invalid measurement precision and incomplete marketing objects', () => {
    for (const lengthMm of [0, -1, 1.234, 100000000]) {
      expect(productSchema.safeParse({ ...product, measurement: { lengthMm } }).success).toBe(
        false,
      );
    }
    expect(productSchema.safeParse({ ...product, marketing: { videoShot: true } }).success).toBe(
      false,
    );
  });
});
