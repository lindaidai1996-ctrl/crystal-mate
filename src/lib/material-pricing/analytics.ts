import { Decimal as PrismaDecimal } from '@prisma/client/runtime/index-browser.js';
import { inDateRange, type DateRange } from '@/lib/date-range';
import type { ProcurementRow } from './purchase-contracts';

// Keep full quote × weight sums precise at the 5,000-row ledger limit.
const Decimal = PrismaDecimal.clone({ precision: 40, rounding: PrismaDecimal.ROUND_HALF_UP });

export type ProcurementGranularity = 'day' | 'month' | 'year';
export type ProcurementAnalysisSummary = {
  count: number;
  weight: string | null;
  amount: string | null;
  unknownWeight: number;
  unknownAmount: number;
  actualPrice: string | null;
  priceCount: number;
  quotePrice: string | null;
  quoteCount: number;
  discount: string | null;
  latestDate: string | null;
  latestActualPrice: string | null;
  latestQuote: string | null;
};

export function filterProcurementRows(
  rows: ProcurementRow[],
  {
    groupId = '',
    distributorId = '',
    dates = null,
  }: {
    groupId?: string;
    distributorId?: string;
    dates?: DateRange;
  },
) {
  return rows.filter(
    (row) =>
      (!groupId || row.groupId === groupId) &&
      (!distributorId || row.distributorId === distributorId) &&
      inDateRange(row.receivedAt, dates),
  );
}

// Use the full filtered dataset, not the current table page or the supplier master list.
export function procurementSupplierOptions(rows: ProcurementRow[]) {
  return [
    ...new Map(
      rows.map((row) => [
        row.distributorId,
        {
          value: row.distributorId,
          label: row.distributorName,
        },
      ]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
}

function decimal(value: string | null) {
  if (value === null) return null;
  const result = new Decimal(value);
  return result.isFinite() && result.gte(0) ? result : null;
}

export function procurementAnalysisSummary(rows: ProcurementRow[]): ProcurementAnalysisSummary {
  let weight = new Decimal(0),
    amount = new Decimal(0),
    unknownWeight = 0,
    unknownAmount = 0;
  let pricedWeight = new Decimal(0),
    pricedAmount = new Decimal(0),
    priceCount = 0;
  let quotedWeight = new Decimal(0),
    quotedAmount = new Decimal(0),
    quoteCount = 0;
  let discountAmount = new Decimal(0),
    discountQuote = new Decimal(0);
  let latestDate: string | null = null,
    latestActualPrice: string | null = null,
    latestQuote: string | null = null;
  let latestId: string | null = null;
  const singleGroup = new Set(rows.map((row) => row.groupId)).size <= 1;
  for (const row of rows) {
    const grams = decimal(row.weight),
      paid = decimal(row.amount);
    const quote = row.quotePurpose === 'BEFORE_DISCOUNT' ? decimal(row.quote) : null;
    if (grams === null) unknownWeight++;
    else weight = weight.plus(grams);
    if (paid === null) unknownAmount++;
    else amount = amount.plus(paid);
    if (grams?.gt(0) && paid !== null) {
      pricedWeight = pricedWeight.plus(grams);
      pricedAmount = pricedAmount.plus(paid);
      priceCount++;
    }
    if (grams?.gt(0) && quote !== null) {
      quotedWeight = quotedWeight.plus(grams);
      quotedAmount = quotedAmount.plus(grams.mul(quote));
      quoteCount++;
      if (paid !== null && quote.gt(0)) {
        discountAmount = discountAmount.plus(paid);
        discountQuote = discountQuote.plus(grams.mul(quote));
      }
    }
    // The latest row may have missing prices; never substitute an older quote as its price.
    if (
      latestDate === null ||
      row.receivedAt > latestDate ||
      (row.receivedAt === latestDate && row.id > (latestId ?? ''))
    ) {
      latestDate = row.receivedAt;
      latestId = row.id;
      latestActualPrice = grams?.gt(0) && paid !== null ? paid.div(grams).toFixed(4) : null;
      latestQuote = quote?.toFixed(4) ?? null;
    }
  }
  return {
    count: rows.length,
    weight: rows.length > unknownWeight ? weight.toFixed(2) : null,
    amount: rows.length > unknownAmount ? amount.toFixed(2) : null,
    unknownWeight,
    unknownAmount,
    actualPrice:
      singleGroup && pricedWeight.gt(0) ? pricedAmount.div(pricedWeight).toFixed(4) : null,
    priceCount,
    quotePrice:
      singleGroup && quotedWeight.gt(0) ? quotedAmount.div(quotedWeight).toFixed(4) : null,
    quoteCount,
    discount:
      singleGroup && discountQuote.gt(0)
        ? discountAmount.div(discountQuote).mul(10).toFixed(2)
        : null,
    latestDate,
    latestActualPrice: singleGroup ? latestActualPrice : null,
    latestQuote: singleGroup ? latestQuote : null,
  };
}

export function analyzeProcurement(rows: ProcurementRow[], granularity: ProcurementGranularity) {
  function summarizeBy(keyOf: (row: ProcurementRow) => string) {
    const buckets = new Map<string, ProcurementRow[]>();
    for (const row of rows) {
      const key = keyOf(row);
      const bucket = buckets.get(key) ?? [];
      bucket.push(row);
      buckets.set(key, bucket);
    }
    return [...buckets].map(([key, entries]) => ({
      key,
      entries,
      ...procurementAnalysisSummary(entries),
    }));
  }
  const periods = summarizeBy((row) =>
    row.receivedAt.slice(0, granularity === 'day' ? 10 : granularity === 'month' ? 7 : 4),
  ).sort((a, b) => a.key.localeCompare(b.key));
  const suppliers = summarizeBy((row) => JSON.stringify([row.groupId, row.distributorId])).map(
    ({ entries, ...summary }) => ({
      ...summary,
      groupId: entries[0].groupId,
      groupName: entries[0].groupName,
      distributorId: entries[0].distributorId,
      name: entries[0].distributorName,
    }),
  );
  const supplierShares = summarizeBy((row) => row.distributorId).map(({ entries, ...summary }) => ({
    ...summary,
    name: entries[0].distributorName,
  }));
  const groupShares = summarizeBy((row) => row.groupId).map(({ entries, ...summary }) => ({
    ...summary,
    name: entries[0].groupName,
  }));
  return {
    totals: procurementAnalysisSummary(rows),
    periods: periods.map(({ entries: _entries, ...period }) => {
      void _entries;
      return period;
    }),
    suppliers,
    supplierShares,
    groupShares,
  };
}
