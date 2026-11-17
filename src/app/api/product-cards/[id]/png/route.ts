import { NextRequest } from 'next/server';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { getCard, viewCard } from '@/lib/product-cards/service';
import { cardPng } from '@/lib/product-cards/png';
export const runtime = 'nodejs';
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const card = viewCard(await getCard((await params).id));
    if (!card.mainMaterials.length || !card.philosophy.trim())
      throw new ApiError(400, 'CARD_CONTENT_INCOMPLETE');
    const bytes = await cardPng(card, card.quote, card.templateVersion);
    const download = request.nextUrl.searchParams.get('download') === '1';
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="product-card.png"; filename*=UTF-8''${encodeURIComponent(card.title + '.png')}`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
