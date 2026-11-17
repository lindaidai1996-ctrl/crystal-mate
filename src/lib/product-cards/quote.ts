import type { ProductDiyRun } from '@/lib/client-types';
import { customerDiyDetails } from '@/lib/product-diy-quote';
import { runAmountToCents } from '@/lib/product-diy-cost';
import { centsToAmount } from '@/lib/cabochon-cost';
import { cardQuoteSchema, type CardQuote } from './contracts';

const units = { STRAND: '串', BEAD: '颗', GRAM: '克' };
function dimensions(line: {
  lengthMm: string | null;
  widthMm: string | null;
  heightMm: string | null;
}) {
  const values = [line.lengthMm, line.widthMm, line.heightMm];
  return values.some((value) => value !== null)
    ? `${values.map((value) => value ?? '—').join(' × ')} mm`
    : '';
}
export function cardMainMaterials(run: ProductDiyRun) {
  return [
    ...new Set([
      ...run.materialLines.map(
        (line) => line.quoteSnapshot?.name ?? line.materialBatchEntry.material.name,
      ),
      ...run.cabochonLines.map((line) => line.quoteSnapshot?.name ?? line.product.name),
      ...(Number(run.silverCost?.weightGrams) > 0 ? ['银料'] : []),
    ]),
  ].slice(0, 12);
}
// A new, explicit export DTO. Never spread source records into customer output.
export function cardQuote(run: ProductDiyRun, currency = 'CNY'): CardQuote | null {
  const details = customerDiyDetails(run);
  if (
    !details ||
    !details.craftDesignFee ||
    !Number.isInteger(details.quantity) ||
    details.quantity < 1
  )
    return null;
  const rows: CardQuote['rows'] = [
    ...details.materials.map((line) => ({
      name: line.name,
      specification: dimensions(line),
      quantity: `${line.quantityPerItem} ${units[line.unit]}`,
      unitPrice: line.unitPrice,
      subtotal: line.subtotalPerItem!,
    })),
    ...details.cabochons.map((line) => ({
      name: line.name,
      specification: dimensions(line),
      quantity: `${line.quantityPerItem} 件`,
      unitPrice: line.unitPrice,
      subtotal: line.subtotalPerItem!,
    })),
  ];
  if (details.silver && Number(details.silver.weightGrams) > 0) {
    if (details.silver.subtotalPerItem === null) return null;
    rows.push({
      name: '银料',
      specification: '按克计价',
      quantity: `${details.silver.weightGrams} 克`,
      unitPrice: details.silver.quoteGramPrice,
      subtotal: details.silver.subtotalPerItem,
    });
  }
  for (const fee of details.extraFees) {
    if (fee.amountPerItem == null) return null;
    rows.push({
      name: fee.name,
      specification: '',
      quantity: '1 项',
      unitPrice: fee.amountPerItem,
      subtotal: fee.amountPerItem,
    });
  }
  const cents = runAmountToCents(details.craftDesignFee);
  if (cents === null) return null;
  const quantity = BigInt(details.quantity);
  const allocated = centsToAmount((cents * BigInt(2) + quantity) / (quantity * BigInt(2)));
  rows.push({
    name: '手工设计费',
    specification: details.quantity > 1 ? '整批费用按制作数量分摊' : '',
    quantity: '1 件',
    unitPrice: allocated,
    subtotal: allocated,
  });
  // Existing perUnitQuote uses the same half-up rounding. Reject inconsistent legacy snapshots.
  let sum = BigInt(0);
  for (const row of rows) {
    const value = runAmountToCents(row.subtotal ?? '');
    if (value === null) return null;
    row.subtotal = centsToAmount(value);
    if (row.unitPrice !== null) {
      const price = runAmountToCents(row.unitPrice);
      if (price === null) return null;
      row.unitPrice = centsToAmount(price);
    }
    sum += value;
  }
  if (sum !== runAmountToCents(details.perUnitQuote)) return null;
  const parsed = cardQuoteSchema.safeParse({
    currency,
    rows,
    total: centsToAmount(sum),
    craftAllocated: details.quantity > 1,
  });
  return parsed.success ? parsed.data : null;
}
