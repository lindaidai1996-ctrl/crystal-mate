// Run with: node scripts/import-product-tags.mjs
// Uses DATABASE_URL from .env and the names in public/scripts/import-product-tags.mjs.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { sampleProductTags } from '../public/scripts/import-product-tags.mjs';

const names = [...new Set(sampleProductTags.map((name) => name.trim()))];
if (names.some((name) => !name || name.length > 60)) {
  throw new Error('Tag names must contain 1 to 60 characters.');
}

const db = new PrismaClient();
try {
  const { count } = await db.tag.createMany({
    data: names.map((name) => ({ name })),
    skipDuplicates: true,
  });
  const saved = await db.tag.findMany({
    where: { name: { in: names } },
    select: { name: true },
  });
  const savedNames = new Set(saved.map((tag) => tag.name));
  const missing = names.filter((name) => !savedNames.has(name));
  console.log({
    requested: names.length,
    created: count,
    alreadyExists: names.length - count,
    missing,
  });
  if (missing.length) process.exitCode = 1;
} finally {
  await db.$disconnect();
}
