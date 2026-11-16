import { describe, expect, it } from 'vitest';
import {
  imageFramingSchema,
  imageFramingStyle,
  imageFramings,
  readImageFraming,
} from '../../src/lib/image-framing';
import { materialCreateSchema, productSchema } from '../../src/lib/validation';
import { gramPayload, gramValues } from '../fixtures/material-gram';
import { importMaterialDraftSchema } from '../../src/lib/materialImageImport/contracts';

describe('responsive image framing', () => {
  it('uses centered cover for existing images and supports whole-image display', () => {
    expect(readImageFraming(null)).toBeNull();
    expect(readImageFraming({ mode: 'invalid' })).toBeNull();
    expect(imageFramingStyle()).toMatchObject({ objectFit: 'cover', width: '100%', left: 0 });
    expect(imageFramingStyle({ mode: 'contain' })).toMatchObject({ objectFit: 'contain' });
  });

  it.each([
    [1000, 2000, { x: 0, y: 30, width: 100, height: 50 }],
    [2000, 1000, { x: 30, y: 0, width: 50, height: 100 }],
    [1000, 2000, { x: 20, y: 40, width: 50, height: 25 }],
  ])('shows the same undistorted crop of a %s × %s image at every thumbnail size', (w, h, crop) => {
    const style = imageFramingStyle({ mode: 'cover', crop });
    for (const side of [44, 64, 76, 170, 320]) {
      const width = (parseFloat(String(style.width)) / 100) * side;
      const height = (parseFloat(String(style.height)) / 100) * side;
      const left = (parseFloat(String(style.left)) / 100) * side;
      const top = (parseFloat(String(style.top)) / 100) * side;
      expect(width / height).toBeCloseTo(w / h);
      expect(left + (crop.x / 100) * width).toBeCloseTo(0);
      expect(top + (crop.y / 100) * height).toBeCloseTo(0);
      expect((crop.width / 100) * width).toBeCloseTo(side);
      expect((crop.height / 100) * height).toBeCloseTo(side);
    }
  });

  it('rejects empty, out-of-bounds and nonfinite crops before saving', () => {
    for (const crop of [
      { x: -1, y: 0, width: 50, height: 50 },
      { x: 90, y: 0, width: 50, height: 50 },
      { x: 0, y: 75, width: 50, height: 50 },
      { x: 0, y: 0, width: 0, height: 50 },
      { x: NaN, y: 0, width: 50, height: 50 },
    ])
      expect(imageFramingSchema.safeParse({ mode: 'cover', crop }).success).toBe(false);
  });

  it('carries framing through product, material and recognition draft validation', () => {
    const objectKey = 'images/00000000-0000-4000-8000-000000000001.jpg';
    const image = {
      objectKey,
      url: '/uploads/' + objectKey,
      position: 0,
      framing: { mode: 'contain' as const },
    };
    const imageSettings = { imageKeys: [objectKey], imageFramings: imageFramings([image]) };
    const material = gramPayload();
    expect(
      materialCreateSchema.parse({ ...material, values: { ...material.values, ...imageSettings } })
        .values.imageFramings,
    ).toEqual({ [objectKey]: image.framing });
    const product = productSchema.parse({
      name: '手链',
      code: 'A0001',
      description: '',
      categoryId: material.values.categoryId,
      priceCents: 100,
      currency: 'CNY',
      stock: 1,
      published: false,
      ...imageSettings,
    });
    expect(product.imageFramings).toEqual(imageSettings.imageFramings);
    const draft = importMaterialDraftSchema.parse({
      values: gramValues(),
      purchase: material.purchase,
      quantityUnknown: false,
      tagIds: [],
      images: [image],
    });
    expect(draft.images[0].framing).toEqual(image.framing);
  });
});
