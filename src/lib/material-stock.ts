import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { validMaterialQuantity } from '@/lib/inventory';
import { stockTransaction } from '@/lib/stock-transaction';
import { entryInclude, serializeEntry } from '@/lib/materials';
import { materialStockCountSchema } from '@/lib/validation';

export async function adjustMaterialStock(
  materialId: string,
  entryId: string,
  input: z.infer<typeof materialStockCountSchema>,
) {
  return stockTransaction(async (tx) => {
    const current = await tx.materialBatchEntry.findUnique({
      where: { id: entryId },
      include: { material: { select: { unit: true } } },
    });
    if (!current || current.materialId !== materialId) throw new ApiError(404, 'NOT_FOUND');
    if (
      !validMaterialQuantity(input.quantity, current.material.unit) ||
      (input.expectedQuantity !== null &&
        !validMaterialQuantity(input.expectedQuantity, current.material.unit))
    )
      throw new ApiError(400, 'INVALID_INPUT');
    if ((current.remainingQty?.toNumber() ?? null) !== input.expectedQuantity)
      throw new ApiError(409, 'STOCK_CHANGED');
    const updated = await tx.materialBatchEntry.updateMany({
      where: { id: entryId, materialId, remainingQty: input.expectedQuantity },
      data: { remainingQty: input.quantity },
    });
    if (!updated.count) throw new ApiError(409, 'STOCK_CHANGED');
    await tx.materialStockAdjustment.create({
      data: {
        entryId,
        beforeQty: current.remainingQty,
        afterQty: input.quantity,
        delta:
          current.remainingQty === null
            ? null
            : new Prisma.Decimal(input.quantity).minus(current.remainingQty),
        reason: input.reason.trim() || '手动盘点',
      },
    });
    await tx.material.update({ where: { id: materialId }, data: { updatedAt: new Date() } });
    return serializeEntry(
      await tx.materialBatchEntry.findUniqueOrThrow({
        where: { id: entryId },
        include: entryInclude,
      }),
    );
  });
}
