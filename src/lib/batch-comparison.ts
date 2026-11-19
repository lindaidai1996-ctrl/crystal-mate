import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type {
  BatchComparison,
  ComparisonBatch,
  ComparisonEntry,
  ComparisonPrices,
  ComparisonTotal,
  ComparisonUnit,
} from './batch-comparison-contracts';

// A separate Decimal constructor avoids changing precision for other business services.
const Decimal = Prisma.Decimal.clone({ precision: 50 });
const fixed = (value: InstanceType<typeof Decimal>) => value.toFixed(2);
export const comparisonQuerySchema = z
  .object({
    receivedFrom: z.iso.date().optional(),
    receivedTo: z.iso.date().optional(),
    distributorId: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (query) => !query.receivedFrom || !query.receivedTo || query.receivedFrom <= query.receivedTo,
  );
export type ComparisonQuery = z.infer<typeof comparisonQuerySchema>;

export function comparisonTotal(values: (string | null)[]): ComparisonTotal {
  return {
    known: fixed(
      values.reduce<InstanceType<typeof Decimal>>(
        (sum, value) => (value === null ? sum : sum.add(value)),
        new Decimal(0),
      ),
    ),
    missingCount: values.filter((value) => value === null).length,
  };
}

function completeTotal(values: (string | null)[]) {
  const total = comparisonTotal(values);
  return total.missingCount ? null : total.known;
}

export function comparisonRatio(numerator: string | null, denominator: string | null) {
  return numerator !== null && denominator !== null && new Decimal(denominator).gt(0)
    ? new Decimal(numerator).div(denominator).toFixed(6)
    : null;
}

export function multiplyComparison(a: string | null, b: string | null) {
  return a === null || b === null ? null : fixed(new Decimal(a).mul(b));
}

export function buildBatchComparison(
  item: BatchComparison['item'],
  allEntries: ComparisonEntry[],
  rawQuery: ComparisonQuery = {},
  productStock: string | null = null,
  now = new Date(),
): BatchComparison {
  const query = comparisonQuerySchema.parse(rawQuery);
  const entries = allEntries.filter(
    (entry) =>
      (!query.receivedFrom || entry.batch.receivedAt >= query.receivedFrom) &&
      (!query.receivedTo || entry.batch.receivedAt <= query.receivedTo) &&
      (!query.distributorId || entry.distributor.id === query.distributorId),
  );
  const units = [
    ...new Set(allEntries.flatMap((entry) => Object.keys(entry.quantities))),
  ] as ComparisonUnit[];
  if (!units.includes(item.unit)) units.unshift(item.unit);
  const groups = new Map<string, ComparisonEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.batch.id) ?? [];
    group.push(entry);
    groups.set(entry.batch.id, group);
  }
  const batches: ComparisonBatch[] = [...groups.values()]
    .map((rows) => {
      const prices: ComparisonPrices = {};
      for (const unit of units) {
        const amount = completeTotal(rows.map((row) => row.amount));
        const quantity = completeTotal(rows.map((row) => row.quantities[unit] ?? null));
        prices[unit] =
          comparisonRatio(amount, quantity) ??
          (rows.length === 1 ? (rows[0].prices[unit] ?? null) : null);
      }
      return {
        ...rows[0].batch,
        quantity: completeTotal(rows.map((row) => row.quantity)),
        amount: completeTotal(rows.map((row) => row.amount)),
        prices,
        entries: rows,
      };
    })
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
  const prices: BatchComparison['summary']['prices'] = {};
  for (const unit of units) {
    const eligible = entries.filter(
      (row) =>
        row.amount !== null &&
        row.quantities[unit] != null &&
        new Decimal(row.quantities[unit]!).gt(0),
    );
    const last = batches.at(-1)?.prices[unit] ?? null;
    const previous = batches.at(-2)?.prices[unit] ?? null;
    prices[unit] = {
      weightedMean: comparisonRatio(
        comparisonTotal(eligible.map((row) => row.amount)).known,
        comparisonTotal(eligible.map((row) => row.quantities[unit] ?? null)).known,
      ),
      eligibleBatchCount: new Set(eligible.map((row) => row.batch.id)).size,
      changePercent:
        last !== null && previous !== null && new Decimal(previous).gt(0)
          ? fixed(new Decimal(last).minus(previous).div(previous).mul(100))
          : null,
    };
  }
  const oldest = entries
    .filter(
      (entry) => entry.remainingQuantity !== null && new Decimal(entry.remainingQuantity).gt(0),
    )
    .sort(
      (a, b) =>
        a.batch.receivedAt.localeCompare(b.batch.receivedAt) ||
        a.batch.id.localeCompare(b.batch.id),
    )[0];
  const chinaToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return {
    item,
    currency: 'CNY',
    queriedAt: now.toISOString(),
    totalBatchCount: new Set(allEntries.map((entry) => entry.batch.id)).size,
    distributors: [
      ...new Map(allEntries.map((entry) => [entry.distributor.id, entry.distributor])).values(),
    ].sort((a, b) => a.name.localeCompare(b.name)),
    batches,
    summary: {
      batchCount: batches.length,
      quantity: comparisonTotal(entries.map((entry) => entry.quantity)),
      amount: comparisonTotal(entries.map((entry) => entry.amount)),
      prices,
      averageIntervalDays:
        batches.length > 1
          ? fixed(
              new Decimal(
                Date.parse(batches.at(-1)!.receivedAt) - Date.parse(batches[0].receivedAt),
              )
                .div(86_400_000)
                .div(batches.length - 1),
            )
          : null,
      currentStock:
        item.kind === 'material'
          ? comparisonTotal(entries.map((entry) => entry.remainingQuantity))
          : comparisonTotal([productStock]),
      inventoryValue:
        item.kind === 'material'
          ? comparisonTotal(entries.map((entry) => entry.inventoryValue))
          : null,
      oldestRemainingBatch: oldest
        ? {
            id: oldest.batch.id,
            name: oldest.batch.name,
            days: Math.max(
              0,
              Math.floor(
                (Date.parse(chinaToday) - Date.parse(oldest.batch.receivedAt)) / 86_400_000,
              ),
            ),
          }
        : null,
    },
  };
}
