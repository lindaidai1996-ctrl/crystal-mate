import { Prisma } from '@prisma/client';
import { db } from '../db';
import { ApiError } from '../api';
import {
  calculation,
  hash,
  priceStateToken,
  schemeContextSelect,
  storedContext,
  type Tx,
} from './store';
import {
  schemeChangeSchema,
  schemeCommitSchema,
  type SchemeChange,
  type SchemeCommit,
  type SchemeImpact,
  type ImpactRow,
} from './contracts';
async function buildImpact(tx: Tx, change: SchemeChange) {
  const current = change.id ? await tx.priceScheme.findUnique({ where: { id: change.id } }) : null;
  if (change.id && !current) throw new ApiError(404, 'NOT_FOUND');
  if (current && change.expectedVersion !== current.version)
    throw new ApiError(409, 'SCHEME_PRICE_CHANGED');
  const ruleChanged =
    !!current &&
    (current.formula !== change.input.formula || current.rounding !== change.input.rounding);
  const addCommon = change.input.common && !current?.common;
  const affected = ruleChanged || addCommon;
  const products = affected
    ? await tx.product.findMany({
        where: addCommon ? {} : { schemePrices: { some: { schemeId: change.id! } } },
        select: schemeContextSelect,
        orderBy: { id: 'asc' },
      })
    : [];
  const rows: ImpactRow[] = products.map((product) => {
    const old = product.schemePrices.find((row) => row.schemeId === change.id);
    const next = calculation(change.input, storedContext(product));
    const protectedPrice = old && old.mode !== 'AUTO';
    return {
      id: product.id,
      name: product.name,
      code: product.code,
      oldAmountCents: old?.amountCents ?? null,
      amountCents: protectedPrice ? old.amountCents : next.amountCents,
      error: protectedPrice ? (old.error as ImpactRow['error']) : next.error,
      mode: (old?.mode ?? 'AUTO') as ImpactRow['mode'],
      added: !old,
    };
  });
  const token = hash({
    change,
    current,
    products: products.map((product) => [product.id, priceStateToken(product)]),
  });
  return {
    current,
    ruleChanged,
    products,
    impact: { token, rows, total: rows.length, affected } satisfies SchemeImpact,
  };
}
async function transaction<T>(operation: (tx: Tx) => Promise<T>) {
  try {
    return await db.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 120000,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
      throw new ApiError(409, 'SCHEME_PRICE_CHANGED');
    throw error;
  }
}
export function previewSchemeChange(input: SchemeChange) {
  const change = schemeChangeSchema.parse(input);
  return transaction(async (tx) => (await buildImpact(tx, change)).impact);
}
export function commitSchemeChange(input: SchemeCommit) {
  const parsed = schemeCommitSchema.parse(input);
  const { token, excludedIds, ...change } = parsed;
  return transaction(async (tx) => {
    const { current, products, impact, ruleChanged } = await buildImpact(tx, change);
    if (token !== impact.token) throw new ApiError(409, 'SCHEME_PRICE_CHANGED');
    const excluded = new Set(excludedIds);
    if (
      [...excluded].some(
        (id) =>
          !impact.rows.some(
            (row) =>
              row.id === id && row.mode === 'AUTO' && !row.added && row.oldAmountCents !== null,
          ),
      )
    )
      throw new ApiError(400, 'INVALID_INPUT');
    const scheme = current
      ? await tx.priceScheme.update({
          where: { id: current.id },
          data: { ...change.input, version: { increment: 1 } },
        })
      : await tx.priceScheme.create({ data: change.input });
    await tx.priceSchemeRevision.create({
      data: {
        schemeId: scheme.id,
        version: scheme.version,
        formula: scheme.formula,
        rounding: scheme.rounding,
      },
    });
    const counts = { updated: 0, retained: 0, invalid: 0 };
    for (const product of products) {
      const old = product.schemePrices.find((row) => row.schemeId === scheme.id);
      if (old && old.mode !== 'AUTO') {
        counts.retained++;
        continue;
      }
      if (old && excluded.has(product.id)) {
        await tx.productSchemePrice.update({
          where: { id: old.id },
          data: { mode: 'RETAIN', version: { increment: 1 } },
        });
        counts.retained++;
        continue;
      }
      if (old && !ruleChanged) {
        counts.retained++;
        continue;
      }
      const next = calculation(scheme, storedContext(product));
      const data = {
        ...next,
        mode: 'AUTO',
        schemeVersion: scheme.version,
        previousAmountCents: old?.amountCents ?? old?.previousAmountCents ?? null,
      };
      await tx.productSchemePrice.upsert({
        where: { productId_schemeId: { productId: product.id, schemeId: scheme.id } },
        create: { productId: product.id, schemeId: scheme.id, ...data },
        update: { ...data, version: { increment: 1 } },
      });
      if (next.error) counts.invalid++;
      else counts.updated++;
    }
    return { scheme, counts };
  });
}
