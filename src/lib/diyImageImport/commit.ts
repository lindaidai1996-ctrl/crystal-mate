import { ApiError } from '@/lib/api';
import { withProductTransaction } from '@/lib/product-code-store';
import { saveProductInTransaction } from '@/lib/products';
import { createSource } from '@/lib/product-sources';
import { productSchema } from '@/lib/validation';
import { diySource } from './contracts';
import { lockDiyDraft, serializeDiyImport } from './store';

export async function commitDiyImport(id: string, version: number) {
  return withProductTransaction(async (tx) => {
    const previous = await tx.diyImageImport.findUnique({ where: { id } });
    if (!previous) throw new ApiError(404, 'NOT_FOUND');
    // A successful receipt is stable across repeated clicks and a lost HTTP response.
    if (previous.status === 'COMMITTED') return serializeDiyImport(previous);
    const current = serializeDiyImport(await lockDiyDraft(tx, id, version));
    const data = current.data;
    const source = diySource(data);
    if (!source) throw new ApiError(400, 'DIY_INCOMPLETE');
    for (const part of data.parts.filter((part) => !part.excluded && part.kind === 'MATERIAL')) {
      const batch = await tx.materialBatchEntry.findUnique({
        where: { id: part.materialBatchEntryId! },
        select: { materialId: true, material: { select: { unit: true } } },
      });
      if (!batch || batch.materialId !== part.materialId)
        throw new ApiError(400, 'MATERIAL_ENTRY_NOT_FOUND');
      const allowed =
        batch.material.unit === 'STRAND' ? ['STRAND', 'BEAD', 'GRAM'] : [batch.material.unit];
      if (!allowed.includes(part.usageUnit)) throw new ApiError(400, 'INVALID_INPUT');
    }
    let productId: string;
    let runId: string;
    if (data.targetProductId) {
      productId = data.targetProductId;
      runId = await createSource(tx, productId, source);
    } else {
      if (!data.salePrice) throw new ApiError(400, 'DIY_INCOMPLETE');
      const product = await saveProductInTransaction(
        tx,
        productSchema.parse({
          code: data.code,
          codeReservationToken: data.codeReservationToken,
          name: data.name,
          categoryId: data.categoryId,
          description: data.notes,
          priceCents: Math.round(Number(data.salePrice) * 100),
          currency: 'CNY',
          stock: 0,
          published: false,
          imageKeys: current.images.map((image) => image.objectKey),
          source,
          saleRule: 'COST',
          saleRuleValue: null,
          saleManual: true,
        }),
        undefined,
        new Map(current.images.map((image) => [image.objectKey, image.url])),
      );
      productId = product.id;
      runId = product.diyRuns[0].id;
    }
    return serializeDiyImport(
      await tx.diyImageImport.update({
        where: { id },
        data: {
          status: 'COMMITTED',
          productId,
          runId,
          runToken: null,
          leaseUntil: null,
        },
      }),
    );
  });
}
