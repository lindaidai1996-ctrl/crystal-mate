import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { productSourceSchema } from '@/lib/validation';
import {
  deleteProductSource,
  serializeProductSources,
  updateProductSource,
} from '@/lib/product-sources';

type Context = { params: Promise<{ id: string; sourceId: string }> };

async function handlePUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const { id, sourceId } = await params;
    const input = productSourceSchema.parse(await request.json());
    const product = await updateProductSource(id, sourceId, input);
    return NextResponse.json({ stock: product.stock, ...serializeProductSources(product) });
  } catch (error) {
    return apiError(error);
  }
}

async function handleDELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const { id, sourceId } = await params;
    const product = await deleteProductSource(id, sourceId);
    return NextResponse.json({ stock: product.stock, ...serializeProductSources(product) });
  } catch (error) {
    return apiError(error);
  }
}

export const PUT = withAuditRoute(handlePUT);
export const DELETE = withAuditRoute(handleDELETE);
