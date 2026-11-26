import { describe, expect, it } from 'vitest';
import { cardMainMaterials, cardQuote } from '@/lib/product-cards/quote';
import { cardSaveSchema } from '@/lib/product-cards/contracts';
import { cardFixtureInput, cardFixtureRun } from '../fixtures/product-cards';

describe('customer product card quote', () => {
  it('allocates the whole-run craft fee per item and reconciles the single-item total', () => {
    const quote = cardQuote(cardFixtureRun())!;
    expect(quote.total).toBe('60.33');
    expect(quote.rows.map((row) => row.subtotal)).toEqual(['25.00', '2.00', '33.33']);
    expect(quote.craftAllocated).toBe(true);
    expect(quote.rows[0]).toMatchObject({
      quantity: '2.00 颗',
      specification: '8 × 8 × 8 mm',
      unitPrice: '12.50',
    });
  });
  it('exports fee usage, unit price and multiplied subtotal without internal cost', () => {
    const run = cardFixtureRun();
    run.extraCosts[0].quantity = 3;
    run.perUnitQuote = '64.33';
    run.totalQuote = '193.00';
    const quote = cardQuote(run)!;
    expect(quote.total).toBe('64.33');
    expect(quote.rows[1]).toEqual({
      name: '包装',
      specification: '',
      quantity: '3 项',
      unitPrice: '2.00',
      subtotal: '6.00',
    });
    run.extraCosts[0].quantity = 0;
    expect(cardQuote(run)).toBeNull();
  });
  it('uses half-up cent rounding for a manual aggregate craft fee', () => {
    const run = cardFixtureRun();
    run.quantity = 2;
    run.craftDesignFee = { unitAmount: '1.00', accumulateByQuantity: true, totalAmount: '0.01' };
    run.perUnitQuote = '27.01';
    run.totalQuote = '54.01';
    expect(cardQuote(run)?.rows.at(-1)?.subtotal).toBe('0.01');
    expect(cardQuote(run)?.total).toBe('27.01');
  });
  it('does not turn missing quotes into free materials or silently accept inconsistent totals', () => {
    const run = cardFixtureRun();
    run.materialLines[0].quoteUnitPrice = null;
    expect(cardQuote(run)).toBeNull();
    const mismatch = cardFixtureRun();
    mismatch.perUnitQuote = '999.00';
    expect(cardQuote(mismatch)).toBeNull();
    const unknown = cardFixtureRun();
    unknown.extraCosts[0].quoteAmount = undefined;
    expect(cardQuote(unknown)).toBeNull();
  });
  it('keeps only customer facts and deduplicates main materials', () => {
    const run = cardFixtureRun();
    run.materialLines.push({ ...run.materialLines[0], id: 'line-two' });
    expect(cardMainMaterials(run)).toEqual(['白水晶']);
    const serialized = JSON.stringify(cardQuote(cardFixtureRun()));
    for (const secret of [
      'unitCost',
      'lineCost',
      'perUnitCost',
      'totalCost',
      '内部备注',
      '内部供货商',
      'distributor',
      'notes',
      'amountPerItem',
    ])
      expect(serialized).not.toContain(secret);
  });
  it('rejects customer-supplied totals, invalid image counts and ambiguous image ownership', () => {
    expect(
      cardSaveSchema.safeParse({ ...cardFixtureInput(), quoteSnapshot: { total: '0.00' } }).success,
    ).toBe(false);
    expect(cardSaveSchema.safeParse({ ...cardFixtureInput(), images: [] }).success).toBe(false);
    expect(
      cardSaveSchema.safeParse({
        ...cardFixtureInput(),
        images: Array(4).fill(cardFixtureInput().images[0]),
      }).success,
    ).toBe(false);
    expect(
      cardSaveSchema.safeParse({
        ...cardFixtureInput(),
        images: [{ ...cardFixtureInput().images[0], sourceImageId: 'image-one' }],
      }).success,
    ).toBe(false);
  });
});
