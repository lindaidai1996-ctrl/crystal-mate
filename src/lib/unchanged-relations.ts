import { Prisma } from '@prisma/client';

const numericFields = new Set([
  'quantity',
  'unitCost',
  'lineCost',
  'quoteUnitPrice',
  'quoteLineTotal',
  'position',
]);
function canonical(value: unknown, field = ''): unknown {
  if (value === Prisma.DbNull || value === Prisma.JsonNull) return null;
  if (value === null || value === undefined) return value ?? null;
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (numericFields.has(field) && (typeof value === 'number' || typeof value === 'string'))
    return new Prisma.Decimal(value).toString();
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry, key)]),
    );
  return value;
}

// Ignore storage IDs/timestamps when a UI resubmits the same ordered collection.
// This avoids recording an unchanged image/attachment as a deletion and re-creation.
export function sameOrderedRows(existing: readonly object[], desired: readonly object[]) {
  if (existing.length !== desired.length) return false;
  const ordered = [...existing].sort(
    (a, b) => Number(Reflect.get(a, 'position')) - Number(Reflect.get(b, 'position')),
  );
  return desired.every((row, index) =>
    Object.entries(row).every(
      ([key, value]) =>
        JSON.stringify(canonical(Reflect.get(ordered[index], key), key)) ===
        JSON.stringify(canonical(value, key)),
    ),
  );
}
