import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin, ApiError } from '@/lib/api';
import { cardCopySchema, generateCardCopy } from '@/lib/product-cards/copy';
const ongoing = new Set<string>();
const recent = new Map<string, number>();
export async function POST(request: NextRequest) {
  let account: string | undefined;
  try {
    const session = await requireAdmin(request);
    account = session.user.id;
    if (!account || ongoing.has(account) || Date.now() - (recent.get(account) ?? 0) < 3000)
      throw new ApiError(429, 'CARD_MODEL_RATE_LIMIT');
    const input = cardCopySchema.parse(await request.json());
    ongoing.add(account);
    recent.set(account, Date.now());
    if (recent.size > 1000)
      for (const [id, time] of recent) if (Date.now() - time > 60_000) recent.delete(id);
    try {
      return NextResponse.json(await generateCardCopy(input, request.signal));
    } finally {
      ongoing.delete(account);
    }
  } catch (error) {
    return apiError(error);
  }
}
