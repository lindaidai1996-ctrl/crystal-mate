import { randomUUID } from 'node:crypto';
import { CandidateQueryError } from './candidate-contracts';
import { PurchaseDecimal, exactPurchaseDecimal } from './purchase-summary';
import type { FactField, FactTransform } from './composable-contracts';
import { transformSchema } from './composable-contracts';
import { NUMERIC_FIELDS, requireFactSet, type FactRow, type FactSet } from './fact-sets';

const fail = (code: string): never => {
  throw new CandidateQueryError(code);
};
const key = (r: FactRow, fields: FactField[]) =>
  JSON.stringify(fields.map((f) => r.values[f] ?? null));
const unique = <T>(values: T[]) => [...new Set(values)];
const decimal = (v: string) => {
  if (!/^-?\d+(?:\.\d+)?$/.test(v) || v.length > 80) return fail('FACT_NUMBER_INVALID');
  return new PurchaseDecimal(v);
};
const buckets = (rows: FactRow[], fields: FactField[]) => {
  const groups = new Map<string, FactRow[]>();
  for (const r of rows) groups.set(key(r, fields), [...(groups.get(key(r, fields)) ?? []), r]);
  return groups;
};
function dimensionalKeys(fields: FactField[], metric: FactField): FactField[] {
  return unique([
    ...fields,
    ...(fields.includes('distributor') ? ['distributorId' as const] : []),
    ...(fields.includes('name') ? ['item' as const] : []),
    ...(['amount', 'unitPrice'].includes(metric) ? ['currency' as const] : []),
    ...(['quantity', 'stock', 'unitPrice'].includes(metric) ? ['unit' as const] : []),
    ...(metric === 'unitPrice' ? ['item' as const, 'specification' as const] : []),
    ...(['baseline', 'current', 'difference', 'percent'].includes(metric)
      ? ['currency' as const, 'unit' as const]
      : []),
  ]);
}
function merged(rows: FactRow[], fields: FactField[], id: string): FactRow {
  const first = rows[0];
  const oneItem = unique(rows.map((r) => r.values.item)).length === 1;
  const oneDistributor = unique(rows.map((r) => r.values.distributorId)).length === 1;
  const values = Object.fromEntries(fields.map((f) => [f, first.values[f] ?? null]));
  if (oneItem && first.values.item) {
    values.item = first.values.item;
    values.name = first.values.name ?? null;
  }
  if (oneDistributor && first.values.distributorId)
    values.distributor = first.values.distributor ?? null;
  const href =
    oneItem && first.values.item
      ? rows.length === 1
        ? first.href
        : catalogHref(first.values.item)
      : oneDistributor
        ? first.href?.startsWith('/admin/distributors/')
          ? first.href
          : null
        : null;
  return { id, values, href, sources: unique(rows.flatMap((r) => r.sources)) };
}
function catalogHref(item: string) {
  const [type, id] = item.split(':');
  return `/admin/${type === 'MATERIAL' ? 'materials' : 'products'}/${id}`;
}
function stockRows(rows: FactRow[]) {
  // A catalog's total stock is repeated on purchase rows: never add it once per purchase.
  const seen = new Set<string>();
  return rows.filter((r) => {
    const identity =
      r.href?.includes('/batches/') && r.values.amount === undefined
        ? r.values.purchase
        : r.values.item;
    if (!identity) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
function measure(rows: FactRow[], metric: FactField, calculation: 'sum' | 'count' | 'min' | 'max') {
  const selected = metric === 'stock' ? stockRows(rows) : rows;
  const known = selected.flatMap((r) =>
    r.values[metric] == null ? [] : [decimal(r.values[metric]!)],
  );
  const unknown = selected.reduce(
    (sum, r) =>
      sum +
      (r.values.unknown != null
        ? Number(r.values.unknown)
        : r.values[metric] == null || (metric === 'stock' && r.values.stockUnknown !== '0')
          ? 1
          : 0),
    0,
  );
  if (calculation === 'count') return { value: String(rows.length), unknown: 0 };
  if (!known.length) return { value: null, unknown };
  const value =
    calculation === 'sum'
      ? known.reduce((a, b) => a.add(b), new PurchaseDecimal(0))
      : known.reduce((a, b) => ((calculation === 'min' ? a.lte(b) : a.gte(b)) ? a : b));
  return { value: exactPurchaseDecimal(value), unknown };
}
function latest(rows: FactRow[]) {
  if (rows.some((r) => !r.values.date)) return fail('FACT_DATE_REQUIRED');
  const date = rows
    .map((r) => r.values.date!)
    .sort()
    .at(-1);
  return rows.filter((r) => r.values.date === date);
}
function derive(input: FactSet, rows: FactRow[], extra?: FactSet): FactSet {
  return {
    ...input,
    id: randomUUID(),
    rows,
    parents: unique([input.id, ...(extra ? [extra.id] : [])]),
    observations: unique([...input.observations, ...(extra?.observations ?? [])]),
    complete: input.complete && (extra?.complete ?? true),
    warnings: unique([...input.warnings, ...(extra?.warnings ?? [])]),
  };
}
export function transformFactSet(
  input: FactSet,
  operations: FactTransform[],
  sets: FactSet[],
): FactSet {
  let result = derive(input, structuredClone(input.rows));
  let partitions: FactField[] = input.rankingPartitions ?? [];
  for (const raw of operations) {
    const op = transformSchema.parse(raw);
    if (op.op === 'join') {
      const other = requireFactSet(sets, op.other);
      const fields = dimensionalKeys(op.keys, 'count');
      if (!op.keys.some((f) => ['item', 'purchase', 'distributorId'].includes(f)))
        fail('FACT_JOIN_IDENTITY_REQUIRED');
      if (
        op.fields.some((f) => ['stock', 'stockUnknown', 'quantity', 'unitPrice'].includes(f)) &&
        !op.keys.some((f) => f === 'item' || f === 'purchase')
      )
        fail('FACT_JOIN_ITEM_REQUIRED');
      if (
        op.fields.some((f) =>
          [
            'item',
            'purchase',
            'name',
            'distributorId',
            'specification',
            'unit',
            'currency',
          ].includes(f),
        )
      )
        fail('FACT_JOIN_IDENTITY_OVERWRITE');
      if ([...result.rows, ...other.rows].some((r) => fields.some((f) => r.values[f] == null)))
        fail('FACT_IDENTITY_REQUIRED');
      const right = buckets(other.rows, fields);
      if ([...right.values()].some((rows) => rows.length > 1)) fail('FACT_JOIN_AMBIGUOUS');
      const rows = result.rows.map((r) => {
        const match = right.get(key(r, fields))?.[0];
        return {
          ...r,
          values: {
            ...r.values,
            ...Object.fromEntries(op.fields.map((f) => [f, match?.values[f] ?? null])),
          },
          sources: unique([...r.sources, ...(match?.sources ?? [])]),
        };
      });
      result = derive(result, rows, other);
    } else if (op.op === 'filter') {
      if (!['missing', 'present'].includes(op.relation) && op.value === undefined)
        fail('FACT_FILTER_VALUE_REQUIRED');
      if (['gt', 'gte', 'lt', 'lte'].includes(op.relation) && !NUMERIC_FIELDS.has(op.field))
        fail('FACT_NUMERIC_FIELD_REQUIRED');
      result.rows = result.rows.filter((r) => {
        const v = r.values[op.field];
        if (op.relation === 'missing') return v == null;
        if (op.relation === 'present') return v != null;
        if (v == null) return false;
        if (op.relation === 'eq')
          return NUMERIC_FIELDS.has(op.field) ? decimal(v).eq(decimal(op.value!)) : v === op.value;
        if (op.relation === 'ne')
          return NUMERIC_FIELDS.has(op.field) ? !decimal(v).eq(decimal(op.value!)) : v !== op.value;
        if (op.relation === 'contains')
          return v.toLocaleLowerCase().includes(op.value!.toLocaleLowerCase());
        if (op.relation === 'not_contains')
          return !v.toLocaleLowerCase().includes(op.value!.toLocaleLowerCase());
        const n = decimal(v).cmp(decimal(op.value!));
        return op.relation === 'gt'
          ? n > 0
          : op.relation === 'gte'
            ? n >= 0
            : op.relation === 'lt'
              ? n < 0
              : n <= 0;
      });
    } else if (op.op === 'deduplicate') {
      const fields: FactField[] = op.by === 'specification' ? ['item', 'specification'] : [op.by];
      if (result.rows.some((r) => fields.some((f) => r.values[f] == null)))
        fail('FACT_IDENTITY_REQUIRED');
      result.rows = [...buckets(result.rows, fields)].map(([, rows], i) => {
        const row = merged(rows, Object.keys(rows[0].values) as FactField[], `d${i}`);
        // Deduplication is for identity/listing, not permission to retain arbitrary batch facts.
        if (rows.length > 1)
          for (const f of Object.keys(row.values) as FactField[])
            if (unique(rows.map((r) => r.values[f])).length > 1) row.values[f] = null;
        if (rows.length > 1) row.values.purchase = null;
        return row;
      });
    } else if (op.op === 'sort') {
      partitions = NUMERIC_FIELDS.has(op.field) ? dimensionalKeys([], op.field) : [];
      result.rows = [...buckets(result.rows, partitions)].flatMap(([, rows]) =>
        rows.sort((a, b) => {
          const av = a.values[op.field],
            bv = b.values[op.field];
          if (av == null || bv == null)
            return av == null ? (bv == null ? a.id.localeCompare(b.id) : 1) : -1;
          const cmp = NUMERIC_FIELDS.has(op.field)
            ? decimal(av).cmp(decimal(bv))
            : av.localeCompare(bv, 'zh');
          return (op.direction === 'asc' ? cmp : -cmp) || a.id.localeCompare(b.id);
        }),
      );
    } else if (op.op === 'take') {
      result.rows = [...buckets(result.rows, partitions)].flatMap(([, rows]) =>
        rows.slice(0, op.count),
      );
    } else if (op.op === 'latest') {
      const fields = dimensionalKeys(op.keys, 'unitPrice');
      result.rows = [...buckets(result.rows, fields)].flatMap(([, rows]) => latest(rows));
    } else if (op.op === 'group') {
      if (op.metric === 'unitPrice' && op.calculation === 'sum') fail('FACT_PRICE_SUM_UNSUPPORTED');
      const fields = dimensionalKeys(op.keys, op.calculation === 'count' ? 'count' : op.metric);
      result.rows = [...buckets(result.rows, fields)].map(([, rows], i) => {
        const row = merged(rows, fields, `g${i}`);
        const measured = measure(rows, op.metric, op.calculation);
        row.values[op.calculation === 'count' ? 'count' : op.metric] = measured.value;
        row.values.unknown = String(measured.unknown);
        row.values.count = String(rows.length);
        return row;
      });
      partitions = [];
    } else if (op.op === 'compare') {
      const other = requireFactSet(sets, op.other);
      if (!result.complete || !other.complete) fail('FACT_COMPARISON_REQUIRES_COMPLETE');
      if (op.mode === 'latest_price' && op.metric !== 'unitPrice')
        fail('FACT_PRICE_METRIC_REQUIRED');
      if (op.metric === 'unitPrice' && op.mode === 'totals') fail('FACT_PRICE_SUM_UNSUPPORTED');
      const fields = dimensionalKeys(op.keys, op.metric);
      const a = buckets(other.rows, fields),
        b = buckets(result.rows, fields);
      const rows: FactRow[] = [];
      for (const k of unique([...a.keys(), ...b.keys()])) {
        const before = a.get(k) ?? [],
          after = b.get(k) ?? [];
        const row = merged([...after, ...before], fields, `c${rows.length}`);
        let baseline: string | null = null,
          current: string | null = null;
        let reason: string | null = null;
        if (op.mode === 'latest_price') {
          const values = (entries: FactRow[]) =>
            unique(latest(entries).map((r) => r.values.unitPrice ?? null));
          const av = before.length ? values(before) : [],
            bv = after.length ? values(after) : [];
          const comparable =
            row.values.item && row.values.specification && row.values.unit && row.values.currency;
          if (!comparable || av.length !== 1 || bv.length !== 1 || av[0] === null || bv[0] === null)
            reason = '货品、规格、单位、币种、价格缺失或最近同日存在多个价格，无法可靠比较。';
          else {
            baseline = av[0];
            current = bv[0];
          }
        } else if (op.mode === 'totals') {
          const av = measure(before, op.metric, 'sum'),
            bv = measure(after, op.metric, 'sum');
          baseline = before.length ? av.value : '0.00';
          current = after.length ? bv.value : '0.00';
          if (av.unknown || bv.unknown) {
            baseline = current = null;
            reason = '存在未知值，不能给出完整增减。';
          }
        }
        row.values.baseline = baseline;
        row.values.current = current;
        row.values.comparison = !before.length ? 'added' : !after.length ? 'removed' : 'both';
        row.values.reason = reason;
        row.values.difference =
          baseline !== null && current !== null
            ? exactPurchaseDecimal(decimal(current).sub(baseline))
            : null;
        row.values.percent =
          baseline !== null && current !== null && !decimal(baseline).isZero()
            ? decimal(current).sub(baseline).div(baseline).mul(100).toFixed(2)
            : null;
        rows.push(row);
      }
      result = derive(result, rows, other);
      if (result.observations.length > 1)
        result.warnings = unique([
          ...result.warnings,
          '比较包含多个查询观察时间，不是同一事务快照。',
        ]);
      partitions = [];
    }
  }
  result.rankingPartitions = partitions;
  return result;
}
