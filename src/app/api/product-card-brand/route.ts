import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { cardBrandSchema } from '@/lib/product-cards/contracts';
import { getBrand, saveBrand } from '@/lib/product-cards/service';
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await getBrand());
  } catch (error) {
    return apiError(error);
  }
}
export const PUT = withAuditRoute(async (request: NextRequest) => {
  try {
    await requireAdmin(request);
    const { brand, version } = z
      .strictObject({ brand: cardBrandSchema, version: z.number().int().nonnegative() })
      .parse(await request.json());
    return NextResponse.json(await saveBrand(brand, version));
  } catch (error) {
    return apiError(error);
  }
});
