const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function formatCategoryPrefix(index: number) {
  if (!Number.isInteger(index) || index < 0)
    throw new Error('Category prefix index must be nonnegative');

  let value = index;
  let prefix = '';
  do {
    prefix = ALPHABET[value % ALPHABET.length] + prefix;
    value = Math.floor(value / ALPHABET.length) - 1;
  } while (value >= 0);
  return prefix;
}

export function getNextCategoryPrefix(existingPrefixes: Iterable<string | null | undefined>) {
  const used = new Set([...existingPrefixes].filter((prefix): prefix is string => Boolean(prefix)));
  for (let index = 0; ; index += 1) {
    const prefix = formatCategoryPrefix(index);
    if (!used.has(prefix)) return prefix;
  }
}

export function formatProductCode(prefix: string, productCount: number) {
  return `${prefix}${String(productCount + 1).padStart(4, '0')}`;
}

export function parseProductCode(code: string) {
  const match = /^([A-Z]+)(\d{4})$/.exec(code);
  return match
    ? { prefix: match[1], sequence: Number(match[2]) }
    : { prefix: null, sequence: null };
}
