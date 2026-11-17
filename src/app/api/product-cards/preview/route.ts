import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin, ApiError } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { cardSaveSchema } from '@/lib/product-cards/contracts';
import { getCard, prepareCard } from '@/lib/product-cards/service';
import { cardPng } from '@/lib/product-cards/png';
import { cardQuoteSchema } from '@/lib/product-cards/contracts';
export const runtime = 'nodejs';
export const POST = withAuditRoute(async (request: NextRequest) => {
  try {
    await requireAdmin(request);
    const { productId, cardId, input } = z
      .strictObject({
        productId: z.string().min(1).max(100),
        cardId: z.string().min(1).max(100).optional(),
        input: cardSaveSchema,
      })
      .parse(await request.json());
    const current = cardId ? await getCard(cardId) : undefined;
    if (current && current.productId !== productId) throw new ApiError(400, 'CARD_INVALID_SOURCE');
    const prepared = await prepareCard(productId, input, current);
    const quote =
      prepared.data.quoteSnapshot === null ||
      typeof prepared.data.quoteSnapshot !== 'object' ||
      !('rows' in prepared.data.quoteSnapshot)
        ? null
        : cardQuoteSchema.parse(prepared.data.quoteSnapshot);
    const bytes = await cardPng(prepared.fields, quote);
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
});
