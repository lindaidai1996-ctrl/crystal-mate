import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assistantResultView, assistantRecordHref } from './result-view';
import type { QueryState } from './orchestration-contracts';
import type { FactField } from './composable-contracts';
import { factFieldSchema } from './composable-contracts';
import { CandidateQueryError } from './candidate-contracts';
import { minimizeAssistantValue } from './privacy';

export const factRowSchema = z.object({
  id: z.string().max(100),
  values: z.partialRecord(factFieldSchema, z.string().nullable()),
  href: z.string().startsWith('/admin/').nullable(),
  sources: z.array(z.string().max(100)).max(5000),
});
export const factSetSchema = z.object({
  id: z.uuid(),
  rows: z.array(factRowSchema).max(5000),
  observations: z.array(z.iso.datetime({ offset: true })).max(24),
  complete: z.boolean(),
  warnings: z.array(z.string().max(1000)).max(30),
  query: z.unknown(),
  parents: z.array(z.uuid()).max(12),
  rankingPartitions: z.array(factFieldSchema).max(24).optional(),
});
export type FactRow = z.infer<typeof factRowSchema>;
export type FactSet = z.infer<typeof factSetSchema>;
export const NUMERIC_FIELDS = new Set<FactField>([
  'quantity',
  'unitPrice',
  'amount',
  'stock',
  'stockUnknown',
  'count',
  'unknown',
  'baseline',
  'current',
  'difference',
  'percent',
]);
export const PRIVATE_FIELDS = new Set<FactField>([
  'item',
  'purchase',
  'specification',
  'date',
  'quantity',
  'unit',
  'stock',
  'stockUnknown',
  'count',
  'unknown',
]);
export function requireFactSet(sets: FactSet[], id: string) {
  const set = sets.find((entry) => entry.id === id);
  if (!set) throw new CandidateQueryError('FACT_REFERENCE_INVALID');
  return set;
}
export function factSetFromResult(raw: unknown, state: QueryState): FactSet {
  const result = assistantResultView(raw, false);
  if (!result) throw new CandidateQueryError('QUERY_FACTS_INVALID');
  const rows: FactRow[] = [];
  const stock = new Map(result.stock?.catalogStock.map((r) => [`${r.item.type}:${r.item.id}`, r]));
  const details = new Map(
    result.catalog.map((r) => [r.purchase?.id ?? `${r.item.type}:${r.item.id}`, r]),
  );
  const specification = (item: { type: string; id: string }, purchase?: { id: string }) => {
    const d = details.get(purchase?.id ?? '') ?? details.get(`${item.type}:${item.id}`);
    return d && d.lengthMm !== null && d.widthMm !== null && d.heightMm !== null
      ? `${d.lengthMm} × ${d.widthMm} × ${d.heightMm} mm`
      : null;
  };
  if (result.kind === 'distributors') {
    for (const r of result.distributors?.confirmed ?? [])
      rows.push({
        id: r.distributor.id,
        href: `/admin/distributors/${r.distributor.id}`,
        sources: [r.distributor.id],
        values: {
          name: r.name,
          distributor: r.name,
          distributorId: r.distributor.id,
          reason: r.reason,
          evidence: r.evidence.map((e) => e.matchedText).join('；'),
        },
      });
  } else if (result.kind === 'purchases') {
    for (const r of result.purchases) {
      const item = `${r.item.type}:${r.item.id}`;
      const s = stock.get(item);
      rows.push({
        id: r.purchase.id,
        href: assistantRecordHref(r.item, r.purchase),
        sources: [r.purchase.id],
        values: {
          name: r.name,
          item,
          purchase: `${r.purchase.type}:${r.purchase.id}`,
          specification: specification(r.item, r.purchase),
          date: r.batch.receivedAt,
          distributor: r.distributor.name,
          distributorId: r.distributor.id,
          quantity: r.quantity,
          unit: r.unit,
          unitPrice: r.unitPrice,
          amount: r.amount,
          currency: r.currency,
          currencyBasis: r.currencyBasis,
          stock: s?.knownStock ?? null,
          stockUnknown: s ? String(s.unknownStockBatchCount) : null,
        },
      });
    }
  } else if (result.stockMode === 'purchase_remaining') {
    for (const r of result.stock?.sourceStock ?? [])
      rows.push({
        id: r.purchase.id,
        href: assistantRecordHref(r.item, r.purchase),
        sources: [r.purchase.id],
        values: {
          name: r.name,
          item: `${r.item.type}:${r.item.id}`,
          purchase: `${r.purchase.type}:${r.purchase.id}`,
          specification: specification(r.item, r.purchase),
          quantity: r.purchasedQuantity,
          stock: r.remainingQuantity,
          stockUnknown: r.remainingQuantity === null ? '1' : '0',
          unit: r.unit,
        },
      });
  } else {
    for (const d of result.catalog) {
      const item = `${d.item.type}:${d.item.id}`;
      const s = stock.get(item);
      rows.push({
        id: item,
        href: assistantRecordHref(d.item),
        sources: [item],
        values: {
          name: d.name,
          item,
          specification: specification(d.item),
          stock: s?.knownStock ?? null,
          stockUnknown: s ? String(s.unknownStockBatchCount) : null,
          unit: s?.unit ?? null,
        },
      });
    }
  }
  const evidence = z
    .object({
      relevance: z
        .object({
          decisions: z.array(
            z.object({
              item: z.object({ type: z.string(), id: z.string() }),
              purchase: z.object({ id: z.string() }).nullable(),
              reason: z.string(),
              evidence: z.array(z.object({ field: z.string(), value: z.unknown() })),
            }),
          ),
        })
        .nullable()
        .optional(),
    })
    .safeParse(raw);
  if (evidence.success)
    for (const row of rows) {
      const decision = evidence.data.relevance?.decisions.find((d) =>
        d.purchase ? d.purchase.id === row.id : `${d.item.type}:${d.item.id}` === row.values.item,
      );
      if (decision) {
        row.values.reason = decision.reason;
        // Full addresses/notes are not part of the fact/model DTO.
        row.values.evidence = decision.evidence
          .filter((e) => ['name', 'aliases', 'description'].includes(e.field))
          .map(
            (e) =>
              `${e.field}: ${Array.isArray(e.value) ? e.value.join('、') : String(e.value ?? '')}`,
          )
          .join('；');
      }
    }
  return factSetSchema.parse({
    id: randomUUID(),
    rows,
    observations: [result.queriedAt, ...(result.stock ? [result.stock.queriedAt] : [])],
    complete: !result.selectionIsPartial,
    query: state.query,
    parents: [],
    warnings: [
      ...(result.selectionIsPartial ? ['部分记录待确认，以下只包含已确定记录。'] : []),
      ...(result.uncertainPurchases
        ? [
            `另有 ${result.uncertainPurchases.items.length} 条采购记录待确认，未计入确定金额。${result.uncertainPurchases.summary.totals.amounts
              .map(
                (amount) =>
                  `待确认记录的已知金额合计 ${amount.knownAmount} ${amount.currency ?? '未知币种'}（金额未知 ${amount.unknownAmountEntryCount} 条）。`,
              )
              .join('')}名称、原因及各行金额单独列在待确认采购中。`,
          ]
        : []),
      ...(result.purchases.some((r) => r.currencyBasis === 'business_default')
        ? ['采购币种采用 CNY 业务默认值。']
        : []),
      ...(result.stock
        ? [
            result.stockMode === 'purchase_remaining'
              ? '库存为所选物料采购行的当前余量。'
              : '库存为货品的全部当前库存，非本次采购余量。',
          ]
        : []),
    ],
  });
}
export function factPreview(set: FactSet, privacy: boolean, fields?: FactField[], offset = 0) {
  return minimizeAssistantValue({
    id: set.id,
    totalRows: set.rows.length,
    complete: set.complete,
    observations: set.observations,
    warnings: privacy ? (set.complete ? [] : ['部分记录待确认或查询未完成。']) : set.warnings,
    offset,
    hasMore: offset + 50 < set.rows.length,
    rows: set.rows.slice(offset, offset + 50).map((r) => ({
      id: r.id,
      values: Object.fromEntries(
        Object.entries(r.values).filter(
          ([key]) =>
            (!privacy || PRIVATE_FIELDS.has(key as FactField)) &&
            (!fields || fields.includes(key as FactField)),
        ),
      ),
    })),
  });
}
