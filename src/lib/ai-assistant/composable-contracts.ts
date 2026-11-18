import { z } from 'zod';
import { planToolSchema } from './orchestration-contracts';
import { dictionaryQuerySchema } from './reference-contracts';
import { assistantQuerySchema } from './contracts';

export const AGENT_VERSION = 'assistant-agent-v1' as const;
export const factFieldSchema = z.enum([
  'name',
  'item',
  'purchase',
  'specification',
  'date',
  'distributor',
  'distributorId',
  'quantity',
  'unit',
  'unitPrice',
  'amount',
  'currency',
  'currencyBasis',
  'stock',
  'stockUnknown',
  'count',
  'unknown',
  'baseline',
  'current',
  'difference',
  'percent',
  'comparison',
  'reason',
  'evidence',
]);
export type FactField = z.infer<typeof factFieldSchema>;
export const answerIntentSchema = z.strictObject({
  format: z.enum(['text', 'names', 'list', 'table']).default('list'),
  fields: z.array(factFieldSchema).min(1).max(12).default(['name', 'quantity', 'unit']),
  concise: z.boolean().default(false),
  strictFields: z.boolean().default(false),
});
export type AnswerIntent = z.infer<typeof answerIntentSchema>;
const keys = z.array(factFieldSchema).min(1).max(8);
const metric = z.enum(['amount', 'quantity', 'stock', 'unitPrice']);
export const transformSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('join'),
    other: z.uuid(),
    keys,
    fields: z.array(factFieldSchema).min(1).max(12),
  }),
  z.strictObject({
    op: z.literal('filter'),
    field: factFieldSchema,
    relation: z.enum([
      'eq',
      'ne',
      'contains',
      'not_contains',
      'gt',
      'gte',
      'lt',
      'lte',
      'missing',
      'present',
    ]),
    value: z.string().max(500).optional(),
  }),
  z.strictObject({
    op: z.literal('deduplicate'),
    by: z.enum(['item', 'specification', 'purchase']),
  }),
  z.strictObject({
    op: z.literal('sort'),
    field: factFieldSchema,
    direction: z.enum(['asc', 'desc']),
  }),
  z.strictObject({ op: z.literal('take'), count: z.number().int().min(1).max(5000) }),
  z.strictObject({
    op: z.literal('group'),
    keys,
    metric,
    calculation: z.enum(['sum', 'count', 'min', 'max']),
  }),
  z.strictObject({ op: z.literal('latest'), keys }),
  z.strictObject({
    op: z.literal('compare'),
    other: z.uuid(),
    keys,
    metric,
    mode: z.enum(['totals', 'latest_price', 'presence']),
  }),
]);
export type FactTransform = z.infer<typeof transformSchema>;
export const answerSegmentSchema = z.union([
  z.strictObject({ text: z.string().min(1).max(1000) }),
  z.strictObject({ set: z.uuid(), row: z.string().min(1).max(100), field: factFieldSchema }),
]);
export const answerBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.enum(['paragraph', 'advice']),
    segments: z.array(answerSegmentSchema).min(1).max(100),
    sources: z.array(z.uuid()).max(12),
  }),
  z.strictObject({
    type: z.literal('data'),
    set: z.uuid(),
    format: z.enum(['names', 'list', 'table']),
    fields: z.array(factFieldSchema).min(1).max(12),
  }),
]);
export const nextActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('capabilities') }),
  z.strictObject({ action: z.literal('lookup'), query: dictionaryQuerySchema }),
  z.strictObject({
    action: z.literal('query'),
    patch: planToolSchema.safeExtend({
      subject: assistantQuerySchema.shape.subject,
      itemTypes: assistantQuerySchema.shape.itemTypes,
    }),
    reset: z.boolean().default(false),
    purpose: z.enum(['answer', 'lookup', 'comparison']).default('answer'),
    retainOperations: z.boolean().default(true),
    intent: answerIntentSchema.optional(),
  }),
  z.strictObject({ action: z.literal('present'), intent: answerIntentSchema }),
  z.strictObject({
    action: z.literal('transform'),
    set: z.uuid(),
    operations: z.array(transformSchema).min(1).max(12),
  }),
  z.strictObject({
    action: z.literal('inspect'),
    set: z.uuid(),
    offset: z.number().int().min(0).max(5000).default(0),
  }),
  z.strictObject({
    action: z.literal('sources'),
    set: z.uuid(),
    row: z.string().max(100).optional(),
  }),
  z.strictObject({ action: z.literal('clarify'), question: z.string().trim().min(1).max(500) }),
  z.strictObject({
    action: z.literal('answer'),
    blocks: z.array(answerBlockSchema).min(1).max(20),
  }),
]);
export type NextAction = z.infer<typeof nextActionSchema>;

// This is also given to the model. It describes available data, never hypothetical modules.
export const ASSISTANT_CAPABILITIES = {
  version: AGENT_VERSION,
  actions: ['lookup', 'query', 'present', 'transform', 'inspect', 'sources', 'clarify', 'answer'],
  domains: [
    '商品/物料目录及真实字段语义匹配',
    '采购日期/地点/渠道商/分类/标签',
    '采购明细/单价/金额',
    '目录当前库存',
    '物料采购行当前余量',
  ],
  operations: [
    '筛选/排除/缺失检查',
    '按真实身份去重',
    '分组/排序/Top N',
    'Decimal汇总',
    '按真实身份一对一合并事实集合',
    '期间增减/新增货品',
    '相同货品规格单位币种的最近采购价比较',
    '匹配来源核对',
    '基于事实的参考建议',
  ],
  limits: [
    '每次查询最多5000条，模型预览每次最多50条，预览不代表全量',
    'CNY是采购业务默认币种，非实际多币种字段',
    '无销量/订单/真实采购人/消耗速度/低库存阈值/差价异常阈值',
    'DIY用料不自动扣库存',
    '没有阈值先追问；无销量不能推断畅销，无消耗不能预测售罄',
    '比较保留不同查询观察时间；金额/数量/库存只能由后端计算',
  ],
};
