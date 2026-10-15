import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { productSourceSchema, productStockAdjustmentSchema } from '@/lib/validation';
import {
  calculateDiyCost,
  calculateDiyQuote,
  diyQuoteLineTotal,
  emptyCraftDesignFee,
} from '@/lib/product-diy-cost';

type Tx = Prisma.TransactionClient;
type SourceInput = z.infer<typeof productSourceSchema>;
type AdjustmentInput = z.infer<typeof productStockAdjustmentSchema>;

export const productSourceInclude = {
  purchaseEntries: {
    include: { batch: true, distributor: true },
    orderBy: { createdAt: 'desc' },
  },
  diyRuns: {
    include: {
      materialLines: {
        include: { materialBatchEntry: { include: { material: true, batch: true } } },
        orderBy: { position: 'asc' },
      },
      cabochonLines: {
        include: { product: { select: { id: true, code: true, name: true } } },
        orderBy: { position: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  },
  stockAdjustments: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.ProductInclude;

type ProductSources = Prisma.ProductGetPayload<{ include: typeof productSourceInclude }>;

export function serializeProductSources(product: ProductSources) {
  return {
    purchaseEntries: product.purchaseEntries.map((entry) => ({
      ...entry,
      unitCost: entry.unitCost.toFixed(2),
    })),
    diyRuns: product.diyRuns.map((run) => ({
      ...run,
      perUnitCost: run.perUnitCost.toFixed(2),
      totalCost: run.totalCost?.toFixed(2) ?? null,
      perUnitQuote: run.perUnitQuote?.toFixed(2) ?? null,
      totalQuote: run.totalQuote?.toFixed(2) ?? null,
      materialLines: run.materialLines.map((line) => ({
        ...line,
        quantity: line.quantity.toFixed(2),
        unitCost: line.unitCost.toFixed(2),
        lineCost: line.lineCost.toFixed(2),
        quoteUnitPrice: line.quoteUnitPrice?.toFixed(2) ?? null,
        quoteLineTotal: line.quoteLineTotal?.toFixed(2) ?? null,
      })),
      cabochonLines: run.cabochonLines.map((line) => ({
        ...line,
        unitCost: line.unitCost.toFixed(2),
        lineCost: line.lineCost.toFixed(2),
        quoteUnitPrice: line.quoteUnitPrice?.toFixed(2) ?? null,
        quoteLineTotal: line.quoteLineTotal?.toFixed(2) ?? null,
      })),
    })),
    stockAdjustments: product.stockAdjustments,
  };
}

export async function changeProductStock(tx: Tx, productId: string, delta: number) {
  if (!delta) return;
  const stock = delta > 0 ? { lte: 2147483647 - delta } : { gte: -delta };
  const updated = await tx.product.updateMany({
    where: { id: productId, stock },
    data: { stock: { increment: delta } },
  });
  if (!updated.count) throw new ApiError(409, 'PRODUCT_STOCK_OUT_OF_RANGE');
}

async function resolveBatch(
  tx: Tx,
  selection: Extract<SourceInput, { origin: 'PURCHASED' }>['selection'],
) {
  if ('batchId' in selection) {
    if (!(await tx.materialBatch.findUnique({ where: { id: selection.batchId } })))
      throw new ApiError(400, 'MATERIAL_BATCH_NOT_FOUND');
    return selection.batchId;
  }
  const { name, receivedAt, notes } = selection.newBatch;
  const batch = await tx.materialBatch.create({
    data: { name, notes, receivedAt: new Date(`${receivedAt}T00:00:00.000Z`) },
  });
  return batch.id;
}

function decimal(value: string) {
  return new Prisma.Decimal(value);
}

function lineTotal(quantity: string | number, unitCost: string) {
  return decimal(String(quantity)).mul(unitCost).toDecimalPlaces(2);
}

async function writePurchase(
  tx: Tx,
  productId: string,
  input: Extract<SourceInput, { origin: 'PURCHASED' }>,
) {
  if (!(await tx.distributor.findUnique({ where: { id: input.distributorId } })))
    throw new ApiError(400, 'DISTRIBUTOR_NOT_FOUND');
  const batchId = await resolveBatch(tx, input.selection);
  return tx.productPurchaseEntry.create({
    data: {
      productId,
      batchId,
      distributorId: input.distributorId,
      quantity: input.quantity,
      unitCost: input.unitCost,
      notes: input.notes,
    },
  });
}

async function diyValues(
  tx: Tx,
  productId: string,
  input: Extract<SourceInput, { origin: 'DIY' }>,
  previous?: {
    materialLines: { materialBatchEntryId: string; quoteSnapshot: Prisma.JsonValue }[];
    cabochonLines: { productId: string; quoteSnapshot: Prisma.JsonValue }[];
  },
) {
  const materialIds = input.materials.map((line) => line.materialBatchEntryId);
  const cabochonIds = input.cabochons.map((line) => line.productId);
  const [materials, cabochons] = await Promise.all([
    tx.materialBatchEntry.findMany({
      where: { id: { in: materialIds } },
      select: {
        id: true,
        material: { select: { name: true } },
        lengthMm: true,
        widthMm: true,
        heightMm: true,
      },
    }),
    tx.product.findMany({
      where: { id: { in: cabochonIds }, category: { name: '蛋面' } },
      select: { id: true, name: true, code: true, measurement: true },
    }),
  ]);
  if (materials.length !== new Set(materialIds).size)
    throw new ApiError(400, 'MATERIAL_ENTRY_NOT_FOUND');
  if (cabochons.length !== new Set(cabochonIds).size || cabochonIds.includes(productId))
    throw new ApiError(400, 'CABOCHON_NOT_FOUND');

  const materialLines = input.materials.map((line, position) => ({
    materialBatchEntryId: line.materialBatchEntryId,
    usageUnit: line.usageUnit,
    quantity: line.quantity,
    unitCost: line.unitCost,
    lineCost: lineTotal(line.quantity, line.unitCost),
    quoteUnitPrice: line.quoteUnitPrice ?? null,
    quoteLineTotal: diyQuoteLineTotal(line.quantity, line.quoteUnitPrice),
    quoteSnapshot: (previous?.materialLines.find(
      (old) => old.materialBatchEntryId === line.materialBatchEntryId,
    )?.quoteSnapshot ??
      (() => {
        const material = materials.find((item) => item.id === line.materialBatchEntryId)!;
        return {
          name: material.material.name,
          lengthMm: material.lengthMm?.toFixed(2) ?? null,
          widthMm: material.widthMm?.toFixed(2) ?? null,
          heightMm: material.heightMm?.toFixed(2) ?? null,
        };
      })()) as Prisma.InputJsonObject,
    position,
  }));
  const cabochonLines = input.cabochons.map((line, position) => ({
    productId: line.productId,
    quantity: line.quantity,
    unitCost: line.unitCost,
    lineCost: lineTotal(line.quantity, line.unitCost),
    quoteUnitPrice: line.quoteUnitPrice ?? null,
    quoteLineTotal: diyQuoteLineTotal(line.quantity, line.quoteUnitPrice),
    quoteSnapshot: (previous?.cabochonLines.find((old) => old.productId === line.productId)
      ?.quoteSnapshot ??
      (() => {
        const product = cabochons.find((item) => item.id === line.productId)!;
        return {
          name: product.name,
          code: product.code,
          lengthMm: product.measurement?.lengthMm?.toFixed(2) ?? null,
          widthMm: product.measurement?.widthMm?.toFixed(2) ?? null,
          heightMm: product.measurement?.heightMm?.toFixed(2) ?? null,
        };
      })()) as Prisma.InputJsonObject,
    position,
  }));
  const cost = calculateDiyCost(input);
  const quote = calculateDiyQuote(input);
  if (!cost || decimal(cost.perUnitCost).greaterThan('9999999999.99'))
    throw new ApiError(400, 'INVALID_INPUT');
  return {
    quantity: input.quantity,
    perUnitCost: cost.perUnitCost,
    totalCost: cost.totalCost,
    perUnitQuote: quote?.perUnitQuote ?? null,
    totalQuote: quote?.totalQuote ?? null,
    craftDesignFee: input.craftDesignFee ?? emptyCraftDesignFee(),
    extraCosts: input.extraCosts,
    notes: input.notes,
    materialLines: { create: materialLines },
    cabochonLines: { create: cabochonLines },
  };
}

async function writeDiy(tx: Tx, productId: string, input: Extract<SourceInput, { origin: 'DIY' }>) {
  const values = await diyValues(tx, productId, input);
  return tx.productDiyRun.create({ data: { productId, ...values } });
}

export async function createSource(tx: Tx, productId: string, input: SourceInput) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { origin: true },
  });
  if (!product) throw new ApiError(404, 'NOT_FOUND');
  if (product.origin && product.origin !== input.origin)
    throw new ApiError(409, 'PRODUCT_ORIGIN_MISMATCH');
  if (!product.origin)
    await tx.product.update({ where: { id: productId }, data: { origin: input.origin } });
  const entry =
    input.origin === 'PURCHASED'
      ? await writePurchase(tx, productId, input)
      : await writeDiy(tx, productId, input);
  await changeProductStock(tx, productId, input.quantity);
  return entry.id;
}

export async function addProductSource(productId: string, input: SourceInput) {
  return db.$transaction(
    async (tx) => {
      await createSource(tx, productId, input);
      return tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: productSourceInclude,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateProductSource(productId: string, sourceId: string, input: SourceInput) {
  return db.$transaction(
    async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { origin: true },
      });
      if (!product) throw new ApiError(404, 'NOT_FOUND');
      if (product.origin !== input.origin) throw new ApiError(409, 'PRODUCT_ORIGIN_MISMATCH');
      if (input.origin === 'PURCHASED') {
        const current = await tx.productPurchaseEntry.findUnique({ where: { id: sourceId } });
        if (!current || current.productId !== productId) throw new ApiError(404, 'NOT_FOUND');
        if (!(await tx.distributor.findUnique({ where: { id: input.distributorId } })))
          throw new ApiError(400, 'DISTRIBUTOR_NOT_FOUND');
        const batchId = await resolveBatch(tx, input.selection);
        await tx.productPurchaseEntry.update({
          where: { id: sourceId },
          data: {
            batchId,
            distributorId: input.distributorId,
            quantity: input.quantity,
            unitCost: input.unitCost,
            notes: input.notes,
          },
        });
        await changeProductStock(tx, productId, input.quantity - current.quantity);
      } else {
        const current = await tx.productDiyRun.findUnique({
          where: { id: sourceId },
          include: { materialLines: true, cabochonLines: true },
        });
        if (!current || current.productId !== productId) throw new ApiError(404, 'NOT_FOUND');
        const values = await diyValues(tx, productId, input, current);
        await tx.productDiyMaterial.deleteMany({ where: { runId: sourceId } });
        await tx.productDiyCabochon.deleteMany({ where: { runId: sourceId } });
        await tx.productDiyRun.update({ where: { id: sourceId }, data: values });
        await changeProductStock(tx, productId, input.quantity - current.quantity);
      }
      return tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: productSourceInclude,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function deleteProductSource(productId: string, sourceId: string) {
  return db.$transaction(
    async (tx) => {
      const purchase = await tx.productPurchaseEntry.findUnique({ where: { id: sourceId } });
      const diy = purchase ? null : await tx.productDiyRun.findUnique({ where: { id: sourceId } });
      const entry = purchase ?? diy;
      if (!entry || entry.productId !== productId) throw new ApiError(404, 'NOT_FOUND');
      await changeProductStock(tx, productId, -entry.quantity);
      if (purchase) await tx.productPurchaseEntry.delete({ where: { id: sourceId } });
      else await tx.productDiyRun.delete({ where: { id: sourceId } });
      return tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: productSourceInclude,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function correctProductOrigin(productId: string, input: SourceInput) {
  return db.$transaction(
    async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { origin: true },
      });
      if (!product) throw new ApiError(404, 'NOT_FOUND');
      if (product.origin === input.origin) throw new ApiError(400, 'INVALID_INPUT');
      const [purchases, runs] = await Promise.all([
        tx.productPurchaseEntry.findMany({ where: { productId }, select: { quantity: true } }),
        tx.productDiyRun.findMany({ where: { productId }, select: { quantity: true } }),
      ]);
      const oldQuantity = [...purchases, ...runs].reduce((sum, row) => sum + row.quantity, 0);
      await changeProductStock(tx, productId, input.quantity - oldQuantity);
      await tx.productPurchaseEntry.deleteMany({ where: { productId } });
      await tx.productDiyRun.deleteMany({ where: { productId } });
      await tx.product.update({ where: { id: productId }, data: { origin: input.origin } });
      if (input.origin === 'PURCHASED') await writePurchase(tx, productId, input);
      else await writeDiy(tx, productId, input);
      return tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: productSourceInclude,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function adjustProductStock(productId: string, input: AdjustmentInput) {
  return db.$transaction(
    async (tx) => {
      await changeProductStock(tx, productId, input.delta);
      await tx.productStockAdjustment.create({ data: { productId, ...input } });
      return tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: productSourceInclude,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
