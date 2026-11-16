import { Prisma } from '@prisma/client';
import {
  purchaseEntrySchema,
  purchaseSummarySchema,
  type PurchaseEntry,
  type PurchaseTotals,
  type PurchaseSummary,
} from './purchase-contracts';

// DB Decimal(12,2) multiplied by an Int and then summed over 5000 rows
// can exceed decimal.js's default 20 significant digits. Do not mutate its global config.
export const PurchaseDecimal = Prisma.Decimal.clone({ precision: 50 });
export function exactPurchaseDecimal(value: Prisma.Decimal | string | number) {
  const decimal = new PurchaseDecimal(value.toString());
  return decimal.toFixed(Math.max(2, decimal.decimalPlaces()));
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const purchaseIdentity = (ref: PurchaseEntry['purchase']) => `${ref.type}:${ref.id}`;

function totals(rows: PurchaseEntry[]): PurchaseTotals {
  const amounts = new Map<
    string | null,
    { amount: InstanceType<typeof PurchaseDecimal>; unknown: number; defaults: number }
  >();
  const quantities = new Map<
    PurchaseEntry['unit'],
    { quantity: InstanceType<typeof PurchaseDecimal>; unknown: number }
  >();
  for (const row of rows) {
    const money = amounts.get(row.currency) ?? {
      amount: new PurchaseDecimal(0),
      unknown: 0,
      defaults: 0,
    };
    if (row.amount === null) money.unknown++;
    else money.amount = money.amount.add(row.amount);
    if (row.currencyBasis === 'business_default') money.defaults++;
    amounts.set(row.currency, money);
    const quantity = quantities.get(row.unit) ?? { quantity: new PurchaseDecimal(0), unknown: 0 };
    if (row.quantity === null) quantity.unknown++;
    else quantity.quantity = quantity.quantity.add(row.quantity);
    quantities.set(row.unit, quantity);
  }
  return {
    purchaseEntryCount: rows.length,
    catalogItemCount: new Set(rows.map((r) => `${r.item.type}:${r.item.id}`)).size,
    amounts: [...amounts]
      .sort(([a], [b]) => compare(a ?? '', b ?? ''))
      .map(([currency, value]) => ({
        currency,
        knownAmount: exactPurchaseDecimal(value.amount),
        unknownAmountEntryCount: value.unknown,
        businessDefaultCurrencyEntryCount: value.defaults,
      })),
    quantities: [...quantities]
      .sort(([a], [b]) => compare(a, b))
      .map(([unit, value]) => ({
        unit,
        knownQuantity: exactPurchaseDecimal(value.quantity),
        unknownQuantityEntryCount: value.unknown,
      })),
  };
}
export function summarizeAssistantPurchases(
  input: PurchaseEntry[],
  scopeCandidateCount: number,
  basis: PurchaseSummary['basis'],
): PurchaseSummary {
  const rows = input.map((r) => purchaseEntrySchema.parse(r));
  if (new Set(rows.map((r) => purchaseIdentity(r.purchase))).size !== rows.length)
    throw new Error('DUPLICATE_PURCHASE');
  if (scopeCandidateCount < rows.length) throw new Error('INVALID_SCOPE_COUNT');
  const distributors = new Map<string, PurchaseEntry[]>();
  const catalog = new Map<string, PurchaseEntry[]>();
  for (const row of rows) {
    const distributorRows = distributors.get(row.distributor.id) ?? [];
    distributorRows.push(row);
    distributors.set(row.distributor.id, distributorRows);
    const key = `${row.item.type}:${row.item.id}`;
    const catalogRows = catalog.get(key) ?? [];
    catalogRows.push(row);
    catalog.set(key, catalogRows);
  }
  return purchaseSummarySchema.parse({
    basis,
    scopeCandidateCount,
    totals: totals(rows),
    byDistributor: [...distributors]
      .sort(([a], [b]) => compare(a, b))
      .map(([, group]) => ({ distributor: group[0].distributor, totals: totals(group) })),
    byCatalog: [...catalog]
      .sort(([a], [b]) => compare(a, b))
      .map(([, group]) => ({ item: group[0].item, name: group[0].name, totals: totals(group) })),
  });
}
