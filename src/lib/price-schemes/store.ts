import { createHash } from 'node:crypto';
import { Prisma, type ProductSchemePrice, type PriceScheme } from '@prisma/client';
import { ApiError } from '../api';
import { priceContext } from './variables';
import { calculateScheme, parseFormula, type Rounding } from './formula';
import type { PriceContext, SchemePricesWrite } from './contracts';
export type Tx = Prisma.TransactionClient;
export const schemePriceInclude = { scheme: true } satisfies Prisma.ProductSchemePriceInclude;
export const schemeContextSelect = {
  id: true,
  name: true,
  code: true,
  currency: true,
  priceCents: true,
  origin: true,
  category: { select: { name: true } },
  cost: true,
  purchaseEntries: { select: { id: true, createdAt: true, unitCost: true } },
  diyRuns: {
    select: {
      id: true,
      createdAt: true,
      perUnitCost: true,
      perUnitQuote: true,
      quantity: true,
      craftDesignFee: true,
    },
  },
  schemePrices: { include: schemePriceInclude, orderBy: { schemeId: 'asc' } },
} satisfies Prisma.ProductSelect;
export type PricingProduct = Prisma.ProductGetPayload<{ select: typeof schemeContextSelect }>;
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function hash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function storedContext(product: Omit<PricingProduct, 'schemePrices'>): PriceContext {
  return priceContext(
    product.category.name === '蛋面',
    product.cost
      ? {
          roughStoneCost: product.cost.roughStoneCost?.toFixed(2) ?? null,
          settingCost: product.cost.settingCost?.toFixed(2) ?? null,
          otherCosts: product.cost.otherCosts as Array<{ name: string; amount: string | null }>,
          totalManual: product.cost.totalManual,
          totalCost: product.cost.totalCost.toFixed(2),
        }
      : null,
    {
      origin: product.origin,
      purchaseEntries: product.purchaseEntries.map((row) => ({
        ...row,
        unitCost: row.unitCost.toFixed(2),
      })),
      diyRuns: product.diyRuns.map((row) => ({
        ...row,
        perUnitCost: row.perUnitCost.toFixed(2),
        perUnitQuote: row.perUnitQuote?.toFixed(2) ?? null,
      })),
    },
    (product.priceCents / 100).toFixed(2),
  );
}
export function priceStateToken(product: PricingProduct) {
  return hash({
    values: storedContext(product),
    prices: [...product.schemePrices]
      .sort((a, b) => a.schemeId.localeCompare(b.schemeId))
      .map((row) => [row.schemeId, row.version, row.scheme.version]),
  });
}
export function serializeSchemePrices(rows: Array<ProductSchemePrice & { scheme: PriceScheme }>) {
  return [...rows]
    .sort(
      (a, b) =>
        a.scheme.position - b.scheme.position ||
        a.scheme.name.localeCompare(b.scheme.name) ||
        a.schemeId.localeCompare(b.schemeId),
    )
    .map((row) => ({
      schemeId: row.schemeId,
      scheme: row.scheme,
      mode: row.mode,
      amountCents: row.amountCents,
      previousAmountCents: row.previousAmountCents,
      error: row.error,
      schemeVersion: row.schemeVersion,
      version: row.version,
    }));
}
export function calculation(
  scheme: Pick<PriceScheme, 'formula' | 'rounding'>,
  context: PriceContext,
) {
  const { dependencies } = parseFormula(scheme.formula);
  const basis = Object.fromEntries(
    dependencies.map((key) => [
      key,
      { value: context.values[key], applicable: context.applicable.includes(key) },
    ]),
  );
  return {
    ...calculateScheme(
      scheme.formula,
      scheme.rounding as Rounding,
      context.values,
      context.applicable,
    ),
    basis,
  };
}
export async function checkPriceState(tx: Tx, productId: string, expectedToken?: string) {
  if (!expectedToken) return;
  const product = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: schemeContextSelect,
  });
  if (priceStateToken(product) !== expectedToken) throw new ApiError(409, 'SCHEME_PRICE_CHANGED');
}
/** Call inside the same transaction, after all cost/source/direct-price writes. */
export async function syncSchemePrices(tx: Tx, productId: string, write?: SchemePricesWrite) {
  const schemes = await tx.priceScheme.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  if (!schemes.length && !write?.items.length) return;
  const product = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: schemeContextSelect,
  });
  const context = storedContext(product);
  const existing = new Map(product.schemePrices.map((row) => [row.schemeId, row]));
  const requested = write ? new Map(write.items.map((row) => [row.schemeId, row])) : undefined;
  if (requested && [...requested.keys()].some((id) => !schemes.some((scheme) => scheme.id === id)))
    throw new ApiError(400, 'INVALID_INPUT');
  for (const scheme of schemes) {
    const old = existing.get(scheme.id),
      input = requested?.get(scheme.id);
    if (input && input.schemeVersion !== scheme.version)
      throw new ApiError(409, 'SCHEME_PRICE_CHANGED');
    if (old && requested && !input && !scheme.common) {
      await tx.productSchemePrice.delete({ where: { id: old.id } });
      continue;
    }
    if (!old && !input && !scheme.common) continue;
    const mode = input?.mode ?? old?.mode ?? 'AUTO';
    if (mode === 'RETAIN' && old?.mode !== 'RETAIN') throw new ApiError(400, 'INVALID_INPUT');
    if (mode !== 'AUTO') {
      if (mode === 'RETAIN' || !input) continue;
      if (old?.mode === 'MANUAL' && old.amountCents === input.amountCents) continue;
      const data = {
        mode,
        amountCents: input.amountCents,
        error: null,
        schemeVersion: scheme.version,
        basis: {},
        previousAmountCents: old?.amountCents ?? old?.previousAmountCents ?? null,
      };
      await tx.productSchemePrice.upsert({
        where: { productId_schemeId: { productId, schemeId: scheme.id } },
        create: { productId, schemeId: scheme.id, ...data },
        update: { ...data, version: { increment: 1 } },
      });
      continue;
    }
    const next = calculation(scheme, context);
    // Metadata edits do not recalculate. An explicit recovery from a protected mode does.
    if (
      old?.mode === 'AUTO' &&
      hash(old.basis) === hash(next.basis) &&
      old.amountCents === next.amountCents &&
      old.error === next.error
    )
      continue;
    const data = {
      ...next,
      mode,
      schemeVersion: scheme.version,
      previousAmountCents: old?.amountCents ?? old?.previousAmountCents ?? null,
    };
    await tx.productSchemePrice.upsert({
      where: { productId_schemeId: { productId, schemeId: scheme.id } },
      create: { productId, schemeId: scheme.id, ...data },
      update: { ...data, version: { increment: 1 } },
    });
  }
}
