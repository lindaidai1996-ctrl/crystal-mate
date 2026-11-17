import type { Product, ProductDiyRun } from '@/lib/client-types';
import { emptyCardBrand, type CardSaveInput } from '@/lib/product-cards/contracts';

export const cardFixtureAsset = '11111111-1111-4111-8111-111111111111';
export function cardFixtureRun(): ProductDiyRun {
  return {
    id: 'run-one',
    quantity: 3,
    perUnitCost: '2.20',
    totalCost: '6.60',
    perUnitQuote: '60.33',
    totalQuote: '181.00',
    craftDesignFee: { unitAmount: '100.00', accumulateByQuantity: false, totalAmount: null },
    silverCost: { weightGrams: '0.00', costGramPrice: '20.00', quoteGramPrice: '30.00' },
    extraCosts: [{ name: '包装', amount: '0.20', quoteAmount: '2.00' }],
    notes: '绝不能导出的内部备注',
    createdAt: '2026-11-17T00:00:00.000Z',
    materialLines: [
      {
        id: 'line-one',
        materialBatchEntryId: 'entry-one',
        usageUnit: 'BEAD',
        quantity: '2.00',
        unitCost: '1.00',
        lineCost: '2.00',
        quoteUnitPrice: '12.50',
        quoteLineTotal: '25.00',
        quoteSnapshot: { name: '白水晶', lengthMm: '8', widthMm: '8', heightMm: '8' },
        materialBatchEntry: {
          material: { name: '白水晶', unit: 'BEAD' },
          distributor: { name: '内部供货商' },
        },
      },
    ],
    cabochonLines: [],
  } as unknown as ProductDiyRun;
}
export function cardFixtureProduct(): Product {
  return {
    id: 'product-one',
    name: '山月',
    code: 'TEST-ONE',
    origin: 'DIY',
    currency: 'CNY',
    diyRuns: [cardFixtureRun()],
    images: [
      {
        id: 'image-one',
        objectKey: `images/${cardFixtureAsset}.jpg`,
        url: '/api/images/example.jpg',
        position: 0,
      },
    ],
  } as Product;
}
export function cardFixtureInput(): CardSaveInput {
  return {
    title: '山月名片',
    template: 'natural',
    displayName: '山月',
    mainMaterials: ['白水晶'],
    philosophy: '',
    runId: 'run-one',
    images: [{ assetId: cardFixtureAsset, framing: { mode: 'contain' } }],
    includeDetails: true,
    brand: { ...emptyCardBrand },
  };
}
