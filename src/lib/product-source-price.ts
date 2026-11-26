import type { Prisma } from '@prisma/client';
import { ApiError } from './api';
import { sourcePriceChangeSchema, type SourcePriceChange } from './product-source-write';
import { amountToCents } from './cabochon-cost';
import { calculateProductPrice } from './product-pricing';

export async function applySourcePrice(
  tx: Prisma.TransactionClient,
  productId: string,
  origin: 'DIY' | 'PURCHASED',
  change?: SourcePriceChange,
  sourceId?: string,
) {
  if (!change) return;
  if (origin !== 'DIY') throw new ApiError(400, 'INVALID_INPUT');
  const parsed = sourcePriceChangeSchema.parse(change);
  const { expectedPriceCents } = parsed;
  let priceCents = parsed.priceCents;
  const rules = 'saleRule' in parsed ? parsed : undefined;
  if (rules && !rules.saleManual) {
    if (!sourceId) throw new ApiError(400, 'INVALID_INPUT');
    const run = await tx.productDiyRun.findUnique({
      where: { id: sourceId },
      select: { productId: true, perUnitCost: true },
    });
    if (!run || run.productId !== productId) throw new ApiError(404, 'NOT_FOUND');
    const price = calculateProductPrice(
      run.perUnitCost.toFixed(2),
      rules.saleRule,
      rules.saleRuleValue,
    );
    if (price === null) throw new ApiError(400, 'INVALID_INPUT');
    priceCents = Number(amountToCents(price)!);
  }
  const updated = await tx.product.updateMany({
    where: { id: productId, priceCents: expectedPriceCents, ...rules?.expectedPricing },
    data: {
      priceCents,
      saleManual: rules?.saleManual ?? true,
      ...(rules ? { saleRule: rules.saleRule, saleRuleValue: rules.saleRuleValue } : {}),
    },
  });
  if (!updated.count) throw new ApiError(409, 'PRODUCT_PRICE_CHANGED');
}
