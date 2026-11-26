import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { productSourceWriteSchema } from '@/lib/product-source-write';
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
    const { source, pricing } = productSourceWriteSchema.parse(await request.json());
    const product = await updateProductSource(id, sourceId, source, pricing);
    return NextResponse.json({
      stock: product.stock,
      priceCents: product.priceCents,
      saleManual: product.saleManual,
      saleRule: product.saleRule,
      saleRuleValue: product.saleRuleValue?.toFixed(2) ?? null,
      updatedAt: product.updatedAt,
      ...serializeProductSources(product),
    });
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
