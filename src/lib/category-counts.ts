export type CategoryCounts = {
  total: number;
  byCategory: Record<string, number>;
};

// Each record contributes once to its own category and to each ancestor.
export function summarizeCategoryCounts(
  groups: { categoryId: string; _count: { _all: number } }[],
  categories: { id: string; parentId: string | null }[] = [],
): CategoryCounts {
  const parents = new Map(categories.map((category) => [category.id, category.parentId]));
  const counts = new Map(categories.map((category) => [category.id, 0]));
  let total = 0;
  for (const group of groups) {
    const count = group._count._all;
    total += count;
    const visited = new Set<string>();
    let id: string | null | undefined = group.categoryId;
    while (id && !visited.has(id)) {
      visited.add(id);
      counts.set(id, (counts.get(id) ?? 0) + count);
      id = parents.get(id);
    }
  }
  return { total, byCategory: Object.fromEntries(counts) };
}
