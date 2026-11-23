import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
const inputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  categoryId: z.string().cuid(),
  groupId: z.string().cuid(),
});
export const POST = withAuditRoute(async (request: NextRequest) => {
  try {
    await requireAdmin(request);
    const input = inputSchema.parse(await request.json());
    const material = await db.$transaction(
      async (tx) => {
        if (
          !(await tx.materialCategory.findUnique({ where: { id: input.categoryId } })) ||
          !(await tx.materialPricingGroup.findUnique({ where: { id: input.groupId } }))
        )
          throw new ApiError(400, 'NOT_FOUND');
        const material = await tx.material.create({
          data: {
            name: input.name,
            categoryId: input.categoryId,
            pricingGroupId: input.groupId,
            unit: 'GRAM',
          },
          select: { id: true, name: true },
        });
        await tx.materialPricingGroup.update({
          where: { id: input.groupId },
          data: { version: { increment: 1 } },
        });
        return material;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json(material, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
});
