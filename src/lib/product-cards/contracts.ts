import { z } from 'zod';
import { imageFramingSchema } from '@/lib/image-framing';

export const cardTemplates = ['natural', 'editorial', 'poetic'] as const;
export const cardTemplateNames = { natural: '自然雅致', editorial: '杂志感', poetic: '东方诗意' };
export const CARD_TEMPLATE_VERSION = 2;
export const cardBrandSchema = z.strictObject({
  name: z.string().trim().max(40),
  wechat: z.string().trim().max(80),
  logoAssetId: z.string().uuid().nullable(),
  qrAssetId: z.string().uuid().nullable(),
  showName: z.boolean(),
  showLogo: z.boolean(),
  showContact: z.boolean(),
});
export const emptyCardBrand: CardBrand = {
  name: '',
  wechat: '',
  logoAssetId: null,
  qrAssetId: null,
  showName: true,
  showLogo: true,
  showContact: true,
};
export const cardImageSchema = z
  .strictObject({
    sourceImageId: z.string().min(1).max(100).optional(),
    assetId: z.string().uuid().optional(),
    framing: imageFramingSchema,
  })
  .refine((image) => Boolean(image.sourceImageId) !== Boolean(image.assetId));
export const cardFieldsSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  template: z.enum(cardTemplates),
  displayName: z.string().trim().min(1).max(80),
  mainMaterials: z.array(z.string().trim().min(1).max(80)).max(12),
  philosophy: z.string().trim().max(180),
  images: z.array(cardImageSchema).min(1).max(3),
  includeDetails: z.boolean(),
  brand: cardBrandSchema,
});
export const cardSaveSchema = cardFieldsSchema.extend({
  runId: z.string().min(1).max(100).nullable(),
  version: z.number().int().positive().optional(),
  refresh: z
    .array(z.enum(['name', 'materials', 'images', 'quote']))
    .max(4)
    .optional(),
  expectedSourceHash: z.string().length(64).optional(),
});
const money = z.string().regex(/^\d{1,20}\.\d{2}$/);
export const cardQuoteSchema = z.strictObject({
  currency: z.string().min(1).max(10),
  rows: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(200),
        specification: z.string().max(150),
        quantity: z.string().max(50),
        unitPrice: money.nullable(),
        subtotal: money,
      }),
    )
    .max(100),
  total: money,
  craftAllocated: z.boolean(),
});
export type CardBrand = z.infer<typeof cardBrandSchema>;
export type CardFields = z.infer<typeof cardFieldsSchema>;
export type CardSaveInput = z.infer<typeof cardSaveSchema>;
export type CardQuote = z.infer<typeof cardQuoteSchema>;
export type CardSource = {
  runId: string;
  name: string;
  materials: string[];
  images: { id: string; url: string; objectKey: string }[];
  quote: CardQuote | null;
  hashes: Record<'name' | 'materials' | 'images' | 'quote', string>;
  hash: string;
};
export type ProductCardView = CardFields & {
  id: string;
  productId: string;
  runId: string | null;
  version: number;
  templateVersion: number;
  quote: CardQuote | null;
  createdAt: string;
  updatedAt: string;
  source: CardSource | null;
  changed: ('name' | 'materials' | 'images' | 'quote')[];
};
export type CardCollection = {
  items: ProductCardView[];
  sources: { runId: string; createdAt: string; quantity: number }[];
  source: CardSource | null;
  brand: CardBrand;
  brandVersion: number;
};
export function cardAssetUrl(id: string) {
  return `/api/product-card-assets/${id}`;
}

export const cardErrorMessages: Record<string, string> = {
  CARD_CONTENT_INCOMPLETE: '请填写主要物料和哲理短文后再导出，未完成的内容可以先保存。',
  CARD_CONFLICT: '这份名片已被其他窗口修改，请重新打开后再编辑。',
  CARD_SOURCE_CHANGED: '商品来源数据刚刚发生变化，请重新查看后更新。',
  CARD_QUOTE_INCOMPLETE: '对客报价不完整，请到 DIY 配置补全，或取消导出明细。',
  CARD_SOURCE_REQUIRED: '请先配置一条 DIY 制作记录。',
  CARD_INVALID_SOURCE: '制作记录或图片不属于当前商品，请重新选择。',
  CARD_IMAGE_UNAVAILABLE: '名片图片读取失败，请重试或重新选择图片。',
  CARD_CAPACITY_EXCEEDED: '内容超出单张名片容量，请缩短文字或减少明细后重试。',
  CARD_MODEL_NOT_CONFIGURED: '尚未配置文案模型，可以先手动填写文案。',
  CARD_MODEL_UNAVAILABLE: '文案生成暂时不可用，已保留当前内容，可重试或手动填写。',
  CARD_MODEL_INVALID_RESULT: '生成的文案格式不合适，请重试，或手动填写。',
  CARD_MODEL_RATE_LIMIT: '文案生成请求较多，请稍后重试。',
  CARD_RENDER_BUSY: '当前导出任务较多，请稍后重试。',
  INVALID_INPUT: '请检查必填内容、文字长度和图片数量。',
  INVALID_IMAGE: '请选择有效的 JPG、PNG 或 WebP 图片（不超过 8 MB）。',
  NOT_FOUND: '名片或商品已不存在，请刷新后重试。',
};
