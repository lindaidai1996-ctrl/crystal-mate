/** Exact decimal inputs and rational intermediates; only the final price is rounded. */
export const variables = ['cost', 'costWithLabor', 'quote', 'direct'] as const;
export type Variable = (typeof variables)[number];
export type Variables = Record<Variable, string | null>;
export type Rounding = 'CENT' | 'YUAN_UP' | 'TEN_UP';
export type FormulaError = 'SYNTAX' | 'MISSING' | 'NOT_APPLICABLE' | 'DIVISION_ZERO' | 'RANGE';
type Fraction = { n: bigint; d: bigint };
type Node = { value: string } | { op: string; left: Node; right: Node };
const aliases: Record<string, Variable> = {
  '单件成本合计＋手工费': 'costWithLabor',
  '单件成本合计+手工费': 'costWithLabor',
  单件成本合计: 'cost',
  单件对客报价: 'quote',
  直售价: 'direct',
};
export class FormulaFailure extends Error {
  constructor(public code: FormulaError) {
    super(code);
  }
}
function fail(code: FormulaError): never {
  throw new FormulaFailure(code);
}
function fraction(n: bigint, d = BigInt(1)): Fraction {
  if (d === BigInt(0)) fail('DIVISION_ZERO');
  if (d < BigInt(0)) {
    n = -n;
    d = -d;
  }
  if (n.toString().length > 4096 || d.toString().length > 4096) fail('RANGE');
  let a = n < BigInt(0) ? -n : n,
    b = d;
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return { n: n / a, d: d / a };
}
function decimal(value: string): Fraction {
  if (/^\d{1,40}\/\d{1,22}$/.test(value)) {
    const [n, d] = value.split('/');
    return fraction(BigInt(n), BigInt(d));
  }
  if (!/^\d{1,22}(?:\.\d{1,12})?$/.test(value)) fail('RANGE');
  const [whole, part = ''] = value.split('.');
  return fraction(BigInt(whole + part), BigInt(10) ** BigInt(part.length));
}
export function parseFormula(formula: string) {
  if (!formula.trim() || formula.length > 1000) fail('SYNTAX');
  let text = formula;
  for (const [label, key] of Object.entries(aliases)) text = text.replaceAll(label, key);
  text = text
    .replaceAll('×', '*')
    .replaceAll('÷', '/')
    .replaceAll('−', '-')
    .replaceAll('＋', '+')
    .replaceAll('（', '(')
    .replaceAll('）', ')');
  const tokens = text.match(/[A-Za-z]+|\d+(?:\.\d+)?|[^\s]/g) ?? [];
  if (tokens.length > 128) fail('SYNTAX');
  let cursor = 0;
  const dependencies = new Set<Variable>();
  function atom(): Node {
    const token = tokens[cursor++];
    let node: Node;
    if (token === '(') {
      node = expression();
      if (tokens[cursor++] !== ')') fail('SYNTAX');
    } else if (token === '+' || token === '-') {
      node = { op: token, left: { value: '0' }, right: atom() };
    } else if (variables.includes(token as Variable)) {
      dependencies.add(token as Variable);
      node = { value: token };
    } else if (token && /^\d{1,16}(?:\.\d{1,8})?$/.test(token)) {
      node = { value: token };
    } else return fail('SYNTAX');
    if (tokens[cursor] === '%') {
      cursor++;
      node = { op: '/', left: node, right: { value: '100' } };
    }
    return node;
  }
  function product(): Node {
    let left = atom();
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const op = tokens[cursor++];
      left = { op, left, right: atom() };
    }
    return left;
  }
  function expression(): Node {
    let left = product();
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const op = tokens[cursor++];
      left = { op, left, right: product() };
    }
    return left;
  }
  const tree = expression();
  if (cursor !== tokens.length) fail('SYNTAX');
  return { tree, dependencies: [...dependencies].sort() };
}
function evaluate(node: Node, values: Variables): Fraction {
  if ('value' in node) {
    if (!variables.includes(node.value as Variable)) return decimal(node.value);
    const value = values[node.value as Variable];
    return value === null ? fail('MISSING') : decimal(value);
  }
  const a = evaluate(node.left, values),
    b = evaluate(node.right, values);
  switch (node.op) {
    case '+':
      return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
    case '-':
      return fraction(a.n * b.d - b.n * a.d, a.d * b.d);
    case '*':
      return fraction(a.n * b.n, a.d * b.d);
    default:
      return fraction(a.n * b.d, a.d * b.n);
  }
}
export function calculateScheme(
  formula: string,
  rounding: Rounding,
  values: Variables,
  applicable: Variable[] = [...variables],
): { amountCents: number | null; error: FormulaError | null } {
  try {
    const { tree, dependencies } = parseFormula(formula);
    if (dependencies.some((key) => !applicable.includes(key))) fail('NOT_APPLICABLE');
    const value = evaluate(tree, values);
    if (value.n < BigInt(0)) fail('RANGE');
    const numerator = value.n * BigInt(100);
    const step =
      rounding === 'TEN_UP' ? BigInt(1000) : rounding === 'YUAN_UP' ? BigInt(100) : BigInt(1);
    const divisor = value.d * step;
    const amount =
      rounding === 'CENT'
        ? (numerator * BigInt(2) + divisor) / (divisor * BigInt(2))
        : ((numerator + divisor - BigInt(1)) / divisor) * step;
    if (amount > BigInt(2147483647)) fail('RANGE');
    return { amountCents: Number(amount), error: null };
  } catch (error) {
    if (!(error instanceof FormulaFailure)) throw error;
    return { amountCents: null, error: error.code };
  }
}
