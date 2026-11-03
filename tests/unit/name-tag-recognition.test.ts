import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { recognizeNameTags } from '@/lib/ai/nameTagRecognition';

const names = ['粉异象玫瑰胶花', '粉云母共生绿幽灵', '粉色晶中晶共生兔毛'];
const tags = [
  '胶花',
  '粉胶花',
  '云母',
  '粉云母',
  '共生水晶',
  '绿幽灵',
  '晶中晶',
  '兔毛',
  '粉幽灵',
  '粉兔毛',
].map((name) => ({ id: name, name }));
const envelope = (matches: unknown, finish_reason = 'stop') =>
  Response.json({
    choices: [{ finish_reason, message: { content: JSON.stringify({ matches }) } }],
  });
const match = (index: number, tagIds: string[]) => ({ index, tagIds, missingTags: [] });
beforeEach(() => {
  for (const key of [
    'TAG_RECOGNITION_API_KEY',
    'TAG_RECOGNITION_BASE_URL',
    'TAG_RECOGNITION_MODEL',
    'DEEPSEEK_VISION_MODEL',
    'DEEPSEEK_BASE_URL',
  ])
    vi.stubEnv(key, '');
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('shared name tag model adapter', () => {
  it('maps unordered batch results back to inputs, validates IDs and supplements base types', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        envelope([
          match(2, ['晶中晶', '兔毛', '共生水晶']),
          match(0, ['粉胶花']),
          match(1, ['粉云母', '共生水晶', '绿幽灵']),
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    const results = await recognizeNameTags(names, tags);
    expect(results[0].tagIds).toEqual(['粉胶花', '胶花']);
    expect(results[1]).toEqual({
      tagIds: ['粉云母', '共生水晶', '绿幽灵', '云母'],
      missingTags: ['幽灵'],
    });
    expect(results[2].tagIds).toEqual(['晶中晶', '兔毛', '共生水晶']);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('不能无依据推断粉兔毛');
    expect(JSON.parse(body.messages[1].content)).toEqual({
      names: names.map((name, index) => ({ index, name })),
      tags,
    });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
  });
  it.each([
    [match(0, ['invented-id'])],
    [match(1, ['胶花'])],
    [],
    [match(0, ['胶花']), match(0, ['粉胶花'])],
  ])(
    'rejects unknown IDs, missing inputs and duplicate or invalid indexes: %j',
    async (...matches) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(matches)));
      await expect(recognizeNameTags([names[0]], tags)).rejects.toThrow('TAG_MODEL_INVALID_RESULT');
    },
  );
  it('does not send requests without credentials or without a tag library', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    await expect(recognizeNameTags(names, tags)).rejects.toThrow('TAG_MODEL_NOT_CONFIGURED');
    expect(await recognizeNameTags(names, [])).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('supports independent text-model configuration without exposing credentials in input data', async () => {
    vi.stubEnv('TAG_RECOGNITION_API_KEY', 'text-secret');
    vi.stubEnv('TAG_RECOGNITION_BASE_URL', 'https://text.example.test/v1');
    vi.stubEnv('TAG_RECOGNITION_MODEL', 'text-model');
    const fetchMock = vi.fn().mockResolvedValue(envelope([match(0, ['粉胶花'])]));
    vi.stubGlobal('fetch', fetchMock);
    await recognizeNameTags([names[0]], tags);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://text.example.test/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer text-secret');
    expect(JSON.parse(init.body).model).toBe('text-model');
    expect(init.body).not.toContain('text-secret');
    expect(JSON.parse(init.body).thinking).toBeUndefined();
  });
  it('handles rate limits, network failures, malformed JSON and truncated results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(envelope([match(0, ['胶花'])], 'length'))
      .mockResolvedValueOnce(
        Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'not-json' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);
    for (const error of [
      'TAG_MODEL_RATE_LIMIT',
      'TAG_MODEL_UNAVAILABLE',
      'TAG_MODEL_INVALID_RESULT',
      'TAG_MODEL_INVALID_RESULT',
    ]) {
      await expect(recognizeNameTags([names[0]], tags)).rejects.toThrow(error);
    }
  });
});
