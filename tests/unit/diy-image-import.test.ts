import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
import {
  diySaveSchema,
  diySource,
  emptyDiyData,
  mergeDiyRecognition,
  newDiyPart,
  patchDiyPart,
} from '@/lib/diyImageImport/contracts';
import { callDiyVision, parseDiyDetection } from '@/lib/diyImageImport/vision';
import { rankDiyCandidates } from '@/lib/diyImageImport/matching';
import { calculateDiyCost } from '@/lib/product-diy-cost';

const materialId = 'clx1234567890123456789012';
const batchId = 'clx1234567890123456789013';
const imageId = crypto.randomUUID();
const box = { x: 100, y: 100, width: 200, height: 200 };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function completePart() {
  return {
    ...newDiyPart(),
    name: '白水晶配珠',
    materialId,
    materialBatchEntryId: batchId,
    quantity: '12',
    unitCost: '1.25',
    reviewed: true,
    views: [{ imageId, box }],
  };
}
describe('DIY image review contracts', () => {
  it('requires explicit review, a real selection, and a known cost; excluded errors do not count', () => {
    const data = { ...emptyDiyData(), quantity: 3, parts: [completePart()] };
    expect(calculateDiyCost(diySource(data)!)).toEqual({
      perUnitCost: '15.00',
      totalCost: '45.00',
    });
    expect(diySource({ ...data, parts: [{ ...completePart(), reviewed: false }] })).toBeNull();
    expect(diySource({ ...data, parts: [{ ...completePart(), unitCost: '' }] })).toBeNull();
    expect(
      diySource({ ...data, parts: [{ ...completePart(), materialBatchEntryId: null }] }),
    ).toBeNull();
    expect(diySource({ ...data, parts: [{ ...completePart(), quantity: '1.5' }] })).toBeNull();
    expect(
      diySource({ ...data, parts: [{ ...completePart(), usageUnit: 'GRAM', quantity: '1.5' }] }),
    ).not.toBeNull();
    expect(
      diySource({ ...data, parts: [completePart(), { ...newDiyPart(), excluded: true }] }),
    ).not.toBeNull();
    expect(diySource({ ...data, parts: [{ ...completePart(), excluded: true }] })).toBeNull();
    expect(diySource({ ...data, parts: [{ ...completePart(), unitCost: '0' }] })).not.toBeNull();
  });
  it('invalidates confirmations after quantity, cost, selection or evidence edits', () => {
    const part = completePart();
    for (const patch of [
      { quantity: '13' },
      { unitCost: '2' },
      { views: [] },
      { materialBatchEntryId: null },
    ])
      expect(patchDiyPart(part, patch).reviewed).toBe(false);
    expect(patchDiyPart(part, { reviewed: true }).reviewed).toBe(true);
  });
  it('preserves confirmed and excluded parts on a full run without repeating overlapping evidence', () => {
    const confirmed = completePart();
    const excluded = { ...newDiyPart(), excluded: true };
    const fresh = { ...newDiyPart(), name: '扣头', views: [{ imageId, box: { ...box, x: 700 } }] };
    const result = mergeDiyRecognition(
      [confirmed, excluded, newDiyPart()],
      [completePart(), fresh],
    );
    expect(result).toEqual([confirmed, excluded, fresh]);
  });
  it('targeted recognition leaves every other part untouched and keeps the selected ID', () => {
    const confirmed = completePart();
    const target = { ...newDiyPart(), name: '待识别' };
    const replacement = { ...newDiyPart(), name: '隔片' };
    expect(mergeDiyRecognition([confirmed, target], [replacement], target.id)).toEqual([
      confirmed,
      { ...replacement, id: target.id },
    ]);
    expect(mergeDiyRecognition([confirmed], [replacement], confirmed.id)).toEqual([confirmed]);
  });
  it('rejects duplicate part identities, reused photos, and unrelated image evidence', () => {
    const image = {
      id: imageId,
      objectKey: `images/${crypto.randomUUID()}.png`,
      url: '/source.png',
      fileName: 'x.png',
      width: 100,
      height: 100,
    };
    const part = completePart();
    const input = { version: 0, images: [image], data: { ...emptyDiyData(), parts: [part] } };
    expect(diySaveSchema.safeParse(input).success).toBe(true);
    expect(diySaveSchema.safeParse({ ...input, images: [image, image] }).success).toBe(false);
    expect(
      diySaveSchema.safeParse({ ...input, data: { ...input.data, parts: [part, part] } }).success,
    ).toBe(false);
    expect(
      diySaveSchema.safeParse({
        ...input,
        data: {
          ...input.data,
          parts: [{ ...part, views: [{ imageId: crypto.randomUUID(), box }] }],
        },
      }).success,
    ).toBe(false);
  });
});
describe('multi-view detection and catalog matching', () => {
  const detection = {
    name: '主珠',
    description: '蓝色圆珠，材质待确认',
    searchTerms: ['海纹石'],
    quantity: 1,
    views: [{ imageId, box }],
    warnings: [],
  };
  it('uses one component and one quantity for evidence from multiple photos', () => {
    const second = crypto.randomUUID();
    const result = parseDiyDetection(
      {
        parts: [{ ...detection, views: [...detection.views, { imageId: second, box }] }],
        warnings: [],
      },
      [{ id: imageId }, { id: second }],
    );
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({
      quantity: '1',
      reviewed: false,
      materialBatchEntryId: null,
      unitCost: '',
    });
    expect(result.parts[0].views).toHaveLength(2);
    expect(
      parseDiyDetection({ parts: [{ ...detection, quantity: null }], warnings: [] }, [
        { id: imageId },
      ]).parts[0].quantity,
    ).toBe('');
  });
  it('rejects image IDs and geometry that do not belong to the supplied evidence', () => {
    expect(() => parseDiyDetection({ parts: [detection], warnings: [] }, [])).toThrow(
      'IMPORT_MODEL_INVALID_RESULT',
    );
    expect(() =>
      parseDiyDetection(
        { parts: [{ ...detection, views: [{ imageId, box: { ...box, x: 950 } }] }], warnings: [] },
        [{ id: imageId }],
      ),
    ).toThrow();
    expect(() =>
      parseDiyDetection(
        {
          parts: [{ ...detection, views: [detection.views[0], detection.views[0]] }],
          warnings: [],
        },
        [{ id: imageId }],
      ),
    ).toThrow();
  });
  it('retrieves aliases and returns no candidate when catalog metadata has no match', () => {
    const catalog = [
      {
        id: materialId,
        kind: 'MATERIAL' as const,
        name: '蓝色圆珠',
        aliases: ['海纹石'],
        category: '圆珠',
        imageKey: null,
      },
    ];
    expect(rankDiyCandidates({ name: '主珠', searchTerms: ['海纹石'] }, catalog)[0]).toMatchObject({
      id: materialId,
    });
    expect(rankDiyCandidates({ name: '银扣', searchTerms: ['银扣'] }, catalog)).toEqual([]);
  });
});

