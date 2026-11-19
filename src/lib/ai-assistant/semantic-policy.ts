import { CandidateQueryError } from './candidate-contracts';
import { z } from 'zod';
import {
  queryCandidateSchema,
  semanticConditionSchema,
  decisionsForCandidatesSchema,
  type QueryCandidate,
  type SemanticDecision,
} from './contracts';

export const SEMANTIC_POLICY_VERSION = 'v1' as const;
// The wire contract remains v1; revisions identify changes to its business rules.
export const SEMANTIC_POLICY_REVISION = 'v2' as const;
export const SEMANTIC_POLICY = {
  version: SEMANTIC_POLICY_VERSION,
  revision: SEMANTIC_POLICY_REVISION,
  purposeAliases: ['配件', '配饰', '制作配件', '制作物料', '制作配件（含配饰、圆珠）'],
  makingForms: ['圆珠', '散珠', '桶珠', '药片', '随形', '提溜', '勒子', '藏扣', '隔片', '直切'],
  // These are explicit material labels, not a mapping of every category to a material.
  materialLabels: [
    '绿松石',
    '玻璃',
    '树脂',
    '和田玉',
    '翡翠',
    '绿幽灵',
    'S925银',
    '银',
    '18K金',
    '铜',
  ],
  ambiguousTerms: ['松石'],
} as const;
type Condition = z.infer<typeof semanticConditionSchema>;
type Evidence = QueryCandidate['evidence'][number];
type Status = SemanticDecision['status'];
export type SemanticConditionResult = {
  condition: Condition;
  status: Status;
  reason: string;
  evidence: Evidence[];
};
export function normalizeSemanticConditions(input: unknown) {
  return z
    .array(semanticConditionSchema)
    .max(20)
    .parse(input)
    .map((condition) => {
      const purpose =
        condition.concept === 'purpose' &&
        SEMANTIC_POLICY.purposeAliases.some((t) => t === condition.text);
      return {
        ...condition,
        canonical: purpose ? '制作配件' : condition.text,
        terms: purpose ? ['配件', '配饰', ...SEMANTIC_POLICY.makingForms] : [condition.text],
      };
    });
}
const unique = (rows: Evidence[]) => [...new Map(rows.map((e) => [JSON.stringify(e), e])).values()];
function decisionEvidence(rows: Evidence[]) {
  const evidence = unique(rows);
  if (evidence.length > 50) throw new CandidateQueryError('SEMANTIC_EVIDENCE_BUDGET_EXCEEDED');
  return evidence;
}
export function catalogSemanticEvidence(candidate: QueryCandidate) {
  return candidate.evidence.filter(
    (e) =>
      (e.entity.type === candidate.item.type &&
        e.entity.id === candidate.item.id &&
        ['name', 'aliases', 'notes', 'description'].includes(e.field)) ||
      ((e.entity.type === 'MATERIAL_CATEGORY' ||
        e.entity.type === 'PRODUCT_CATEGORY' ||
        e.entity.type === 'TAG') &&
        ['name', 'aliases'].includes(e.field)),
  );
}
const values = (e: Evidence): string[] =>
  e.value === null ? [] : Array.isArray(e.value) ? e.value : [e.value];
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const narrative = (e: Evidence) => e.field === 'notes' || e.field === 'description';
const explicitOwnMaterial = (before: string) =>
  /(?:材质|材料|本体)\s*(?:是|为|[:：])\s*(?:天然)?\s*$/.test(before);
