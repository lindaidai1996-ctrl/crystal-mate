import { db } from '@/lib/db';
import { DEFAULT_DIY_COMMON_FEES, diyCommonFeesSchema } from '@/lib/diy-common-fees';

const singletonId = 'default';

export async function getDiyCommonFees() {
  const settings = await db.diyCommonFeeSettings.findUnique({ where: { id: singletonId } });
  return settings ? diyCommonFeesSchema.parse(settings.fees) : DEFAULT_DIY_COMMON_FEES;
}

export async function saveDiyCommonFees(input: unknown) {
  const fees = diyCommonFeesSchema.parse(input);
  const settings = await db.diyCommonFeeSettings.upsert({
    where: { id: singletonId },
    create: { id: singletonId, fees },
    update: { fees },
  });
  return diyCommonFeesSchema.parse(settings.fees);
}
