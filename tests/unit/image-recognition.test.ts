import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
import {
  imageRecognitionModels,
  parseImageRecognition,
  recognizeImage,
} from '@/lib/ai/imageRecognition';
import { importBoxSchema, readPrice } from '@/lib/materialImageImport/contracts';

const objectBox = { x: 100, y: 100, width: 80, height: 120 };
const priceBox = { x: 100, y: 230, width: 80, height: 50 };
const result = (priceText = '4.5') =>
  JSON.stringify({
    items: [{ objectBox, priceBox, priceText, warnings: [] }],
    warnings: [],
  });

beforeEach(() => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-secret');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('image price extraction', () => {
  it('preserves decimal prices and rejects ambiguous or partial numbers', () => {
    expect(readPrice('￥４.５０元')).toBe('4.50');
    expect(readPrice('0')).toBe('0');
    for (const text of ['4.5 or 9.5', '4 5', '4,5', '-5', '5.123', '', 'price: 10'])
      expect(readPrice(text)).toBeNull();
  });

  it('defaults quantity to one and requires human review even when recognition succeeds', () => {
    const parsed = parseImageRecognition(result(), 'SALE');
    expect(parsed.items[0]).toMatchObject({
      priceText: '4.5',
      price: '4.5',
      quantity: 1,
      reviewed: false,
      priceKind: 'SALE',
      name: '',
    });
  });

  it('keeps uncertain evidence and flags overlapping jewelry boxes', () => {
    const parsed = parseImageRecognition(
      JSON.stringify({
        items: [
          { objectBox, priceBox: null, priceText: '4.5 or 9.5', warnings: ['数字模糊'] },
          { objectBox, priceBox, priceText: '10', warnings: [] },
        ],
        warnings: [],
      }),
      'PURCHASE',
    );
    expect(parsed.items[0].price).toBeNull();
    expect(parsed.items[0].warnings.join(' ')).toContain('重复识别');
    expect(parsed.items[0].priceText).toBe('4.5 or 9.5');
  });

  it('adds margin to both jewelry and price crops while preserving the recognized price', () => {
    const parsed = parseImageRecognition(result(), 'PURCHASE');
    expect(parsed.items[0]).toMatchObject({
      objectBox: { x: 88, y: 82, width: 104, height: 156 },
      priceBox: { x: 88, y: 222, width: 104, height: 66 },
      priceText: '4.5',
      price: '4.5',
    });
  });

  it.each([
    { x: 0, y: 0, width: 80, height: 120 },
    { x: 920, y: 880, width: 80, height: 120 },
    { x: 0, y: 0, width: 1000, height: 1000 },
    { x: 998.5, y: 998.5, width: 1.5, height: 1.5 },
  ])('keeps padded crops within the source at its edges: %j', (box) => {
    const parsed = parseImageRecognition(
      JSON.stringify({
        items: [{ objectBox: box, priceBox: box, priceText: '10', warnings: [] }],
        warnings: [],
      }),
      'PURCHASE',
    );
    for (const crop of [parsed.items[0].objectBox, parsed.items[0].priceBox!]) {
      expect(importBoxSchema.safeParse(crop).success).toBe(true);
      expect(crop.x).toBeLessThanOrEqual(box.x);
      expect(crop.y).toBeLessThanOrEqual(box.y);
      expect(crop.x + crop.width).toBeGreaterThanOrEqual(box.x + box.width);
      expect(crop.y + crop.height).toBeGreaterThanOrEqual(box.y + box.height);
    }
  });

  it('leaves room around tiny crops and keeps missing price regions absent', () => {
    const parsed = parseImageRecognition(
      JSON.stringify({
        items: [
          {
            objectBox: { x: 100, y: 200, width: 2, height: 3 },
            priceBox: null,
            priceText: '',
            warnings: [],
          },
        ],
        warnings: [],
      }),
      'PURCHASE',
    );
    expect(parsed.items[0].objectBox).toEqual({ x: 95, y: 195, width: 12, height: 13 });
    expect(parsed.items[0].priceBox).toBeNull();
  });

  it('rejects coordinates outside the original image rather than producing a wrong crop', () => {
    expect(() =>
      parseImageRecognition(
        JSON.stringify({
          items: [{ objectBox: { ...objectBox, x: 990 }, priceBox, priceText: '10', warnings: [] }],
          warnings: [],
        }),
        'PURCHASE',
      ),
    ).toThrow('IMPORT_MODEL_INVALID_RESULT');
  });
});

