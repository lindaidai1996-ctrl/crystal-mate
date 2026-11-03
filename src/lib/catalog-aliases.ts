export function normalizeAliases(aliases: string[]): string[] {
  const seen = new Set<string>();
  return aliases.flatMap((alias) => {
    const name = alias.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [name];
  });
}
