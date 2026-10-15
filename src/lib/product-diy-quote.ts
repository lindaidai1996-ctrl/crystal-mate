import type { ProductDiyRun, MaterialBatchEntry, MaterialUnit } from './client-types';
import { craftDesignFeeTotal } from './product-diy-cost';

export function suggestedMaterialQuote(
  option: {
    entry: Pick<MaterialBatchEntry, 'saleUnitPrice' | 'saleGramPrice' | 'saleChildUnitPrice'>;
    material: { unit: MaterialUnit };
  },
  unit: 'STRAND' | 'BEAD' | 'GRAM',
) {
  if (unit === 'GRAM') return option.entry.saleGramPrice;
  if (unit === 'STRAND' || option.material.unit === 'BEAD') return option.entry.saleUnitPrice;
  return option.entry.saleChildUnitPrice;
}

// This is the customer-facing projection for future detail exports.
// Enumerate fields explicitly so internal costs, procurement and notes stay private.
export function customerDiyDetails(run: ProductDiyRun) {
  if (run.totalQuote === null || run.perUnitQuote === null) return null;
  if (
    [...run.materialLines, ...run.cabochonLines].some(
      (line) => !line.quoteSnapshot || line.quoteUnitPrice === null || line.quoteLineTotal === null,
    ) ||
    run.extraCosts.some((line) => line.quoteAmount == null)
  )
    return null;
  return {
    quantity: run.quantity,
    perUnitQuote: run.perUnitQuote,
    totalQuote: run.totalQuote,
    materials: run.materialLines.map((line) => ({
      name: line.quoteSnapshot!.name,
      lengthMm: line.quoteSnapshot!.lengthMm,
      widthMm: line.quoteSnapshot!.widthMm,
      heightMm: line.quoteSnapshot!.heightMm,
      unit: line.usageUnit,
      quantityPerItem: line.quantity,
      unitPrice: line.quoteUnitPrice,
      subtotalPerItem: line.quoteLineTotal,
    })),
    cabochons: run.cabochonLines.map((line) => ({
      name: line.quoteSnapshot!.name,
      code: line.quoteSnapshot!.code,
      lengthMm: line.quoteSnapshot!.lengthMm,
      widthMm: line.quoteSnapshot!.widthMm,
      heightMm: line.quoteSnapshot!.heightMm,
      quantityPerItem: line.quantity,
      unitPrice: line.quoteUnitPrice,
      subtotalPerItem: line.quoteLineTotal,
    })),
    extraFees: run.extraCosts.map((line) => ({ name: line.name, amountPerItem: line.quoteAmount })),
    craftDesignFee: craftDesignFeeTotal(run.craftDesignFee, run.quantity),
  };
}
