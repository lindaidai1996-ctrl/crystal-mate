import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { productSourceSchema } from '@/lib/validation';
import { correctProductOrigin, serializeProductSources } from '@/lib/product-sources';

type Context = { params: Promise<{ id: string }> };

async function handlePUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const input = productSourceSchema.parse(await request.json());
    const product = await correctProductOrigin((await params).id, input);
    return NextResponse.json({ stock: product.stock, ...serializeProductSources(product) });
  } catch (error) {
    return apiError(error);
  }
}

export const PUT = withAuditRoute(handlePUT);
