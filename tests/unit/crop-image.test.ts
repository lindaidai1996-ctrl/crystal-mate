import { afterEach, describe, expect, it, vi } from 'vitest';
import { cropImage } from '../../src/components/imageUpload/cropImage';

afterEach(() => vi.unstubAllGlobals());

function setup(blob: Blob | null = new Blob(['pixels'], { type: 'image/png' })) {
  const context = { translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn() };
  let exportedSize: number[] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob(callback: (result: Blob | null) => void) {
      exportedSize = [canvas.width, canvas.height];
      callback(blob);
    },
  };
  const bitmap = { width: 400, height: 200, close: vi.fn() };
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap),
  );
  vi.stubGlobal('document', { createElement: () => canvas });
  return { context, bitmap, canvas, exportedSize: () => exportedSize };
}

const file = new File(['jpeg'], 'jewel.jpg', { type: 'image/jpeg' });

describe('image crop export', () => {
  it('exports exactly the selected source pixels as lossless PNG with a matching name', async () => {
    const { context, exportedSize, canvas, bitmap } = setup();
    const result = await cropImage(file, { x: 100, y: 50, width: 200, height: 100 }, 0);
    expect(exportedSize()).toEqual([200, 100]);
    expect(context.translate).toHaveBeenCalledWith(100, 50);
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, -200, -100);
    expect(result).toMatchObject({ name: 'jewel.png', type: 'image/png' });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });

  it('uses the rotated bounding box for a 90 degree crop', async () => {
    const { context, exportedSize } = setup();
    await cropImage(file, { x: 10, y: 20, width: 100, height: 200 }, 90);
    expect(context.translate.mock.calls[0][0]).toBeCloseTo(90);
    expect(context.translate.mock.calls[0][1]).toBeCloseTo(180);
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(exportedSize()).toEqual([100, 200]);
  });

  it('releases the bitmap and canvas when encoding fails', async () => {
    const { bitmap, canvas } = setup(null);
    await expect(cropImage(file, { x: 0, y: 0, width: 100, height: 100 }, 0)).rejects.toThrow(
      'CROP_ENCODE_FAILED',
    );
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });

  it('rejects an empty crop before allocating bitmap memory', async () => {
    setup();
    await expect(cropImage(file, { x: 0, y: 0, width: 0, height: 100 }, 0)).rejects.toThrow(
      'INVALID_CROP',
    );
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
});
