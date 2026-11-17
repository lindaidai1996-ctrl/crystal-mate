import { createHash } from 'node:crypto';
import { Prisma, type ProductCard } from '@prisma/client';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
import { productInclude, serializeProduct } from '@/lib/products';
import type { Product } from '@/lib/client-types';
import { cardMainMaterials, cardQuote } from './quote';
import { copyProductCardImage, validateBrandAssets } from './assets';
import {
  CARD_TEMPLATE_VERSION,
  cardBrandSchema,
  cardFieldsSchema,
  cardQuoteSchema,
  emptyCardBrand,
  type CardBrand,
  type CardFields,
  type CardSaveInput,
  type CardSource,
  type ProductCardView,
} from './contracts';

export const sourceParts = ['name', 'materials', 'images', 'quote'] as const;
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export async function cardProduct(productId: string) {
  const product = await db.product.findUnique({
    where: { id: productId },
    include: productInclude,
  });
  if (!product) throw new ApiError(404, 'NOT_FOUND');
  return serializeProduct(product) as unknown as Product;
}
export function sourceForCard(product: Product, runId: string | null): CardSource | null {
  const run = product.diyRuns.find((entry) => entry.id === runId);
  if (!run) return null;
  const source = {
    runId: run.id,
    name: product.name,
    materials: cardMainMaterials(run),
    images: product.images
      .filter((image) => Boolean(image.id))
      .map((image) => ({ id: image.id!, url: image.url, objectKey: image.objectKey })),
    quote: cardQuote(run, product.currency),
  };
  const hashes = Object.fromEntries(
    sourceParts.map((part) => [part, hash(source[part])]),
  ) as CardSource['hashes'];
  return { ...source, hashes, hash: hash({ runId, hashes }) };
}
export function viewCard(card: ProductCard, product?: Product): ProductCardView {
  const fields = cardFieldsSchema.parse(card.data);
  const source = product ? sourceForCard(product, card.runId) : null;
  const prior = card.sourceSnapshot as unknown as CardSource['hashes'];
  return {
    ...fields,
    id: card.id,
    productId: card.productId,
    runId: card.runId,
    version: card.version,
    templateVersion: card.templateVersion,
    quote: card.quoteSnapshot === null ? null : cardQuoteSchema.parse(card.quoteSnapshot),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    source,
    changed: source ? sourceParts.filter((part) => prior[part] !== source.hashes[part]) : [],
  };
}
export async function getCard(id: string) {
  const card = await db.productCard.findUnique({ where: { id } });
  if (!card) throw new ApiError(404, 'NOT_FOUND');
  return card;
}
export async function getBrand() {
  const settings = await db.productCardBrandSettings.findUnique({ where: { id: 'default' } });
  return {
    brand: settings
      ? cardBrandSchema.parse(settings.data)
      : { ...emptyCardBrand, name: '祝余 IWISH' },
    version: settings?.version ?? 0,
  };
}
export async function saveBrand(brand: CardBrand, version: number) {
  await validateBrandAssets([brand.logoAssetId, brand.qrAssetId]);
  return db
    .$transaction(async (tx) => {
      if (!version) {
        const existing = await tx.productCardBrandSettings.findUnique({ where: { id: 'default' } });
        if (existing) throw new ApiError(409, 'CARD_CONFLICT');
        await tx.productCardBrandSettings.create({
          data: { id: 'default', data: brand, version: 1 },
        });
      } else {
        const result = await tx.productCardBrandSettings.updateMany({
          where: { id: 'default', version },
          data: { data: brand, version: { increment: 1 } },
        });
        if (!result.count) throw new ApiError(409, 'CARD_CONFLICT');
      }
      return { brand, version: version + 1 };
    })
    .catch((error) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ApiError(409, 'CARD_CONFLICT');
      throw error;
    });
}

