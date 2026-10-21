import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { formatProductCode, parseProductCode } from '@/lib/product-code';

export async function withProductTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  retryCodeConflict = false,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (retryCodeConflict && error.code === 'P2002' && error.meta?.modelName === 'ProductCode'));
      if (!retryable || attempt >= 7) throw error;
    }
  }
}

export async function reserveProductCode(categoryId: string) {
  return withProductTransaction(async (tx) => {
    const category = await tx.category.findUnique({
      where: { id: categoryId },
      select: { prefix: true },
    });
    if (!category) throw new ApiError(400, 'CATEGORY_NOT_FOUND');
    if (!category.prefix) throw new ApiError(400, 'CATEGORY_PREFIX_MISSING');

    const latest = await tx.productCode.findFirst({
      where: { prefix: category.prefix },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    let sequence = latest?.sequence ?? 0;
    while (sequence < 9999) {
      const code = formatProductCode(category.prefix, sequence);
      sequence += 1;
      // Also tolerate products imported directly without a history record.
      const existing = await tx.product.findUnique({ where: { code }, select: { id: true } });
      if (existing) continue;
      const reservationToken = randomUUID();
      await tx.productCode.create({
        data: { code, prefix: category.prefix, sequence, categoryId, reservationToken },
      });
      return { code, reservationToken };
    }
    throw new ApiError(409, 'CODE_EXHAUSTED');
  }, true);
}

type CurrentProduct = { id: string; code: string; categoryId: string };
type CodeInput = { code: string; categoryId: string; codeReservationToken?: string };

export async function validateProductCode(
  tx: Prisma.TransactionClient,
  input: CodeInput,
  prefix: string | null,
  current: CurrentProduct | null,
) {
  if (current) {
    await tx.productCode.upsert({
      where: { code: current.code },
      create: {
        code: current.code,
        ...parseProductCode(current.code),
        categoryId: current.categoryId,
        productId: current.id,
      },
      update: {},
    });
  }
  const categoryChanged = current !== null && current.categoryId !== input.categoryId;
  if (!categoryChanged && current?.code === input.code) return;

  const record = await tx.productCode.findUnique({ where: { code: input.code } });
  const reserved =
    record !== null &&
    record.productId === null &&
    record.reservationToken !== null &&
    record.reservationToken === input.codeReservationToken &&
    record.categoryId === input.categoryId &&
    record.prefix === prefix;

  if ((categoryChanged || input.codeReservationToken) && !reserved)
    throw new ApiError(409, 'PRODUCT_CODE_REGENERATE');
  if (record && !reserved) throw new ApiError(409, 'PRODUCT_CODE_USED');
}

export async function claimProductCode(
  tx: Prisma.TransactionClient,
  input: CodeInput,
  productId: string,
  current: CurrentProduct | null,
) {
  if (current?.code === input.code) return;
  if (input.codeReservationToken) {
    const claimed = await tx.productCode.updateMany({
      where: { code: input.code, reservationToken: input.codeReservationToken, productId: null },
      data: { productId, reservationToken: null },
    });
    if (claimed.count !== 1) throw new ApiError(409, 'PRODUCT_CODE_REGENERATE');
  } else {
    await tx.productCode.create({
      data: {
        code: input.code,
        ...parseProductCode(input.code),
        categoryId: input.categoryId,
        productId,
      },
    });
  }
}
