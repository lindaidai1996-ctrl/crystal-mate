import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SOURCE_BYTES, prepareImage } from '../../src/components/imageUpload/prepareImages';

afterEach(() => vi.unstubAllGlobals());

function mockCanvas(encoded: Blob) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (callback: (blob: Blob) => void) => callback(encoded),
  };
  const close = vi.fn();
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('createImageBitmap', async () => ({ width: 3000, height: 1500, close }));
  return { canvas, close };
}

describe('image preparation', () => {
  it('rejects unsupported and oversized sources before decoding', async () => {
    expect((await prepareImage(new File(['x'], 'x.gif', { type: 'image/gif' }))).error).toBe(
      'invalid',
    );
    expect(
      (
        await prepareImage(
          new File([new Uint8Array(MAX_SOURCE_BYTES + 1)], 'large.png', { type: 'image/png' }),
        )
      ).error,
    ).toBe('tooLarge');
  });

  it('resizes and returns a smaller WebP file with the matching extension', async () => {
    const { canvas, close } = mockCanvas(new Blob([new Uint8Array(40)], { type: 'image/webp' }));
    const result = await prepareImage(
      new File([new Uint8Array(100)], 'invoice.png', {
        type: 'image/png',
      }),
    );
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(960);
    expect(result.compressed).toMatchObject({ name: 'invoice.webp', type: 'image/webp', size: 40 });
    expect(close).toHaveBeenCalledOnce();
  });

  it('retains a smaller original when re-encoding does not help', async () => {
    mockCanvas(new Blob([new Uint8Array(200)], { type: 'image/webp' }));
    const original = new File([new Uint8Array(100)], 'small.png', { type: 'image/png' });
    const result = await prepareImage(original);
    expect(result.compressed).toBe(original);
    expect(result.unchanged).toBe(true);
  });

  it('reduces dimensions when quality adjustments cannot reach the size target', async () => {
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }) } as {
      width: number;
      height: number;
      getContext: () => { drawImage: ReturnType<typeof vi.fn> };
      toBlob?: (callback: (blob: Blob) => void) => void;
    };
    canvas.toBlob = (callback) =>
      callback(
        new Blob([new Uint8Array(canvas.width === 1920 ? 2 * 1024 * 1024 : 800 * 1024)], {
          type: 'image/webp',
        }),
      );
    vi.stubGlobal('document', { createElement: () => canvas });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 3000, height: 1500, close: vi.fn() }));
    const result = await prepareImage(
      new File([new Uint8Array(3 * 1024 * 1024)], 'detailed.jpg', { type: 'image/jpeg' }),
    );
    expect(canvas.width).toBe(1600);
    expect(result.compressed?.size).toBe(800 * 1024);
  });

  it('reports compression failure and permits the dialog to offer the original', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('decode failed');
    });
    const result = await prepareImage(new File(['x'], 'broken.png', { type: 'image/png' }));
    expect(result).toMatchObject({ compressed: null, error: 'compressionFailed' });
  });
});
