import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { productSourceWriteSchema } from '@/lib/product-source-write';
import { addProductSource, serializeProductSources } from '@/lib/product-sources';

type Context = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const { source, pricing } = productSourceWriteSchema.parse(await request.json());
    const product = await addProductSource((await params).id, source, pricing);
    return NextResponse.json(
      {
        stock: product.stock,
        priceCents: product.priceCents,
        saleManual: product.saleManual,
        saleRule: product.saleRule,
        saleRuleValue: product.saleRuleValue?.toFixed(2) ?? null,
        updatedAt: product.updatedAt,
        ...serializeProductSources(product),
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withAuditRoute(handlePOST);