export async function prepareCard(productId: string, input: CardSaveInput, current?: ProductCard) {
  const product = await cardProduct(productId);
  if (!current && product.origin !== 'DIY') throw new ApiError(400, 'CARD_INVALID_SOURCE');
  if (current && input.version !== current.version) throw new ApiError(409, 'CARD_CONFLICT');
  const changedRun = !current || input.runId !== current.runId;
  const source = sourceForCard(product, input.runId);
  if ((changedRun || input.refresh?.length) && !source)
    throw new ApiError(400, 'CARD_SOURCE_REQUIRED');
  if (input.expectedSourceHash && source?.hash !== input.expectedSourceHash)
    throw new ApiError(409, 'CARD_SOURCE_CHANGED');
  const refresh = new Set(input.refresh ?? []);
  let fields: CardFields = cardFieldsSchema.parse({
    title: input.title,
    template: input.template,
    displayName: input.displayName,
    mainMaterials: input.mainMaterials,
    philosophy: input.philosophy,
    images: input.images,
    includeDetails: input.includeDetails,
    brand: input.brand,
  });
  // Validate existing private assets as well as new source image IDs.
  const images: CardFields['images'] = [];
  for (const image of fields.images) {
    if (image.sourceImageId) {
      const asset = await copyProductCardImage(productId, image.sourceImageId);
      images.push({ assetId: asset.id, framing: image.framing });
    } else {
      const valid = await db.productCardAsset.findFirst({
        where: { id: image.assetId, productId, kind: 'PRODUCT' },
      });
      if (!valid) throw new ApiError(400, 'CARD_INVALID_SOURCE');
      images.push({ assetId: valid.id, framing: image.framing });
    }
  }
  await validateBrandAssets([fields.brand.logoAssetId, fields.brand.qrAssetId]);
  fields = cardFieldsSchema.parse({ ...fields, images });
  const quote =
    changedRun || refresh.has('quote') ? (source?.quote ?? null) : (current?.quoteSnapshot ?? null);
  if (fields.includeDetails && !quote) throw new ApiError(400, 'CARD_QUOTE_INCOMPLETE');
  const snapshots = current
    ? ({ ...(current.sourceSnapshot as object) } as CardSource['hashes'])
    : ({} as CardSource['hashes']);
  if (source)
    for (const part of sourceParts)
      if (!current || refresh.has(part) || (part === 'quote' && changedRun))
        snapshots[part] = source.hashes[part];
  return {
    fields,
    source,
    data: {
      title: fields.title,
      templateId: fields.template,
      templateVersion: CARD_TEMPLATE_VERSION,
      runId: input.runId,
      data: fields as unknown as Prisma.InputJsonValue,
      quoteSnapshot: quote === null ? Prisma.DbNull : (quote as Prisma.InputJsonValue),
      sourceSnapshot: snapshots as unknown as Prisma.InputJsonValue,
    },
  };
}
export async function saveCard(productId: string, input: CardSaveInput, current?: ProductCard) {
  const prepared = await prepareCard(productId, input, current);
  return db
    .$transaction(
      async (tx) => {
        // Source changes during image copying must not silently publish a different quote.
        const record = await tx.product.findUnique({
          where: { id: productId },
          include: productInclude,
        });
        if (!record) throw new ApiError(404, 'NOT_FOUND');
        if (prepared.source) {
          const fresh = sourceForCard(serializeProduct(record) as unknown as Product, input.runId);
          if (fresh?.hash !== prepared.source.hash) throw new ApiError(409, 'CARD_SOURCE_CHANGED');
        }
        if (!current) return tx.productCard.create({ data: { productId, ...prepared.data } });
        const result = await tx.productCard.updateMany({
          where: { id: current.id, version: input.version },
          data: { ...prepared.data, version: { increment: 1 } },
        });
        if (!result.count) throw new ApiError(409, 'CARD_CONFLICT');
        return tx.productCard.findUniqueOrThrow({ where: { id: current.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ApiError(409, 'CARD_CONFLICT');
      throw error;
    });
}
