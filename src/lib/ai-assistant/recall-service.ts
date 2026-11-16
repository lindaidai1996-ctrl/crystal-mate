import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { requireAccount } from '@/lib/api';
import { db } from '@/lib/db';
import { readAssistantRecall } from './recall-data';
import { RecallRuns } from './recall-runs';
const runs = new RecallRuns();
export async function queryAssistantRecall(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  return runs.query(account.id, input, (query) =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        return readAssistantRecall(tx, query);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    ),
  );
}
export async function getAssistantRecallDetails(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  return runs.details(account.id, input);
}
