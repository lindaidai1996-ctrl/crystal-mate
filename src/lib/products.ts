import { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/api';
import { productSchema } from '@/lib/validation';
import { z } from 'zod';
import { calculateCostTotal, normalizeCostAmount } from '@/lib/cabochon-cost';
import type { OtherCost } from '@/lib/cabochon-cost';
import {
  applyProductStockAdjustment,
  createSource,
  productSourceInclude,
  serializeProductSources,
} from '@/lib/product-sources';
import { calculateProductPrice, productPricingCost } from '@/lib/product-pricing';
import { amountToCents } from '@/lib/cabochon-cost';
import {
  claimProductCode,
  validateProductCode,
  withProductTransaction,
} from '@/lib/product-code-store';

type ProductInput = z.infer<typeof productSchema>;

export const productInclude = {
  category: true,
  images: { orderBy: { position: 'asc' } },
  tags: { include: { tag: true } },
  marketing: true,
  measurement: true,
  cost: true,
  ...productSourceInclude,
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export function serializeProduct(product: ProductWithRelations) {
  return {
    ...product,
    saleRuleValue: product.saleRuleValue?.toFixed(2) ?? null,
    tags: product.tags.map(({ tag }) => tag).sort((a, b) => a.name.localeCompare(b.name)),
    marketing: {
      videoShot: product.marketing?.videoShot ?? false,
      xiaohongshuVideoPublished: product.marketing?.xiaohongshuVideoPublished ?? false,
      xiaohongshuListed: product.marketing?.xiaohongshuListed ?? false,
      douyinVideoPublished: product.marketing?.douyinVideoPublished ?? false,
      douyinListed: product.marketing?.douyinListed ?? false,
    },
    measurement: product.measurement
      ? {
          lengthMm: product.measurement.lengthMm?.toNumber() ?? null,
          widthMm: product.measurement.widthMm?.toNumber() ?? null,
          heightMm: product.measurement.heightMm?.toNumber() ?? null,
        }
      : null,
    cost: product.cost
      ? {
          roughStoneCost: product.cost.roughStoneCost?.toFixed(2) ?? null,
          settingCost: product.cost.settingCost?.toFixed(2) ?? null,
          otherCosts: (product.cost.otherCosts as OtherCost[]).map((item) => ({
            name: item.name,
            amount: normalizeCostAmount(item.amount)!,
          })),
          totalCost: product.cost.totalCost.toFixed(2),
          totalManual: product.cost.totalManual,
        }
      : null,
    ...serializeProductSources(product),
  };
}

export async function saveProduct(input: ProductInput, id?: string) {
  return withProductTransaction(async (tx) => {
    const category = await tx.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true, name: true, prefix: true },
    });
    if (!category) throw new ApiError(400, 'CATEGORY_NOT_FOUND');
    if (category.name !== '蛋面' && input.measurement != null)
      throw new ApiError(400, 'INVALID_INPUT');
    if (category.name !== '蛋面' && input.cost != null) throw new ApiError(400, 'INVALID_INPUT');
    const current = id
      ? await tx.product.findUnique({ where: { id }, include: { images: true } })
      : null;
    if (id && !current) throw new ApiError(404, 'NOT_FOUND');
    if (!id && !input.source) throw new ApiError(400, 'PRODUCT_SOURCE_REQUIRED');
    if (id && input.source) throw new ApiError(400, 'INVALID_INPUT');
    if (input.stockAdjustment) {
      if (!current) throw new ApiError(400, 'INVALID_INPUT');
      if (current.stock !== input.stockAdjustment.expectedQuantity)
        throw new ApiError(409, 'STOCK_CHANGED');
      if (input.stock !== current.stock)
        await applyProductStockAdjustment(tx, current.id, {
          ...input.stockAdjustment,
          quantity: input.stock,
        });
    }
    await validateProductCode(tx, input, category.prefix, current);
    if (input.tagIds) {
      const tags = await tx.tag.findMany({
        where: { id: { in: input.tagIds } },
        select: { id: true },
      });
      if (tags.length !== input.tagIds.length) throw new ApiError(400, 'TAG_NOT_FOUND');
    }

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
      saleRule: input.saleRule ?? 'PERCENT_50',
      saleRuleValue: input.saleRuleValue ?? null,
      saleManual: input.saleManual ?? true,
      currency: input.currency,
      ...(id ? {} : { stock: 0 }),
      published: input.published,
    };
    const product = id
      ? await tx.product.update({ where: { id }, data })
      : await tx.product.create({ data });
    await claimProductCode(tx, input, product.id, current);
    if (input.marketing || !id) {
      await tx.productMarketing.upsert({
        where: { productId: product.id },
        create: { productId: product.id, ...input.marketing },
        update: input.marketing ?? {},
      });
    }
    if (category.name !== '蛋面' || input.measurement === null) {
      await tx.cabochonMeasurement.deleteMany({ where: { productId: product.id } });
    } else if (input.measurement !== undefined) {
      const measurement = {
        lengthMm: input.measurement.lengthMm ?? null,
        widthMm: input.measurement.widthMm ?? null,
        heightMm: input.measurement.heightMm ?? null,
      };
      if (Object.values(measurement).every((value) => value === null)) {
        await tx.cabochonMeasurement.deleteMany({ where: { productId: product.id } });
      } else {
        await tx.cabochonMeasurement.upsert({
          where: { productId: product.id },
          create: { productId: product.id, ...measurement },
          update: measurement,
        });
      }
    }
    if (category.name !== '蛋面' || input.cost === null) {
      await tx.cabochonCost.deleteMany({ where: { productId: product.id } });
    } else if (input.cost !== undefined) {
      const totalCost = input.cost.totalManual
        ? input.cost.totalCost
        : calculateCostTotal(input.cost);
      if (totalCost === null) throw new ApiError(400, 'INVALID_INPUT');
      const cost = {
        roughStoneCost: input.cost.roughStoneCost,
        settingCost: input.cost.settingCost,
        otherCosts: input.cost.otherCosts.map((item) => ({
          name: item.name,
          amount: normalizeCostAmount(item.amount)!,
        })),
        totalCost,
        totalManual: input.cost.totalManual,
      };
      await tx.cabochonCost.upsert({
        where: { productId: product.id },
        create: { productId: product.id, ...cost },
        update: cost,
      });
    }
    if (input.tagIds !== undefined) {
      if (id) await tx.productTag.deleteMany({ where: { productId: id } });
      if (input.tagIds.length)
        await tx.productTag.createMany({
          data: input.tagIds.map((tagId) => ({ productId: product.id, tagId })),
        });
    }
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
    if (!id && input.source) await createSource(tx, product.id, input.source);
    const saved = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: productInclude,
    });
    if (input.saleManual === false && input.saleRule) {
      const serialized = serializeProduct(saved);
      const cost = productPricingCost(category.name === '蛋面', serialized.cost, serialized);
      const price = calculateProductPrice(cost.amount, input.saleRule, input.saleRuleValue ?? null);
      if (price === null) throw new ApiError(400, 'INVALID_INPUT');
      saved.priceCents = Number(amountToCents(price)!);
      const updated = await tx.product.update({
        where: { id: saved.id },
        data: { priceCents: saved.priceCents },
      });
      saved.updatedAt = updated.updatedAt;
    }
    return serializeProduct(saved);
  });
}
