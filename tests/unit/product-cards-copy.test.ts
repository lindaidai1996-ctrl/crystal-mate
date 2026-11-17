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
import { cardCopyConfiguration, cardCopySchema, generateCardCopy } from '@/lib/product-cards/copy';
const input = { displayName: '山月', mainMaterials: ['白水晶'], template: 'natural' as const };
const candidates = [
  '山有自己的沉静，月有自己的圆缺。愿你在忙碌与留白之间，找到适合自己的节奏。',
  '不必急着追上所有人的脚步，像山间的月色一样，在自己的位置，安静地照亮一小段路。',
  '把生活过得从容一些，让心事有处停泊。山与月相望的时候，寻常的一天也值得认真收藏。',
];
afterEach(() => vi.unstubAllEnvs());
function configured() {
  vi.stubEnv('PRODUCT_CARD_API_KEY', 'test-key');
  vi.stubEnv('PRODUCT_CARD_BASE_URL', 'https://api.deepseek.com');
}
describe('product card copy generation', () => {
  it('uses independent text-model configuration without falling back to the vision model', () => {
    expect(
      cardCopyConfiguration({ DEEPSEEK_API_KEY: 'test', DEEPSEEK_VISION_MODEL: 'vision-only' })
        .model,
    ).toBe('deepseek-flash');
    expect(() =>
      cardCopyConfiguration({
        PRODUCT_CARD_API_KEY: 'test',
        PRODUCT_CARD_BASE_URL: 'http://unsafe.test',
      }),
    ).toThrow('CARD_MODEL_NOT_CONFIGURED');
  });
  it('sends only public copy context and validates three distinct complete candidates', async () => {
    configured();
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates }) } }],
      }),
    );
    expect(
      await generateCardCopy(
        { ...input, quote: 'private', cost: 'private' } as typeof input,
        undefined,
        fetcher,
      ),
    ).toEqual({ candidates });
    const sent = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(JSON.parse(sent.messages[1].content)).toEqual(input);
    expect(sent.messages[1].content).not.toContain('private');
    expect(cardCopySchema.safeParse({ ...input, quote: 'untrusted' }).success).toBe(false);
  });
  it('preserves explicit failure states for timeouts, rate limits and invalid model responses', async () => {
    configured();
    await expect(
      generateCardCopy(
        input,
        undefined,
        vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')),
      ),
    ).rejects.toMatchObject({ code: 'CARD_MODEL_UNAVAILABLE' });
    await expect(
      generateCardCopy(
        input,
        undefined,
        vi.fn().mockResolvedValue(new Response('', { status: 429 })),
      ),
    ).rejects.toMatchObject({ code: 'CARD_MODEL_RATE_LIMIT' });
    for (const response of [
      { candidates: ['短', '短', '短'] },
      { candidates: [candidates[0], candidates[0], candidates[1]] },
    ]) {
      const fetcher = vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }],
        }),
      );
      await expect(generateCardCopy(input, undefined, fetcher)).rejects.toMatchObject({
        code: 'CARD_MODEL_INVALID_RESULT',
      });
    }
  });
});
