import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
import { storageImage } from '@/lib/cached-storage-image';
import { cosConfig, imageTypeFromBytes, MAX_IMAGE_BYTES, storageMode } from '@/lib/media';

// These objects deliberately live outside public/uploads, even in local development.
export async function readCardAsset(id: string) {
  const asset = await db.productCardAsset.findUnique({ where: { id } });
  if (!asset) throw new ApiError(404, 'CARD_IMAGE_UNAVAILABLE');
  const key = asset.storageKey;
  if (!/^product-cards\/assets\/[0-9a-f-]{36}\.png$/.test(key))
    throw new ApiError(422, 'CARD_IMAGE_UNAVAILABLE');
  try {
    let bytes: Buffer;
    if (storageMode() === 'cos') {
      const { client, bucket, region } = cosConfig();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of client.getObjectStream({
        Bucket: bucket,
        Region: region,
        Key: key,
      }) as Readable) {
        const part = Buffer.from(chunk);
        size += part.length;
        if (size > MAX_IMAGE_BYTES) throw new Error('Image too large');
        chunks.push(part);
      }
      bytes = Buffer.concat(chunks);
    } else bytes = await readFile(join(process.cwd(), '.data', key));
    if (
      !bytes.length ||
      bytes.length > MAX_IMAGE_BYTES ||
      imageTypeFromBytes(bytes) !== 'image/png'
    )
      throw new Error('Invalid image');
    return bytes;
  } catch {
    throw new ApiError(422, 'CARD_IMAGE_UNAVAILABLE');
  }
}

async function storeAsset(
  bytes: Buffer,
  kind: 'PRODUCT' | 'BRAND',
  productId?: string,
  sourceKey?: string,
) {
  let normalized: Buffer;
  try {
    normalized = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new ApiError(400, 'INVALID_IMAGE');
  }
  if (normalized.length > MAX_IMAGE_BYTES) throw new ApiError(400, 'INVALID_IMAGE');
  const id = randomUUID();
  const storageKey = `product-cards/assets/${id}.png`;
  if (storageMode() === 'cos') {
    const { client, bucket, region } = cosConfig();
    await client.putObject({
      Bucket: bucket,
      Region: region,
      Key: storageKey,
      Body: normalized,
      ContentType: 'image/png',
    });
  } else {
    const path = join(process.cwd(), '.data', storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, normalized, { flag: 'wx' });
  }
  return db.productCardAsset.create({ data: { id, kind, productId, sourceKey, storageKey } });
}

export async function copyProductCardImage(productId: string, sourceImageId: string) {
  const source = await db.productImage.findFirst({ where: { id: sourceImageId, productId } });
  if (!source) throw new ApiError(400, 'CARD_INVALID_SOURCE');
  const existing = await db.productCardAsset.findFirst({
    where: { productId, sourceKey: source.objectKey, kind: 'PRODUCT' },
  });
  if (existing) return existing;
  try {
    const { bytes } = await storageImage(source.objectKey);
    return await storeAsset(bytes, 'PRODUCT', productId, source.objectKey);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'INVALID_IMAGE') throw error;
    throw new ApiError(422, 'CARD_IMAGE_UNAVAILABLE');
  }
}
export async function uploadCardBrandAsset(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !imageTypeFromBytes(bytes))
    throw new ApiError(400, 'INVALID_IMAGE');
  return storeAsset(bytes, 'BRAND');
}
export async function validateBrandAssets(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const count = await db.productCardAsset.count({ where: { id: { in: unique }, kind: 'BRAND' } });
  if (count !== unique.length) throw new ApiError(400, 'CARD_INVALID_SOURCE');
}
