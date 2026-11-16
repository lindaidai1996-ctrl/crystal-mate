import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { productStockAdjustmentSchema } from '@/lib/validation';
import { adjustProductStock, serializeProductSources } from '@/lib/product-sources';

type Context = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const input = productStockAdjustmentSchema.parse(await request.json());
    const product = await adjustProductStock((await params).id, input);
    return NextResponse.json(
      { stock: product.stock, ...serializeProductSources(product) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withAuditRoute(handlePOST);
