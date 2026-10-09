import COS from 'cos-nodejs-sdk-v5';
import { ApiError } from '@/lib/api';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const imageTypes: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function imageTypeFromBytes(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp';
  return null;
}

export function storageMode() {
  const mode = process.env.MEDIA_STORAGE ?? 'local';
  if (mode !== 'local' && mode !== 'cos') throw new ApiError(500, 'STORAGE_NOT_CONFIGURED');
  if (process.env.NODE_ENV === 'production' && mode === 'local')
    throw new ApiError(500, 'STORAGE_NOT_CONFIGURED');
  return mode;
}

export function cosConfig() {
  const { COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION } = process.env;
  if (!COS_SECRET_ID || !COS_SECRET_KEY || !COS_BUCKET || !COS_REGION)
    throw new ApiError(500, 'STORAGE_NOT_CONFIGURED');
  return {
    client: new COS({ SecretId: COS_SECRET_ID, SecretKey: COS_SECRET_KEY }),
    bucket: COS_BUCKET,
    region: COS_REGION,
  };
}
