import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { schemeInputSchema } from '@/lib/price-schemes/contracts';
import { calculation, storedContext, schemeContextSelect } from '@/lib/price-schemes/store';
const inputSchema = z.strictObject({ input: schemeInputSchema, productId: z.string().cuid() });
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { input, productId } = inputSchema.parse(await request.json());
    const product = await db.product.findUniqueOrThrow({
      where: { id: productId },
      select: schemeContextSelect,
    });
    const context = storedContext(product);
    return NextResponse.json({ context, ...calculation(input, context) });
  } catch (error) {
    return apiError(error);
  }
}
