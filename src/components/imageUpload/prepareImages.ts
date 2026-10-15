export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

const TARGET_BYTES = 1024 * 1024;
const MAX_EDGES = [1920, 1600, 1280, 1024];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type PreparedImage = {
  original: File;
  compressed: File | null;
  error?: 'invalid' | 'tooLarge' | 'compressionFailed' | 'compressedTooLarge';
  unchanged?: boolean;
};

function encodeWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size === 0 || blob.type !== 'image/webp')
          reject(new Error('WEBP_UNAVAILABLE'));
        else resolve(blob);
      },
      'image/webp',
      quality,
    );
  });
}

export async function prepareImage(original: File): Promise<PreparedImage> {
  if (!IMAGE_TYPES.includes(original.type) || original.size < 1)
    return { original, compressed: null, error: 'invalid' };
  if (original.size > MAX_SOURCE_BYTES) return { original, compressed: null, error: 'tooLarge' };

  try {
    const bitmap = await createImageBitmap(original);
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('CANVAS_UNAVAILABLE');

      let blob: Blob | null = null;
      for (const maxEdge of MAX_EDGES) {
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        if (canvas.width === width && canvas.height === height) continue;
        canvas.width = width;
        canvas.height = height;
        context.drawImage(bitmap, 0, 0, width, height);
        for (const quality of [0.8, 0.65, 0.5, 0.35]) {
          const candidate = await encodeWebp(canvas, quality);
          if (!blob || candidate.size < blob.size) blob = candidate;
          if (candidate.size <= TARGET_BYTES) break;
        }
        if (blob && blob.size <= TARGET_BYTES) break;
      }
      if (!blob) throw new Error('ENCODE_FAILED');
      if (blob.size >= original.size) {
        return {
          original,
          compressed: original.size <= MAX_UPLOAD_BYTES ? original : null,
          error: original.size > MAX_UPLOAD_BYTES ? 'compressedTooLarge' : undefined,
          unchanged: original.size <= MAX_UPLOAD_BYTES,
        };
      }
      if (blob.size > MAX_UPLOAD_BYTES)
        return { original, compressed: null, error: 'compressedTooLarge' };

      const baseName = original.name.replace(/\.[^.]+$/, '');
      return {
        original,
        compressed: new File([blob], `${baseName}.webp`, { type: 'image/webp' }),
      };
    } finally {
      bitmap.close();
    }
  } catch {
    return { original, compressed: null, error: 'compressionFailed' };
  }
}

export function formatImageBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
