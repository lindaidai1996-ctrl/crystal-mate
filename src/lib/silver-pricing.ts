import { db } from '@/lib/db';
import { silverPricingSchema } from '@/lib/validation';
import { DEFAULT_SILVER_PRICING, type SilverPricing } from '@/lib/silver-cost';

const singletonId = 'default';

function serialize(pricing: {
  costGramPrice: { toFixed: (digits: number) => string };
  quoteGramPrice: { toFixed: (digits: number) => string };
}): SilverPricing {
  return {
    costGramPrice: pricing.costGramPrice.toFixed(2),
    quoteGramPrice: pricing.quoteGramPrice.toFixed(2),
  };
}

export async function getSilverPricing(): Promise<SilverPricing> {
  const pricing = await db.silverPricing.findUnique({ where: { id: singletonId } });
  return pricing ? serialize(pricing) : { ...DEFAULT_SILVER_PRICING };
}

export async function saveSilverPricing(input: SilverPricing): Promise<SilverPricing> {
  const data = silverPricingSchema.parse(input);
  return serialize(
    await db.silverPricing.upsert({
      where: { id: singletonId },
      create: { id: singletonId, ...data },
      update: data,
    }),
  );
}
