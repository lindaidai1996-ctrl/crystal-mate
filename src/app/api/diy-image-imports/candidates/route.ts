import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { findAliasIds } from '@/lib/catalog-search';
import { materialInclude, serializeMaterial } from '@/lib/materials';
import { productInclude, serializeProduct } from '@/lib/products';

const schema = z.object({
  kind: z.enum(['MATERIAL', 'CABOCHON']),
  q: z.string().max(120).default(''),
  id: z.string().cuid().optional(),
});
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { kind, q, id } = schema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const aliasIds = id ? [] : await findAliasIds(kind === 'MATERIAL' ? 'material' : 'product', q);
    if (kind === 'MATERIAL') {
      const items = await db.material.findMany({
        where: id
          ? { id }
          : q
            ? {
                OR: [{ name: { contains: q, mode: 'insensitive' } }, { id: { in: aliasIds } }],
              }
            : {},
        include: materialInclude,
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      return NextResponse.json({ materials: items.map(serializeMaterial), cabochons: [] });
    }
    const items = await db.product.findMany({
      where: {
        category: { name: '蛋面' },
        ...(id
          ? { id }
          : q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { code: { contains: q, mode: 'insensitive' } },
                  { id: { in: aliasIds } },
                ],
              }
            : {}),
      },
      include: productInclude,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return NextResponse.json({ materials: [], cabochons: items.map(serializeProduct) });
  } catch (error) {
    return apiError(error);
  }
}
