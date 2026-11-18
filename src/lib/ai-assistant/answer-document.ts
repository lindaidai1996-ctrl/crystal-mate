import { z } from 'zod';
import {
  answerBlockSchema,
  answerIntentSchema,
  type AnswerIntent,
  type FactField,
} from './composable-contracts';
import { factRowSchema, PRIVATE_FIELDS, requireFactSet, type FactSet } from './fact-sets';
import { transformFactSet } from './fact-operations';
import { CandidateQueryError } from './candidate-contracts';
import { minimizeAssistantText } from './privacy';

const cellSchema = z.object({
  text: z.string(),
  href: z.string().startsWith('/admin/').nullable(),
});
export const answerDocumentSchema = z.object({
  version: z.literal('answer-v1'),
  privacy: z.boolean(),
  observations: z.array(z.iso.datetime({ offset: true })).max(24),
  warnings: z.array(z.string()).max(30),
  fallback: z.boolean(),
  blocks: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.enum(['paragraph', 'advice']), cells: z.array(cellSchema).max(100) }),
        z.object({
          type: z.literal('data'),
          format: z.enum(['names', 'list', 'table']),
          fields: z.array(z.string()),
          rows: z
            .array(z.object({ id: factRowSchema.shape.id, cells: z.array(cellSchema) }))
            .max(5000),
        }),
      ]),
    )
    .max(20),
});
export type AnswerDocument = z.infer<typeof answerDocumentSchema>;
export type AnswerBlockInput = z.infer<typeof answerBlockSchema>;

const unitLabel: Record<string, string> = { GRAM: '克', BEAD: '颗', STRAND: '串', PIECE: '件' };
function cell(row: FactSet['rows'][number], field: FactField) {
  const raw = row.values[field];
  const text =
    raw == null
      ? '未知'
      : field === 'unit'
        ? (unitLabel[raw] ?? raw)
        : field === 'comparison'
          ? ({ added: '新增', removed: '不再出现', both: '两期均有' }[raw] ?? raw)
          : field === 'currencyBasis'
            ? ({ business_default: '业务默认', recorded: '记录值', unknown: '未知' }[raw] ?? raw)
            : raw;
  const partial =
    raw != null &&
    ['amount', 'quantity', 'stock', 'unitPrice'].includes(field) &&
    (Number(row.values.unknown ?? '0') > 0 ||
      (field === 'stock' && Number(row.values.stockUnknown ?? '0') > 0));
  return {
    text: minimizeAssistantText(partial ? `已知部分：${text}` : text),
    href: field === 'name' ? row.href : null,
  };
}
export function renderAnswerDocument(
  blocks: AnswerBlockInput[],
  sets: FactSet[],
  intentInput: AnswerIntent,
  privacy: boolean,
  fallback = false,
): AnswerDocument {
  const intent = answerIntentSchema.parse(intentInput);
  const namesOnly = intent.format === 'names';
  const document: AnswerDocument = {
    version: 'answer-v1',
    privacy,
    observations: [],
    warnings: [],
    fallback,
    blocks: [],
  };
  const used = new Map<string, FactSet>();
  for (const raw of blocks) {
    const block = answerBlockSchema.parse(raw);
    if (namesOnly && block.type !== 'data') throw new CandidateQueryError('ANSWER_FIELDS_MISMATCH');
    if (block.type === 'data') {
      let set = requireFactSet(sets, block.set);
      used.set(set.id, set);
      const fields: FactField[] = namesOnly ? ['name'] : block.fields;
      if (
        !namesOnly &&
        (intent.strictFields || intent.concise) &&
        fields.some((field) => !intent.fields.includes(field))
      )
        throw new CandidateQueryError('ANSWER_FIELDS_MISMATCH');
      if (namesOnly && (block.fields.length !== 1 || block.fields[0] !== 'name'))
        throw new CandidateQueryError('ANSWER_FIELDS_MISMATCH');
      if (namesOnly && set.rows.length && set.rows.every((r) => r.values.item))
        set = transformFactSet(set, [{ op: 'deduplicate', by: 'item' }], sets);
      const safeFields = fields.filter((f) => !privacy || PRIVATE_FIELDS.has(f));
      if (privacy && !safeFields.length) continue;
      document.blocks.push({
        type: 'data',
        format: namesOnly ? 'names' : block.format,
        fields: safeFields,
        rows: set.rows.map((row) => ({ id: row.id, cells: safeFields.map((f) => cell(row, f)) })),
      });
    } else {
      if (privacy) continue;
      if (sets.length && !block.sources.length)
        throw new CandidateQueryError('ANSWER_SOURCE_REQUIRED');
      for (const id of block.sources) used.set(id, requireFactSet(sets, id));
      const cells = block.segments.map((segment) => {
        if ('text' in segment) {
          // Business values belong in references, never model-authored numbers or URLs.
          if (/[\p{N}]|https?:|javascript:|\]\(/iu.test(segment.text))
            throw new CandidateQueryError('ANSWER_LITERAL_FACT');
          for (const set of used.values())
            for (const row of set.rows)
              if (
                row.values.name &&
                row.values.name.length > 2 &&
                segment.text.includes(row.values.name)
              )
                throw new CandidateQueryError('ANSWER_LITERAL_FACT');
          return { text: minimizeAssistantText(segment.text), href: null };
        }
        const set = requireFactSet(sets, segment.set);
        used.set(set.id, set);
        const row = set.rows.find((r) => r.id === segment.row);
        if (!row || !(segment.field in row.values))
          throw new CandidateQueryError('ANSWER_REFERENCE_INVALID');
        if (!intent.fields.includes(segment.field) && (intent.concise || intent.strictFields))
          throw new CandidateQueryError('ANSWER_FIELDS_MISMATCH');
        return cell(row, segment.field);
      });
      document.blocks.push({ type: block.type, cells });
    }
  }
  if (!document.blocks.length && !privacy) throw new CandidateQueryError('ANSWER_EMPTY');
  document.observations = [...new Set([...used.values()].flatMap((s) => s.observations))];
  document.warnings = [
    ...new Set(
      [...used.values()].flatMap((s) =>
        namesOnly
          ? s.warnings.filter((w) => w.includes('待确认') || w.includes('未完成'))
          : s.warnings,
      ),
    ),
  ];
  return answerDocumentSchema.parse(document);
}
export function fallbackAnswer(
  set: FactSet,
  sets: FactSet[],
  intent: AnswerIntent,
  privacy: boolean,
) {
  const answer = renderAnswerDocument(
    [
      {
        type: 'data',
        set: set.id,
        format: intent.format === 'text' ? 'list' : intent.format,
        fields: intent.format === 'names' ? ['name'] : intent.fields,
      },
    ],
    sets,
    intent,
    privacy,
    true,
  );
  return answer;
}
export function answerDocumentView(raw: unknown, privacy: boolean): AnswerDocument | null {
  const parsed = answerDocumentSchema.safeParse(raw);
  if (!parsed.success) return null;
  // Protected prose is not reparsed or selectively guessed safe when the preference changes.
  if (privacy) return null;
  return parsed.data;
}
