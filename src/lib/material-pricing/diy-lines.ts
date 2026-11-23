import { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/api';
import { diyQuoteLineTotal } from '@/lib/product-diy-cost';
import { readCostBasis } from './basis';
import type { PricingCostBasis, PricingLineInput } from './contracts';

export async function resolvePricingLines(
  tx: Prisma.TransactionClient,
  lines: PricingLineInput[],
  previous: Prisma.ProductDiyPricingLineGetPayload<object>[] = [],
) {
  const ids = lines.flatMap((line) => (line.id ? [line.id] : []));
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'INVALID_INPUT');
  return Promise.all(
    lines.map(async (line, position) => {
      const old = line.id ? previous.find((row) => row.id === line.id) : undefined;
      const retained =
        old &&
        old.groupId === line.groupId &&
        old.publicationId === line.publicationId &&
        old.costBasisToken === line.costBasisToken;
      const basis = retained
        ? (old.costSnapshot as unknown as PricingCostBasis)
        : readCostBasis(line.costBasisToken);
      if (!basis || basis.groupId !== line.groupId || basis.publicationId !== line.publicationId)
        throw new ApiError(400, 'PRICING_INVALID_BASIS');
      if (!retained) {
        const publication = await tx.materialPricingPublication.findUnique({
          where: { id: line.publicationId },
          select: { groupId: true, group: { select: { enabled: true } } },
        });
        if (!publication || publication.groupId !== line.groupId || !publication.group.enabled)
          throw new ApiError(400, 'PRICING_GROUP_DISABLED');
      }
      return {
        ...(old ? { id: old.id } : {}),
        groupId: line.groupId,
        publicationId: line.publicationId,
        name: basis.name,
        quantity: line.quantity,
        unitCost: line.unitCost,
        lineCost: diyQuoteLineTotal(line.quantity, line.unitCost)!,
        quoteUnitPrice: line.quoteUnitPrice,
        quoteLineTotal: diyQuoteLineTotal(line.quantity, line.quoteUnitPrice)!,
        costSnapshot: basis as unknown as Prisma.InputJsonObject,
        costBasisToken: line.costBasisToken,
        position,
      };
    }),
  );
}
