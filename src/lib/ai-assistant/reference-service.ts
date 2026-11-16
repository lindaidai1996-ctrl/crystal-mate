import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { requireAccount } from '@/lib/api';
import { db } from '@/lib/db';
import {
  dictionaryQuerySchema,
  locationQuerySchema,
  REFERENCE_SCAN_LIMIT,
} from './reference-contracts';
import {
  resolveLocationRows,
  searchDictionaryRows,
  type DictionaryRow,
} from './reference-resolution';

const take = REFERENCE_SCAN_LIMIT + 1;
const orderBy = { id: 'asc' } as const;

export async function resolveAssistantLocation(request: NextRequest, input: unknown) {
  await requireAccount(request);
  const query = locationQuerySchema.parse(input);
  const rows = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
      return tx.distributor.findMany({
        select: { id: true, name: true, area: true, address: true, notes: true },
        orderBy,
        take,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 },
  );
  return resolveLocationRows(
    query,
    rows.slice(0, REFERENCE_SCAN_LIMIT),
    rows.length <= REFERENCE_SCAN_LIMIT,
  );
}

export async function searchAssistantDictionary(request: NextRequest, input: unknown) {
  await requireAccount(request);
  const query = dictionaryQuerySchema.parse(input);
  const sources = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
      const selected = new Set(query.kinds);
      const [materials, products, tags, distributors] = await Promise.all([
        selected.has('MATERIAL_CATEGORY')
          ? tx.materialCategory.findMany({
              select: { id: true, name: true, aliases: true, parentId: true },
              orderBy,
              take,
            })
          : [],
        selected.has('PRODUCT_CATEGORY')
          ? tx.category.findMany({
              select: { id: true, name: true },
              orderBy,
              take,
            })
          : [],
        selected.has('TAG')
          ? tx.tag.findMany({ select: { id: true, name: true }, orderBy, take })
          : [],
        selected.has('DISTRIBUTOR')
          ? tx.distributor.findMany({ select: { id: true, name: true }, orderBy, take })
          : [],
      ]);
      return [
        materials.map((row): DictionaryRow => ({ ...row, type: 'MATERIAL_CATEGORY' })),
        products.map(
          (row): DictionaryRow => ({
            ...row,
            type: 'PRODUCT_CATEGORY',
            aliases: [],
            parentId: null,
          }),
        ),
        tags.map((row): DictionaryRow => ({ ...row, type: 'TAG', aliases: [], parentId: null })),
        distributors.map(
          (row): DictionaryRow => ({ ...row, type: 'DISTRIBUTOR', aliases: [], parentId: null }),
        ),
      ];
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 },
  );
  return searchDictionaryRows(
    query,
    sources.flatMap((rows) => rows.slice(0, REFERENCE_SCAN_LIMIT)),
    sources.every((rows) => rows.length <= REFERENCE_SCAN_LIMIT),
  );
}
