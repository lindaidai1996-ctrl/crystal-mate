import { PrismaClient } from '@prisma/client';
import { withDatabaseAudit } from './audit-db';

const globalDb = globalThis as unknown as { prisma?: PrismaClient };

const cached = globalDb.prisma;
// A dev server can retain a client generated before audit or assistant models existed.
const client =
  cached?.auditLog &&
  cached.recordAttribution &&
  cached.assistantConversation &&
  cached.assistantExecution &&
  cached.assistantMessage &&
  cached.assistantFeedback &&
  cached.productCard &&
  cached.productCardAsset &&
  cached.productCardBrandSettings &&
  cached.diyRecentMaterial &&
  cached.diyRecentCabochon
    ? cached
    : new PrismaClient();
if (cached && cached !== client) void cached.$disconnect().catch(() => {});
if (process.env.NODE_ENV !== 'production') globalDb.prisma = client;
export const db = withDatabaseAudit(client);
