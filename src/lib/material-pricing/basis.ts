import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { pricingAmount, pricingRate, type PricingCostBasis } from './contracts';

const basisSchema = z.strictObject({
  groupId: z.string().cuid(),
  publicationId: z.string().cuid(),
  name: z.string().min(1).max(120),
  rawCost: pricingAmount,
  adjustedCost: pricingAmount,
  lossRate: pricingRate,
  capturedAt: z.iso.datetime(),
});
function signature(payload: string) {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('Authentication secret is required for pricing snapshots');
  return createHmac('sha256', secret).update(`material-pricing-v1:${payload}`).digest();
}
export function signCostBasis(basis: PricingCostBasis) {
  const payload = Buffer.from(JSON.stringify(basisSchema.parse(basis))).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}
export function readCostBasis(token: string): PricingCostBasis | null {
  try {
    const [payload, encoded, extra] = token.split('.');
    if (!payload || !encoded || extra) return null;
    const supplied = Buffer.from(encoded, 'base64url');
    const expected = signature(payload);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    return basisSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}
