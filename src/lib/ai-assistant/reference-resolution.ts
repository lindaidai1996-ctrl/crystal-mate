import type { EntityRef } from './contracts';
import {
  dictionaryQuerySchema,
  dictionaryResultSchema,
  locationQuerySchema,
  locationResolutionSchema,
  type DictionaryKind,
  type LocationResolution,
} from './reference-contracts';

export type LocationRow = {
  id: string;
  name: string;
  area: string;
  address: string;
  notes: string;
};
export type DictionaryRow = {
  type: DictionaryKind;
  id: string;
  name: string;
  aliases: string[];
  parentId: string | null;
};
const normalized = (value: string) => value.trim().toLowerCase();
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function mention(field: 'name' | 'address' | 'area' | 'notes', value: string, query: string) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped, 'iu').exec(value);
  return match
    ? { field, matchedText: match[0], start: match.index, end: match.index + match[0].length }
    : null;
}
// Fail closed for obvious qualifications; this is not a general geography/NLP parser.
const qualified =
  /不在|不属于|并非|不是|曾在|原在|原址|旧址|已搬|搬离|迁出|附近|周边|对面|旁边|隔壁|以外/u;

export function resolveLocationRows(input: unknown, rows: LocationRow[], scanComplete = true) {
  const query = locationQuerySchema.parse(input);
  const confirmed: LocationResolution['confirmed'] = [];
  const uncertain: LocationResolution['uncertain'] = [];
  const knownArea = rows.some((row) => normalized(row.area) === normalized(query.text));
  const ordered = [...rows].sort((a, b) => compare(a.id, b.id));
  const possibleAreas = new Set<string>();
  for (const row of ordered) {
    const fields =
      query.kind === 'area' ? (['area'] as const) : (['name', 'address', 'notes'] as const);
    const evidence = fields.flatMap((field) => {
      const hit = mention(field, row[field], query.text);
      return hit ? [hit] : [];
    });
    if (!evidence.length) continue;
    const direct = evidence.filter(({ field }) => field !== 'notes');
    const hasQualification = evidence.some(
      ({ field, start, end }) =>
        qualified.test(row[field]) ||
        /(?:非|原|曾|不位于|未在|没有在)\s*$/u.test(row[field].slice(0, start)) ||
        /^(?:之外|外面)/u.test(row[field].slice(end)),
    );
    const exactArea = normalized(row.area) === normalized(query.text);
    const isConfirmed =
      query.kind === 'area' ? exactArea : !knownArea && direct.length > 0 && !hasQualification;
    const match: LocationResolution['confirmed'][number] = {
      distributor: { type: 'DISTRIBUTOR', id: row.id },
      name: row.name,
      area: row.area,
      reason: isConfirmed
        ? query.kind === 'area'
          ? 'exact_area'
          : 'explicit_place'
        : hasQualification
          ? 'qualified_mention'
          : knownArea || query.kind === 'area'
            ? 'area_only'
            : 'mention_only',
      evidence,
    };
    (isConfirmed ? confirmed : uncertain).push(match);
    if (isConfirmed) possibleAreas.add(normalized(row.area));
  }
  if (query.kind === 'exact_place') {
    const included = new Set([...confirmed, ...uncertain].map((row) => row.distributor.id));
    for (const row of ordered) {
      if (included.has(row.id) || !row.area.trim()) continue;
      if (
        !possibleAreas.has(normalized(row.area)) &&
        !normalized(query.text).includes(normalized(row.area))
      )
        continue;
      uncertain.push({
        distributor: { type: 'DISTRIBUTOR', id: row.id },
        name: row.name,
        area: row.area,
        reason: 'area_only',
        evidence: [{ field: 'area', matchedText: row.area, start: 0, end: row.area.length }],
      });
    }
  }
  return locationResolutionSchema.parse({
    version: 'v1',
    query,
    status: !scanComplete
      ? 'incomplete'
      : confirmed.length || !uncertain.length
        ? 'resolved'
        : 'needs_clarification',
    scannedCount: rows.length,
    scanComplete,
    confirmed,
    uncertain,
  });
}

