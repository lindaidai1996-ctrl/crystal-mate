export const catalogScopes = {
  cabochons: { key: 'cabochons', categoryName: '蛋面', titleKey: 'cabochons' },
  'finished-strands': {
    key: 'finished-strands',
    titleKey: 'finishedStrands',
  },
} as const;

export type CatalogScopeKey = keyof typeof catalogScopes;
export type CatalogScope = (typeof catalogScopes)[CatalogScopeKey];

export function getCatalogScope(key: string): CatalogScope | undefined {
  return Object.prototype.hasOwnProperty.call(catalogScopes, key)
    ? catalogScopes[key as CatalogScopeKey]
    : undefined;
}

export function catalogPath(key: CatalogScopeKey) {
  return `/admin/catalog/${key}`;
}
