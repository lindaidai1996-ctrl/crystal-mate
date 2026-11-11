// Shared by upload clients, storage handlers, and attachment validation.
export const imageUploadPurposes = [
  'catalog',
  'import-source',
  'import-crop',
  'cabochon',
  // Older import pages may still send this purpose after an application update.
  'cabochon-excel',
] as const;
export type ImageUploadPurpose = (typeof imageUploadPurposes)[number];
export const imageUploadPrefixes: Record<ImageUploadPurpose, string> = {
  catalog: 'images',
  'import-source': 'material-imports/sources',
  'import-crop': 'material-imports/crops',
  cabochon: 'cabochons/images',
  'cabochon-excel': 'cabochons/images',
};

const imageFile = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:jpg|png|webp)';
export const imageObjectKeyPattern = new RegExp(
  `^(?:images|material-imports/(?:sources|crops)|(?:cabochons|cabochon-imports)/images)/${imageFile}$`,
);
// Existing import drafts and product images keep their original keys.
export const cabochonImageKeyPattern = new RegExp(
  `^(?:cabochons|cabochon-imports)/images/${imageFile}$`,
);
// Keep existing imports under images/ readable without moving stored objects.
export const importSourceKeyPattern = new RegExp(
  `^(?:images|material-imports/sources)/${imageFile}$`,
);
export const importCropKeyPattern = new RegExp(`^(?:images|material-imports/crops)/${imageFile}$`);

export function imageStorageUrl(key: string, mode: 'local' | 'cos') {
  if (mode === 'local') return `/uploads/${key}`;
  return `/api/images/${key.startsWith('images/') ? key.slice('images/'.length) : key}`;
}

// Keep original URLs in stored data and in full-screen previews.
export function imageThumbnailUrl(url: string, width: 128 | 640 = 128) {
  const prefix = url.startsWith('/api/images/')
    ? '/api/images/'
    : url.startsWith('/uploads/')
      ? '/uploads/'
      : null;
  if (!prefix) return url;
  const key = url.slice(prefix.length);
  const objectKey = prefix === '/api/images/' && !key.includes('/') ? `images/${key}` : key;
  if (!imageObjectKeyPattern.test(objectKey)) return url;
  return `${imageStorageUrl(objectKey, 'cos')}?w=${width}`;
}
