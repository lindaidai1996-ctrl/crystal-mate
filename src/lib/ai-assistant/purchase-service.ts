import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { requireAccount } from '@/lib/api';
import { db } from '@/lib/db';
import { readAssistantPurchases } from './purchase-data';
import { PurchaseRuns } from './purchase-runs';

const runs = new PurchaseRuns();
export async function queryAssistantPurchases(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  return runs.query(account.id, input, (query) =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        return readAssistantPurchases(tx, query);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    ),
  );
}
