import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { requireAccount } from '@/lib/api';
import { db } from '@/lib/db';
import { readAssistantStock } from './stock-data';
import { stockQuerySchema } from './stock-contracts';

export async function queryAssistantStock(request: NextRequest, input: unknown) {
  await requireAccount(request);
  const query = stockQuerySchema.parse(input);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
      return readAssistantStock(tx, query);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
  );
}
