type NamedRecord = { id: string; name: string };

function firstName(records: NamedRecord[], fallback: string) {
  const unique = [...new Map(records.map((record) => [record.id, record])).values()];
  const name = unique[0]?.name.trim() || fallback;
  const abbreviated = Array.from(name);
  return `${abbreviated.length > 48 ? `${abbreviated.slice(0, 47).join('')}…` : name}${unique.length > 1 ? '等' : ''}`;
}

export function pricingBatchNameBase(
  receivedAt: string,
  groups: NamedRecord[],
  distributors: NamedRecord[],
) {
  return `${firstName(groups, '未关联计价组')}-${receivedAt}-${firstName(distributors, '未知渠道商')}`;
}

export function availablePricingBatchName(base: string, occupied: Iterable<string>) {
  const names = new Set(occupied);
  let name = base;
  for (let number = 2; names.has(name); number++) name = `${base}（${number}）`;
  return name;
}
