import { expect, it } from 'vitest';
import baseline from '../../docs/plans/ai-assistant/development-baseline.json';
import { purchaseEntrySchema } from '@/lib/ai-assistant/purchase-contracts';
import { summarizeAssistantPurchases } from '@/lib/ai-assistant/purchase-summary';
import { assistantResultView, assistantRecordHref } from '@/lib/ai-assistant/result-view';

const rows = baseline.scopedCandidates
  .filter((row) => baseline.goldenCase.includedEntryIds.includes(row.id))
  .map((row) =>
    purchaseEntrySchema.parse({
      item: { type: 'MATERIAL', id: row.materialId },
      purchase: { type: 'MATERIAL_PURCHASE', id: row.id },
      name: row.name,
      code: null,
      batch: { id: `c${'9'.repeat(24)}`, name: 'synthetic batch', receivedAt: row.date },
      distributor: { id: row.distributorId, name: 'synthetic distributor' },
      quantity: row.quantity,
      unit: row.unit,
      unitPrice: null,
      amount: row.amount,
      amountBasis: 'recorded_total',
      currency: 'CNY',
      currencyBasis: 'business_default',
    }),
  );
const raw = {
  facts: {
    items: rows,
    summary: summarizeAssistantPurchases(rows, 44, 'selected_purchases'),
    queriedAt: '2026-11-17T04:00:00.000Z',
  },
};
it('renders the exact backend decimal strings and identities without recomputing any value', () => {
  const result = assistantResultView(raw, false)!;
  expect(result.purchases).toEqual(rows);
  expect(result.summary!.totals.amounts[0].knownAmount).toBe('1897.60');
  expect(result.summary!.totals.quantities.map((r) => [r.unit, r.knownQuantity])).toEqual(
    expect.arrayContaining([
      ['STRAND', '3.00'],
      ['BEAD', '7.00'],
      ['GRAM', '4.43'],
    ]),
  );
  expect(result.legacyDetails).toBe(true);
  expect(assistantRecordHref(rows[0].item, rows[0].purchase)).toContain(
    `/batches/${rows[0].purchase.id}`,
  );
});
it('strips monetary fields and every free text channel from the private result projection', () => {
  const result = assistantResultView(raw, true)!;
  expect(
    result.purchases.every(
      (row) =>
        row.amount === null &&
        row.unitPrice === null &&
        row.name === '' &&
        row.distributor.name === '',
    ),
  ).toBe(true);
  expect(result.summary!.totals.amounts).toEqual([]);
  expect(
    result.summary!.byDistributor.every((g) => !g.totals.amounts.length && !g.distributor.name),
  ).toBe(true);
  expect(result.summary!.byCatalog.every((g) => !g.totals.amounts.length && !g.name)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('1897.60');
  expect(result.purchases[0].quantity).toBe(rows[0].quantity);
});
it('keeps absent/invalid/failed facts absent instead of creating a zero summary', () => {
  expect(assistantResultView({ facts: null }, false)).toBeNull();
  expect(assistantResultView({ facts: { items: [] } }, false)).toBeNull();
  expect(assistantResultView(null, false)).toBeNull();
});
