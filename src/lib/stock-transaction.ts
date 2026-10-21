import { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';

export async function stockTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await db.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
      throw new ApiError(409, 'STOCK_CHANGED');
    throw error;
  }
}
