import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
export async function procurementTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !(
          error.code === 'P2034' ||
          (error.code === 'P2002' &&
            error.meta?.modelName === 'MaterialBatch' &&
            Array.isArray(error.meta?.target) &&
            error.meta.target.length === 1 &&
            error.meta.target[0] === 'name') ||
          (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)))
        )
      )
        throw error;
      // PostgreSQL has rolled back every write before a serializable retry.
      // Explicit fingerprint/version conflicts are ApiErrors and are never retried.
      if (attempt >= 4) throw new ApiError(409, 'PRICING_PURCHASE_CHANGED');
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}
