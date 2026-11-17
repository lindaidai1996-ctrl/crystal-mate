import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { db } from '@/lib/db';
import { cardSaveSchema } from '@/lib/product-cards/contracts';
import { cardProduct, getCard, saveCard, viewCard } from '@/lib/product-cards/service';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const card = await getCard((await params).id);
    return NextResponse.json(viewCard(card, await cardProduct(card.productId)));
  } catch (error) {
    return apiError(error);
  }
}
export const PUT = withAuditRoute(async (request: NextRequest, { params }: Context) => {
  try {
    await requireAdmin(request);
    const current = await getCard((await params).id);
    const card = await saveCard(
      current.productId,
      cardSaveSchema.parse(await request.json()),
      current,
    );
    return NextResponse.json(viewCard(card, await cardProduct(card.productId)));
  } catch (error) {
    return apiError(error);
  }
});
export const DELETE = withAuditRoute(async (request: NextRequest, { params }: Context) => {
  try {
    await requireAdmin(request);
    const { version } = z
      .strictObject({ version: z.number().int().positive() })
      .parse(await request.json());
    const result = await db.productCard.deleteMany({ where: { id: (await params).id, version } });
    if (!result.count) throw new ApiError(409, 'CARD_CONFLICT');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
});
