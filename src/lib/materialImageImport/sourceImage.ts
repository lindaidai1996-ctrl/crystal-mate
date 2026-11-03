import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiError } from '@/lib/api';
import { cosConfig, imageTypeFromBytes, MAX_IMAGE_BYTES, storageMode } from '@/lib/media';
import { importSourceKeyPattern } from '@/lib/image-storage';

export async function readImportSource(objectKey: string) {
  if (!importSourceKeyPattern.test(objectKey)) throw new ApiError(400, 'INVALID_IMAGE');
  let bytes: Buffer;
  if (storageMode() === 'local') {
    bytes = await readFile(join(process.cwd(), 'public/uploads', objectKey));
  } else {
    const { client, bucket, region } = cosConfig();
    const result = await client.getObject({ Bucket: bucket, Region: region, Key: objectKey });
    bytes = Buffer.from(result.Body as Buffer);
  }
  const mimeType = imageTypeFromBytes(bytes);
  if (!mimeType || !bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new ApiError(400, 'INVALID_IMAGE');
  return { bytes, mimeType };
}