export function resolvedLocationDistributorIds(input: unknown) {
  const result = locationResolutionSchema.parse(input);
  if (result.status !== 'resolved') throw new Error(`LOCATION_${result.status.toUpperCase()}`);
  return result.confirmed.map((match) => match.distributor.id);
}

export function searchDictionaryRows(input: unknown, rows: DictionaryRow[], scanComplete = true) {
  const query = dictionaryQuerySchema.parse(input);
  if (!scanComplete)
    return dictionaryResultSchema.parse({
      version: 'v1',
      query,
      status: 'incomplete',
      scannedCount: rows.length,
      totalMatches: null,
      hasMore: false,
      items: [],
    });
  const materials = new Map(
    rows.filter((row) => row.type === 'MATERIAL_CATEGORY').map((row) => [row.id, row]),
  );
  const children = new Map<string, DictionaryRow[]>();
  for (const row of materials.values()) {
    if (!row.parentId) continue;
    if (!materials.has(row.parentId)) throw new Error('INVALID_CATEGORY_TREE');
    const list = children.get(row.parentId) ?? [];
    list.push(row);
    children.set(row.parentId, list);
  }
  function ancestors(row: DictionaryRow) {
    const chain: DictionaryRow[] = [];
    const visited = new Set([row.id]);
    let parentId = row.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw new Error('INVALID_CATEGORY_TREE');
      visited.add(parentId);
      const parent = materials.get(parentId);
      if (!parent) throw new Error('INVALID_CATEGORY_TREE');
      chain.unshift(parent);
      parentId = parent.parentId;
    }
    return chain;
  }
  // Validate the entire loaded tree, even if the user's text doesn't hit a cycle.
  for (const row of materials.values()) ancestors(row);
  function descendants(row: DictionaryRow) {
    const result: DictionaryRow[] = [];
    const pending = [...(children.get(row.id) ?? [])];
    while (pending.length) {
      const child = pending.pop()!;
      result.push(child);
      pending.push(...(children.get(child.id) ?? []));
    }
    return result.sort((a, b) => compare(a.id, b.id));
  }
  const label = (row: DictionaryRow) => ({
    entity: { type: row.type, id: row.id },
    name: row.name,
  });
  const matches = rows
    .filter((row) => query.kinds.includes(row.type))
    .flatMap((row) => {
      const nameHit = normalized(row.name).includes(normalized(query.text));
      const aliasHit = row.aliases.some((alias) =>
        normalized(alias).includes(normalized(query.text)),
      );
      if (query.text && !nameHit && !aliasHit) return [];
      const entity: EntityRef & { type: DictionaryKind } = { type: row.type, id: row.id };
      return [
        {
          entity,
          name: row.name,
          aliases: row.aliases,
          parentId: row.parentId,
          ancestors: row.type === 'MATERIAL_CATEGORY' ? ancestors(row).map(label) : [],
          descendants: row.type === 'MATERIAL_CATEGORY' ? descendants(row).map(label) : [],
          match: !query.text
            ? 'listed'
            : [row.name, ...row.aliases].some(
                  (value) => normalized(value) === normalized(query.text),
                )
              ? 'exact'
              : 'contains',
          evidence: [
            ...(nameHit ? [{ entity, field: 'name', value: row.name }] : []),
            ...(aliasHit ? [{ entity, field: 'aliases', value: row.aliases }] : []),
          ],
        },
      ];
    })
    .sort((a, b) => compare(a.entity.type, b.entity.type) || compare(a.entity.id, b.entity.id));
  const items = matches.slice(query.offset, query.offset + query.limit);
  return dictionaryResultSchema.parse({
    version: 'v1',
    query,
    status: 'complete',
    scannedCount: rows.length,
    totalMatches: matches.length,
    hasMore: query.offset + items.length < matches.length,
    items,
  });
}
