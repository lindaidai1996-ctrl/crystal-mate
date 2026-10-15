import type { MaterialCategory } from '@/lib/client-types';

export type CategoryNode = {
  value: string;
  label: string;
  children?: CategoryNode[];
};

export function categoryTree(categories: MaterialCategory[], excludedIds = new Set<string>()) {
  function children(parentId: string | null): CategoryNode[] {
    return categories
      .filter((category) => category.parentId === parentId && !excludedIds.has(category.id))
      .map((category) => {
        const descendants = children(category.id);
        return descendants.length
          ? { value: category.id, label: category.name, children: descendants }
          : { value: category.id, label: category.name };
      });
  }
  return children(null);
}

export function categoryPath(id: string | null, categories: MaterialCategory[]): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let cursor = id;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const category = categories.find((item) => item.id === cursor);
    if (!category) break;
    path.unshift(category.id);
    cursor = category.parentId;
  }
  return path;
}

export function categoryDescendants(id: string, categories: MaterialCategory[]) {
  const result = new Set([id]);
  const queue = [id];
  for (let index = 0; index < queue.length; index++) {
    for (const child of categories.filter((category) => category.parentId === queue[index])) {
      if (result.has(child.id)) continue;
      result.add(child.id);
      queue.push(child.id);
    }
  }
  return result;
}
