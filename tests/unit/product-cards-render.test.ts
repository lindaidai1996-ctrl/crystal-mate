import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
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
import { renderProductCard } from '@/lib/product-cards/render';
import { cardFixtureAsset, cardFixtureInput, cardFixtureRun } from '../fixtures/product-cards';
import { cardQuote } from '@/lib/product-cards/quote';
import { cardTemplates } from '@/lib/product-cards/contracts';

describe('server PNG rendering', () => {
  it('renders each template with a transparent portrait and bundled Chinese fonts', async () => {
    const picture = await sharp({
      create: {
        width: 80,
        height: 140,
        channels: 4,
        background: { r: 90, g: 140, b: 100, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    for (const template of cardTemplates) {
      const png = await renderProductCard(
        {
          ...cardFixtureInput(),
          template,
          philosophy: '留一点从容给自己，让日常的微光照亮前行的路。',
          includeDetails: false,
        },
        null,
        new Map([[cardFixtureAsset, picture]]),
      );
      const metadata = await sharp(png).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.width).toBe(1080);
      expect(metadata.height).toBeGreaterThan(630);
      expect(metadata.height).toBeLessThan(1440);
    }
  }, 20000);
  it('reports missing and invalid private images instead of producing a partial card', async () => {
    await expect(
      renderProductCard(cardFixtureInput(), cardQuote(cardFixtureRun()), new Map()),
    ).rejects.toMatchObject({ code: 'CARD_IMAGE_UNAVAILABLE' });
    await expect(
      renderProductCard(
        cardFixtureInput(),
        cardQuote(cardFixtureRun()),
        new Map([[cardFixtureAsset, Buffer.from('not an image')]]),
      ),
    ).rejects.toMatchObject({ code: 'CARD_IMAGE_UNAVAILABLE' });
  });
  it('rejects unavailable quotes and unknown template versions', async () => {
    await expect(renderProductCard(cardFixtureInput(), null, new Map())).rejects.toMatchObject({
      code: 'CARD_QUOTE_INCOMPLETE',
    });
    await expect(renderProductCard(cardFixtureInput(), null, new Map(), 999)).rejects.toMatchObject(
      { code: 'CARD_TEMPLATE_UNSUPPORTED' },
    );
  });
  it('rejects excessive output height before rasterizing an unreadable image', async () => {
    const picture = await sharp({
      create: { width: 40, height: 40, channels: 3, background: '#abc' },
    })
      .png()
      .toBuffer();
    const row = {
      name: '长物料名称用于测试容量边界'.repeat(10),
      specification: '规格说明'.repeat(20),
      quantity: '100 颗',
      unitPrice: '1.00',
      subtotal: '100.00',
    };
    await expect(
      renderProductCard(
        cardFixtureInput(),
        { currency: 'CNY', rows: Array(100).fill(row), total: '10000.00', craftAllocated: false },
        new Map([[cardFixtureAsset, picture]]),
      ),
    ).rejects.toMatchObject({ code: 'CARD_CAPACITY_EXCEEDED' });
  }, 20000);
});
