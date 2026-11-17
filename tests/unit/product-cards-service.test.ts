import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type ProductCard } from '@prisma/client';
import { cardFixtureAsset, cardFixtureInput, cardFixtureProduct } from '../fixtures/product-cards';

const mocks = vi.hoisted(() => ({
  findProduct: vi.fn(),
  findAsset: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  findSaved: vi.fn(),
  copy: vi.fn(),
  validateBrand: vi.fn(),
  transaction: vi.fn(),
}));
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
vi.mock('@/lib/db', () => ({
  db: {
    product: { findUnique: mocks.findProduct },
    productCardAsset: { findFirst: mocks.findAsset },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/products', () => ({
  productInclude: {},
  serializeProduct: (value: unknown) => value,
}));
vi.mock('@/lib/product-cards/assets', () => ({
  copyProductCardImage: mocks.copy,
  validateBrandAssets: mocks.validateBrand,
}));
import { prepareCard, saveCard, sourceForCard, viewCard } from '@/lib/product-cards/service';

function savedCard(): ProductCard {
  const input = cardFixtureInput();
  const source = sourceForCard(cardFixtureProduct(), 'run-one')!;
  const { runId, ...fields } = input;
  return {
    id: 'card-one',
    productId: 'product-one',
    runId,
    title: input.title,
    templateId: input.template,
    templateVersion: 1,
    version: 1,
    data: fields,
    quoteSnapshot: source.quote,
    sourceSnapshot: source.hashes,
    createdAt: new Date('2026-11-17T00:00:00Z'),
    updatedAt: new Date('2026-11-17T00:00:00Z'),
  } as unknown as ProductCard;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findProduct.mockResolvedValue(cardFixtureProduct());
  mocks.findAsset.mockResolvedValue({
    id: cardFixtureAsset,
    productId: 'product-one',
    kind: 'PRODUCT',
  });
  mocks.copy.mockResolvedValue({ id: cardFixtureAsset });
  mocks.validateBrand.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.create.mockResolvedValue(savedCard());
  mocks.findSaved.mockResolvedValue(savedCard());
  mocks.transaction.mockImplementation((operation) =>
    operation({
      product: { findUnique: mocks.findProduct },
      productCard: {
        updateMany: mocks.update,
        create: mocks.create,
        findUniqueOrThrow: mocks.findSaved,
      },
    }),
  );
});
describe('product card snapshots and ownership', () => {
  it('rejects a run that belongs to another product and private image assets from another product', async () => {
    await expect(
      prepareCard('product-one', { ...cardFixtureInput(), runId: 'foreign-run' }),
    ).rejects.toMatchObject({ code: 'CARD_SOURCE_REQUIRED' });
    mocks.findAsset.mockResolvedValue(null);
    await expect(prepareCard('product-one', cardFixtureInput())).rejects.toMatchObject({
      code: 'CARD_INVALID_SOURCE',
    });
    expect(mocks.findAsset).toHaveBeenCalledWith({
      where: { id: cardFixtureAsset, productId: 'product-one', kind: 'PRODUCT' },
    });
  });
  it('keeps the saved quote until the whole quote is explicitly refreshed', async () => {
    const current = savedCard();
    const changed = cardFixtureProduct();
    changed.diyRuns[0].perUnitQuote = '61.33';
    changed.diyRuns[0].totalQuote = '184.00';
    changed.diyRuns[0].extraCosts[0].quoteAmount = '3.00';
    mocks.findProduct.mockResolvedValue(changed);
    const kept = await prepareCard('product-one', { ...cardFixtureInput(), version: 1 }, current);
    expect(kept.data.quoteSnapshot).toEqual(current.quoteSnapshot);
    const refreshed = await prepareCard(
      'product-one',
      { ...cardFixtureInput(), version: 1, refresh: ['quote'] },
      current,
    );
    expect(refreshed.data.quoteSnapshot).toMatchObject({ total: '61.33' });
  });
  it('allows further custom edits after importing source text', async () => {
    const prepared = await prepareCard('product-one', {
      ...cardFixtureInput(),
      displayName: '自定义名字',
      mainMaterials: ['自定义展示'],
      refresh: ['name', 'materials'],
    });
    expect(prepared.fields.displayName).toBe('自定义名字');
    expect(prepared.fields.mainMaterials).toEqual(['自定义展示']);
    expect(prepared.data.sourceSnapshot).toEqual(
      sourceForCard(cardFixtureProduct(), 'run-one')!.hashes,
    );
  });
  it('rejects stale card and source revisions before saving', async () => {
    await expect(
      prepareCard('product-one', { ...cardFixtureInput(), version: 2 }, savedCard()),
    ).rejects.toMatchObject({ code: 'CARD_CONFLICT' });
    await expect(
      prepareCard('product-one', { ...cardFixtureInput(), expectedSourceHash: 'a'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'CARD_SOURCE_CHANGED' });
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(
      saveCard('product-one', { ...cardFixtureInput(), version: 1 }, savedCard()),
    ).rejects.toMatchObject({ code: 'CARD_CONFLICT' });
  });
  it('rechecks source facts after asset copying and before commit', async () => {
    const changed = cardFixtureProduct();
    changed.name = '另一个名字';
    mocks.findProduct.mockResolvedValueOnce(cardFixtureProduct()).mockResolvedValueOnce(changed);
    await expect(saveCard('product-one', cardFixtureInput())).rejects.toMatchObject({
      code: 'CARD_SOURCE_CHANGED',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('allows incomplete quotes without details and refuses them with details', async () => {
    const product = cardFixtureProduct();
    product.diyRuns[0].perUnitQuote = null;
    mocks.findProduct.mockResolvedValue(product);
    await expect(prepareCard('product-one', cardFixtureInput())).rejects.toMatchObject({
      code: 'CARD_QUOTE_INCOMPLETE',
    });
    const prepared = await prepareCard('product-one', {
      ...cardFixtureInput(),
      includeDetails: false,
    });
    expect(prepared.data.quoteSnapshot).toBe(Prisma.DbNull);
  });
  it('marks changed source facts and continues to read snapshots after source deletion', () => {
    const product = cardFixtureProduct();
    product.name = '新名字';
    const view = viewCard(savedCard(), product);
    expect(view.changed).toEqual(['name']);
    expect(view.displayName).toBe('山月');
    expect(view.quote?.total).toBe('60.33');
    const orphaned = viewCard({ ...savedCard(), runId: null }, product);
    expect(orphaned.source).toBeNull();
    expect(orphaned.quote?.total).toBe('60.33');
    expect(JSON.stringify(view)).not.toContain('内部');
  });
});