describe('replaceable image model adapter', () => {
  it('limits single-item recognition to the selected regions and retains the user boxes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: result('25') } }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const target = { objectBox: { x: 300, y: 200, width: 100, height: 200 }, priceBox };
    const parsed = await recognizeImage(
      'deepseek',
      { bytes: Buffer.from('source'), mimeType: 'image/png' },
      'PURCHASE',
      target,
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content[0].text).toContain('ONLY for ONE user-selected item');
    expect(body.messages[0].content[0].text).toContain(JSON.stringify(target.objectBox));
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({ ...target, price: '25' });
  });

  it.each([0, 2])('rejects %i results for a single-item request', async (count) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  items: Array.from({ length: count }, () => ({
                    objectBox,
                    priceBox,
                    priceText: '5',
                    warnings: [],
                  })),
                  warnings: [],
                }),
              },
            },
          ],
        }),
      ),
    );
    await expect(
      recognizeImage(
        'deepseek',
        { bytes: Buffer.from('source'), mimeType: 'image/png' },
        'PURCHASE',
        { objectBox, priceBox },
      ),
    ).rejects.toThrow('IMPORT_SINGLE_RESULT_REQUIRED');
  });

  it('uses the current DeepSeek vision model and sends image bytes only from the server', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: result() } }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await recognizeImage(
      'deepseek',
      { bytes: Buffer.from('image'), mimeType: 'image/png' },
      'PURCHASE',
    );
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('deepseek-flash');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/png;base64,aW1hZ2U=');
    expect(JSON.stringify(imageRecognitionModels())).not.toContain('test-secret');
  });

  it('switches to a configured compatible provider without changing extraction contracts', async () => {
    vi.stubEnv('IMPORT_VISION_BASE_URL', 'https://vision.example.test/v1');
    vi.stubEnv('IMPORT_VISION_MODEL', 'vision-test');
    vi.stubEnv('IMPORT_VISION_API_KEY', 'other-secret');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ choices: [{ finish_reason: 'stop', message: { content: result() } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const parsed = await recognizeImage(
      'compatible',
      { bytes: Buffer.from('x'), mimeType: 'image/png' },
      'SALE',
    );
    expect(fetchMock.mock.calls[0][0]).toBe('https://vision.example.test/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).thinking).toBeUndefined();
    expect(parsed).toMatchObject({
      model: 'vision-test',
      items: [{ priceKind: 'SALE', price: '4.5' }],
    });
  });

  it('rejects unconfigured providers before sending data and handles truncation and rate limits', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      recognizeImage('unknown', { bytes: Buffer.from('x'), mimeType: 'image/png' }, 'PURCHASE'),
    ).rejects.toThrow('IMPORT_MODEL_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(
      Response.json({ choices: [{ finish_reason: 'length', message: { content: result() } }] }),
    );
    await expect(
      recognizeImage('deepseek', { bytes: Buffer.from('x'), mimeType: 'image/png' }, 'PURCHASE'),
    ).rejects.toThrow('IMPORT_MODEL_INVALID_RESULT');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await expect(
      recognizeImage('deepseek', { bytes: Buffer.from('x'), mimeType: 'image/png' }, 'PURCHASE'),
    ).rejects.toThrow('IMPORT_MODEL_RATE_LIMIT');
  });
});
