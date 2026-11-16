import { z } from 'zod';
import type { CSSProperties } from 'react';
import { imageObjectKeyPattern } from './image-storage';

const cropSchema = z
  .strictObject({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    width: z.number().positive().max(100),
    height: z.number().positive().max(100),
  })
  .refine((crop) => crop.x + crop.width <= 100.001 && crop.y + crop.height <= 100.001);

// Percentages of the original image make the same square crop work at every size.
export const imageFramingSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('cover'), crop: cropSchema.optional() }),
  z.strictObject({ mode: z.literal('contain') }),
]);

export type ImageFraming = z.infer<typeof imageFramingSchema>;
export type FramedImage = { framing?: ImageFraming | null };

export const imageFramingsSchema = z
  .record(z.string().regex(imageObjectKeyPattern), imageFramingSchema)
  .refine((framings) => Object.keys(framings).length <= 12);

export function readImageFraming(value: unknown): ImageFraming | null {
  const parsed = imageFramingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function imageFramings(images: (FramedImage & { objectKey: string })[]) {
  return Object.fromEntries(
    images.flatMap((image) => (image.framing ? [[image.objectKey, image.framing]] : [])),
  );
}

export function imageFramingStyle(framing?: ImageFraming | null): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: '100%',
    maxWidth: 'none',
    left: 0,
    top: 0,
    border: 0,
    borderRadius: 0,
    objectFit: framing?.mode === 'contain' ? 'contain' : 'cover',
  };
  if (framing?.mode !== 'cover' || !framing.crop) return base;
  const { x, y, width, height } = framing.crop;
  return {
    ...base,
    width: `${10000 / width}%`,
    height: `${10000 / height}%`,
    left: `${(-100 * x) / width}%`,
    top: `${(-100 * y) / height}%`,
    objectFit: 'fill',
  };
}

export function serializeImageFraming<T extends { framing?: unknown }>(image: T) {
  return { ...image, framing: readImageFraming(image.framing) };
}