const platingPattern = new RegExp(
  [
    String.raw`(?:\d{1,2}\s*K\s*)?(?:电镀|镀)\s*(?:\d{1,2}\s*K\s*)?(?:金|S?925\s*银|银|铜|铑|铂)`,
    String.raw`(?:\d{1,2}\s*K\s*)?(?:金|S?925\s*银|银|铜|铑|铂)\s*(?:电镀层|镀层)`,
  ].join('|'),
  'giu',
);
function withoutPlating(text: string) {
  // Remove only explicit surface treatments from the matching text. Citations
  // still use the unmodified field; plating alone cannot establish a base metal.
  return text.replace(platingPattern, ' ');
}
function materialSignals(candidate: QueryCandidate, target: string) {
  const positive: Evidence[] = [],
    negative: Evidence[] = [],
    usage: Evidence[] = [],
    usageNegative: Evidence[] = [],
    ambiguous: Evidence[] = [];
  for (const e of catalogSemanticEvidence(candidate))
    for (const value of values(e)) {
      if (
        narrative(e) &&
        /(?:材质|材料|本体).{0,8}(?:待核对|待确认|不确定|存疑|需核对)/.test(value)
      )
        ambiguous.push(e);
      for (const originalClause of value.split(/[，,。；;\n]/)) {
        const clause = withoutPlating(originalClause);
        const matches = [...clause.matchAll(new RegExp(escapeRegExp(target), 'giu'))];
        for (const match of matches) {
          const before = clause.slice(0, match.index);
          const after = clause.slice(match.index! + match[0].length);
          if (/(?:搭配|配合|配搭)\s*$/.test(before)) {
            (/(?:不适合|不宜|不可|不能|不建议|不用于|不)\s*(?:用来|用于|适合)?\s*(?:搭配|配合|配搭)\s*$/.test(
              before,
            )
              ? usageNegative
              : usage
            ).push(e);
          } else if (
            /(?:不是仿|并非不|不是不)/.test(before) ||
            /(?:待核对|待确认|不确定|存疑|可能|疑似)/.test(clause)
          ) {
            ambiguous.push(e);
          } else if (
            /^\s*(?:色|颜色|配色|风格|造型|纹理)/.test(after) ||
            /(?:仿|仿制|仿造|人造|非|不含|不是|不是真|不是天然|并非|无|像|酷似|类似|形似|近似)\s*$/.test(
              before,
            )
          ) {
            negative.push(e);
          } else if (!narrative(e) || explicitOwnMaterial(before)) {
            positive.push(e);
          } else ambiguous.push(e);
        }
        // Separate material labels can conflict even inside one field. Overlapping
        // labels such as 银 / S925银 are not competing material assertions.
        if (
          SEMANTIC_POLICY.materialLabels.some(
            (other) =>
              !other.includes(target) &&
              !target.includes(other) &&
              [...clause.matchAll(new RegExp(escapeRegExp(other), 'giu'))].some(
                (match) => !narrative(e) || explicitOwnMaterial(clause.slice(0, match.index)),
              ),
          )
        )
          negative.push(e);
      }
    }
  return {
    positive: unique(positive),
    negative: unique(negative),
    usage: unique(usage),
    usageNegative: unique(usageNegative),
    ambiguous: unique(ambiguous),
  };
}
export function assessSemanticCandidate(rawCandidate: unknown, rawConditions: unknown) {
  const candidate = queryCandidateSchema.parse(rawCandidate);
  const conditions = normalizeSemanticConditions(rawConditions);
  const evidence = catalogSemanticEvidence(candidate);
  // A real empty field is valid evidence of insufficient information. Never invent one.
  const fallback = evidence.slice(0, 1);
  const results: SemanticConditionResult[] = conditions.map(
    ({ canonical, terms, ...condition }) => {
      let status: Status = 'uncertain';
      let reason = '规则未覆盖该表达或缺少明确字段依据';
      let used: Evidence[] = fallback;
      if (
        condition.concept === 'material' &&
        SEMANTIC_POLICY.materialLabels.some((t) => t === canonical)
      ) {
        const signals = materialSignals(candidate, canonical);
        const positive = condition.relation === 'used_with' ? signals.usage : signals.positive;
        const negative =
          condition.relation === 'used_with'
            ? signals.usageNegative
            : [...signals.negative, ...(signals.positive.length ? [] : signals.usage)];
        used = unique([...positive, ...negative, ...signals.ambiguous]);
        if (signals.ambiguous.length || (positive.length && negative.length)) {
          reason = '材质或用途字段冲突/待核对，保留待确认';
        } else if (positive.length) {
          status = 'include';
          reason =
            condition.relation === 'used_with' ? '字段明确支持搭配用途' : '字段明确支持自身材质';
        } else if (negative.length) {
          status = 'exclude';
          reason = '字段为其他材质、仿制/颜色或仅搭配用途，不支持该条件';
        }
      } else if (
        condition.concept === 'purpose' &&
        canonical === '制作配件' &&
        condition.relation !== 'used_with'
      ) {
        const matched = evidence.filter((e) =>
          values(e).some(
            (v) =>
              terms.some((term) => v.includes(term)) &&
              (!narrative(e) || /(?:用途|用作|用于制作|制作成|可做|可用作)/.test(v)),
          ),
        );
        if (candidate.item.type === 'PRODUCT') {
          status = 'exclude';
          reason = '商品成品不能自动当作制作物料';
          used = fallback;
        } else if (matched.length) {
          const conflict = matched.some((e) =>
            values(e).some((v) => /(?:不是|不属于|非|并非)\s*(?:制作)?(?:配件|配饰|物料)/.test(v)),
          );
          status = conflict ? 'uncertain' : 'include';
          reason = conflict
            ? '制作用途存在否定或冲突'
            : '物料实际用途/形态支持制作配件，无需同名标签';
          used = matched;
        }
      } else if (
        condition.concept === 'form' &&
        condition.relation !== 'used_with' &&
        SEMANTIC_POLICY.makingForms.some((t) => t === canonical)
      ) {
        const matched = evidence.filter((e) =>
          values(e).some(
            (v) =>
              v.includes(canonical) &&
              (!narrative(e) ||
                new RegExp(`(?:形态|形状)\\s*(?:是|为|[:：])\\s*${escapeRegExp(canonical)}`).test(
                  v,
                )),
          ),
        );
        const conflicting = matched.some((e) =>
          values(e).some((v) =>
            new RegExp(`(?:不是|非|不属于)\\s*${escapeRegExp(canonical)}`).test(v),
          ),
        );
        if (matched.length) {
          status = conflicting ? 'uncertain' : 'include';
          reason = conflicting ? '形态存在否定或冲突' : '真实名称、别名或分类/标签支持该形态';
          used = matched;
        } else {
          const other = evidence.filter(
            (e) =>
              !narrative(e) &&
              values(e).some((v) =>
                SEMANTIC_POLICY.makingForms.some((term) => term !== canonical && v.includes(term)),
              ),
          );
          if (other.length) {
            status = 'exclude';
            reason = '字段明确为其他形态，不扩张精确形态条件';
            used = other;
          }
        }
      }
      if (!used.length) used = fallback;
      // Absence remains unknown under negation; only explicit facts may be inverted.
      if (condition.relation === 'not' && status !== 'uncertain') {
        status = status === 'include' ? 'exclude' : 'include';
        reason = `否定条件：${reason}`;
      }
      return { condition, status, reason, evidence: decisionEvidence(used) };
    },
  );
  const conflict = results.some((r) => r.status === 'uncertain' && /冲突|待核对/.test(r.reason));
  const status: Status = conflict
    ? 'uncertain'
    : results.some((r) => r.status === 'exclude')
      ? 'exclude'
      : results.every((r) => r.status === 'include') && results.length
        ? 'include'
        : 'uncertain';
  const used = decisionEvidence(results.flatMap((r) => r.evidence));
  // No output decision without a server-returned evidence field.
  const decision =
    used.length && results.length
      ? decisionsForCandidatesSchema([candidate]).parse([
          {
            item: candidate.item,
            purchase: candidate.purchase,
            status,
            evidence: used,
            reason: conflict
              ? '字段冲突，需确认后继续判断'
              : results
                  .map((r) => r.reason)
                  .join('；')
                  .slice(0, 500) || '没有语义条件，未作语义判断',
            ruleVersion: SEMANTIC_POLICY_VERSION,
          },
        ])[0]
      : null;
  return { ruleVersion: SEMANTIC_POLICY_VERSION, conditions: results, decision };
}
