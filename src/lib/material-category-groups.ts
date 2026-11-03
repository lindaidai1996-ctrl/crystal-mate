export const MATERIAL_CATEGORY_GROUP_NAMES = {
  silver: ['S925银配饰', '合金配饰', '镀K18金-银配饰'],
  hetian: ['和田玉', '和田玉配饰'],
} as const;

export type MaterialCategoryGroup = keyof typeof MATERIAL_CATEGORY_GROUP_NAMES;

type Category = { id: string; name: string; parentId: string | null };

export function materialCategorySubtreeIds(categories: Category[], roots: string[]) {
  const ids = new Set(roots);
  const queue = [...ids];
  for (let index = 0; index < queue.length; index++) {
    for (const category of categories) {
      if (category.parentId !== queue[index] || ids.has(category.id)) continue;
      ids.add(category.id);
      queue.push(category.id);
    }
  }
  return ids;
}

export function materialCategoryGroupIds(categories: Category[], group: MaterialCategoryGroup) {
  const names: readonly string[] = MATERIAL_CATEGORY_GROUP_NAMES[group];
  return materialCategorySubtreeIds(
    categories,
    categories.filter((category) => names.includes(category.name)).map((category) => category.id),
  );
}

export function materialGroupCategories<T extends Category>(
  categories: T[],
  group?: MaterialCategoryGroup,
): T[] {
  if (!group) return categories;
  const ids = materialCategoryGroupIds(categories, group);
  return categories
    .filter((category) => ids.has(category.id))
    .map((category) => ({
      ...category,
      parentId: category.parentId && ids.has(category.parentId) ? category.parentId : null,
    }));
}
