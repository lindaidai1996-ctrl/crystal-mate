import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { sameOrderedRows } from '@/lib/unchanged-relations';

describe('unchanged business collections', () => {
  it('preserves image identities when null framing and object key ordering are unchanged', () => {
    const existing = [
      { id: 'old-id', objectKey: 'image', position: 0, framing: null, createdAt: new Date() },
    ];
    expect(
      sameOrderedRows(existing, [{ position: 0, objectKey: 'image', framing: Prisma.DbNull }]),
    ).toBe(true);
    expect(
      sameOrderedRows(existing, [{ position: 0, objectKey: 'different', framing: null }]),
    ).toBe(false);
    expect(
      sameOrderedRows(existing, [
        { position: 0, objectKey: 'image', framing: { mode: 'contain' } },
      ]),
    ).toBe(false);
  });
  it('compares decimal business values exactly while keeping text and row order meaningful', () => {
    const existing = [
      {
        id: 'old',
        quantity: new Prisma.Decimal('1.00'),
        unitCost: new Prisma.Decimal('12.50'),
        position: 0,
        quoteSnapshot: { code: '001', name: 'test' },
      },
    ];
    expect(
      sameOrderedRows(existing, [
        {
          quantity: '1',
          unitCost: '12.5',
          position: 0,
          quoteSnapshot: { name: 'test', code: '001' },
        },
      ]),
    ).toBe(true);
    expect(sameOrderedRows(existing, [{ quantity: '1', unitCost: '12.51', position: 0 }])).toBe(
      false,
    );
    expect(sameOrderedRows(existing, [{ quantity: '1', unitCost: '12.5', position: 1 }])).toBe(
      false,
    );
    expect(sameOrderedRows(existing, [{ quoteSnapshot: { code: '1', name: 'test' } }])).toBe(false);
  });
});
