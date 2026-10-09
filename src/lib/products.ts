import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
import { productSchema } from '@/lib/validation';
import { z } from 'zod';

type ProductInput = z.infer<typeof productSchema>;

export async function saveProduct(input: ProductInput, id?: string) {
  return db.$transaction(
    async (tx) => {
      const category = await tx.category.findUnique({
        where: { id: input.categoryId },
        select: { id: true },
      });
      if (!category) throw new ApiError(400, 'CATEGORY_NOT_FOUND');
      const current = id
        ? await tx.product.findUnique({ where: { id }, include: { images: true } })
        : null;
      if (id && !current) throw new ApiError(404, 'NOT_FOUND');

      const oldImages = new Map(current?.images.map((image) => [image.objectKey, image]) ?? []);
      const newKeys = input.imageKeys.filter((key) => !oldImages.has(key));
      const grants = await tx.uploadGrant.findMany({
        where: {
          objectKey: { in: newKeys },
          uploadedAt: { not: null },
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (grants.length !== newKeys.length) throw new ApiError(400, 'INVALID_IMAGE');
      const grantByKey = new Map(grants.map((grant) => [grant.objectKey, grant]));

      const data = {
        code: input.code,
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        priceCents: input.priceCents,
        currency: input.currency,
        stock: input.stock,
        published: input.published,
      };
      const product = id
        ? await tx.product.update({ where: { id }, data })
        : await tx.product.create({ data });
      if (id) await tx.productImage.deleteMany({ where: { productId: id } });
      if (input.imageKeys.length) {
        await tx.productImage.createMany({
          data: input.imageKeys.map((key, position) => ({
            productId: product.id,
            objectKey: key,
            url: oldImages.get(key)?.url ?? grantByKey.get(key)!.url,
            position,
          })),
        });
      }
      if (newKeys.length)
        await tx.uploadGrant.updateMany({
          where: { objectKey: { in: newKeys } },
          data: { usedAt: new Date() },
        });
      return tx.product.findUniqueOrThrow({
        where: { id: product.id },
        include: { category: true, images: { orderBy: { position: 'asc' } } },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
