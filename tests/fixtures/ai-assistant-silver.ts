import { semanticFixture } from './ai-assistant-semantics';

// Regression examples from the six omitted November purchase rows. No business
// identities or category IDs are special-cased in the production policy.
export const platedSilverNames = [
  '6mm18K镀金S925银跑环',
  '2.5m18K镀金S925银圆珠配饰',
  '18K镀金S925银车花直管配饰',
  '2mm18K镀金S925银钉针',
  '30mm18K镀金S925银圆头针',
  '2mm18K镀金S925碎银方形',
];

export function platedSilverFixture(name = platedSilverNames[0]) {
  const candidate = semanticFixture(name, '18K镀金-银配饰', ['18K镀金', '银配饰']);
  candidate.evidence.push({
    entity: candidate.evidence[3].entity,
    field: 'aliases',
    value: ['镀18K金'],
  });
  return candidate;
}
