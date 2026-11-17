import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { db } from '@/lib/db';
import { cardSaveSchema } from '@/lib/product-cards/contracts';
import {
  cardProduct,
  getBrand,
  saveCard,
  sourceForCard,
  viewCard,
} from '@/lib/product-cards/service';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const product = await cardProduct((await params).id);
    const [cards, defaults] = await Promise.all([
      db.productCard.findMany({ where: { productId: product.id }, orderBy: { updatedAt: 'desc' } }),
      getBrand(),
    ]);
    return NextResponse.json({
      items: cards.map((card) => viewCard(card, product)),
      sources: product.diyRuns.map((run) => ({
        runId: run.id,
        createdAt: run.createdAt,
        quantity: run.quantity,
      })),
      source: sourceForCard(
        product,
        request.nextUrl.searchParams.get('runId') ?? product.diyRuns[0]?.id ?? null,
      ),
      brand: defaults.brand,
      brandVersion: defaults.version,
    });
  } catch (error) {
    return apiError(error);
  }
}
export const POST = withAuditRoute(async (request: NextRequest, { params }: Context) => {
  try {
    await requireAdmin(request);
    const card = await saveCard((await params).id, cardSaveSchema.parse(await request.json()));
    return NextResponse.json(viewCard(card, await cardProduct(card.productId)), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
});
