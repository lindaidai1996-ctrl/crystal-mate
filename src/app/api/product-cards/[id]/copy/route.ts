import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { db } from '@/lib/db';
import { cardProduct, getCard, viewCard } from '@/lib/product-cards/service';
export const POST = withAuditRoute(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      await requireAdmin(request);
      const { version } = z
        .strictObject({ version: z.number().int().positive() })
        .parse(await request.json());
      const original = await getCard((await params).id);
      if (version !== original.version) throw new ApiError(409, 'CARD_CONFLICT');
      const fields = viewCard(original);
      const title = `${fields.title.slice(0, 75)} · 副本`;
      const card = await db.productCard.create({
        data: {
          productId: original.productId,
          runId: original.runId,
          title,
          templateId: original.templateId,
          templateVersion: original.templateVersion,
          data: { ...(original.data as object), title } as Prisma.InputJsonValue,
          sourceSnapshot: original.sourceSnapshot as Prisma.InputJsonValue,
          quoteSnapshot:
            original.quoteSnapshot === null
              ? Prisma.DbNull
              : (original.quoteSnapshot as Prisma.InputJsonValue),
        },
      });
      return NextResponse.json(viewCard(card, await cardProduct(card.productId)), { status: 201 });
    } catch (error) {
      return apiError(error);
    }
  },
);
