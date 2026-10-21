type NamedOption = { id: string; name: string };

function normalizeName(name: string) {
  return name.normalize('NFKC').trim().toLowerCase();
}

export function recognizeProductName(name: string, categories: NamedOption[], tags: NamedOption[]) {
  const input = normalizeName(name);
  const matches = (option: NamedOption) => {
    const term = normalizeName(option.name);
    return term.length > 0 && input.includes(term);
  };
  const matchedCategories = categories.filter(matches);
  const longestLength = Math.max(
    0,
    ...matchedCategories.map((category) => normalizeName(category.name).length),
  );
  const bestCategories = matchedCategories.filter(
    (category) => normalizeName(category.name).length === longestLength,
  );

  return {
    categoryId: bestCategories.length === 1 ? bestCategories[0].id : undefined,
    tagIds: tags.filter(matches).map((tag) => tag.id),
  };
}
