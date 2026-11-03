import { Prisma } from '@prisma/client';
import { db } from './db';

// Prisma scalar-list filters only match entire aliases; search each alias for a substring.
export async function findAliasIds(entity: 'product' | 'material', query: string) {
  if (!query) return [];
  const table = entity === 'product' ? Prisma.sql`"Product"` : Prisma.sql`"Material"`;
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM ${table}
    WHERE EXISTS (
      SELECT 1 FROM unnest(aliases) AS alias
      WHERE strpos(lower(alias), lower(${query})) > 0
    )
  `);
  return rows.map(({ id }) => id);
}
