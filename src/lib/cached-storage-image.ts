import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { ApiError } from '@/lib/api';
import { cachedImage } from '@/lib/image-cache';
import { cosConfig, imageTypeFromBytes, MAX_IMAGE_BYTES, storageMode } from '@/lib/media';

// Keep decoded images from competing for memory on the small production server.
let transformations = Promise.resolve();

function thumbnail(load: () => Promise<Buffer>, width: 128 | 640) {
  const task = transformations.then(async () => {
    const original = await load();
    try {
      return await sharp(original, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      // Large/unsupported originals must stay viewable even when conversion is unavailable.
      return original;
    }
  });
  transformations = task.then(
    () => {},
    () => {},
  );
  return task;
}

export async function storageImage(key: string, width?: 128 | 640) {
  const mode = storageMode();
  const cos = mode === 'cos' ? cosConfig() : undefined;
  const identity = cos ? `cos:${cos.bucket}:${cos.region}:${key}` : `local:${process.cwd()}:${key}`;
  const original = () =>
    cachedImage(`${identity}:original:v1`, async () => {
      if (!cos) {
        try {
          const bytes = await readFile(join(process.cwd(), 'public', 'uploads', key));
          if (bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES)
            throw new ApiError(404, 'NOT_FOUND');
          return bytes;
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            throw new ApiError(404, 'NOT_FOUND');
          throw error;
        }
      }
      const object = { Bucket: cos.bucket, Region: cos.region, Key: key };
      try {
        const metadata = await cos.client.headObject(object);
        const size = Number(metadata.headers?.['content-length']);
        if (!Number.isFinite(size) || size < 1 || size > MAX_IMAGE_BYTES)
          throw new ApiError(404, 'NOT_FOUND');
        const chunks: Buffer[] = [];
        let length = 0;
        const stream = cos.client.getObjectStream(object) as Readable;
        for await (const chunk of stream) {
          const bytes = Buffer.from(chunk);
          length += bytes.length;
          if (length > MAX_IMAGE_BYTES) throw new ApiError(404, 'NOT_FOUND');
          chunks.push(bytes);
        }
        if (length !== size) throw new ApiError(502, 'INVALID_IMAGE');
        return Buffer.concat(chunks);
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404)
          throw new ApiError(404, 'NOT_FOUND');
        throw error;
      }
    });
  const bytes = width
    ? await cachedImage(`${identity}:webp:${width}:v1`, () => thumbnail(original, width))
    : await original();
  return {
    bytes,
    contentType: imageTypeFromBytes(bytes),
    etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
  };
}