describe('vision transport', () => {
  function configure() {
    vi.stubEnv('IMPORT_VISION_BASE_URL', 'https://vision.example/v1');
    vi.stubEnv('IMPORT_VISION_MODEL', 'test-vision');
    vi.stubEnv('IMPORT_VISION_API_KEY', 'fixture');
  }
  it('sends every view in one request and accepts a complete structured response', async () => {
    configure();
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: '{"parts":[],"warnings":[]}' } }],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const images = [imageId, crypto.randomUUID()].map((id) => ({
      id,
      bytes: Buffer.from('fixture'),
      mimeType: 'image/png',
    }));
    expect(await callDiyVision('compatible', 'test prompt', images)).toEqual({
      result: { parts: [], warnings: [] },
      model: 'test-vision',
    });
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(
      request.messages[0].content.filter((item: { type: string }) => item.type === 'image_url'),
    ).toHaveLength(2);
    expect(fetch.mock.calls[0][0]).toBe('https://vision.example/v1/chat/completions');
  });
  it('rejects truncated model output and propagates rate limiting without inventing rows', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
          ),
        )
        .mockResolvedValueOnce(new Response('{}', { status: 429 })),
    );
    await expect(callDiyVision('compatible', 'test', [])).rejects.toThrow(
      'IMPORT_MODEL_INVALID_RESULT',
    );
    await expect(callDiyVision('compatible', 'test', [])).rejects.toThrow(
      'IMPORT_MODEL_RATE_LIMIT',
    );
  });
});
