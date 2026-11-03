'use client';

import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { useLocale, useTranslations } from 'next-intl';
import type { DateRange } from '@/lib/date-range';
import dateRangeStyles from './date-range-filter.module.css';

type Props = {
  kind: 'created' | 'received';
  value: DateRange;
  onChange: (range: DateRange) => void;
};

export function DateRangeFilter({ kind, value, onChange }: Props) {
  const t = useTranslations('dateRangeFilter');
  const locale = useLocale() === 'en' ? 'en' : 'zh-cn';
  const withTime = kind === 'created';
  const format = withTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD';
  const wireFormat = withTime ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD';

  return (
    <DatePicker.RangePicker
      className={withTime ? dateRangeStyles.dateTime : dateRangeStyles.date}
      aria-label={t(kind)}
      placeholder={[t(`${kind}Start`), t(`${kind}End`)]}
      title={t(withTime ? 'beijingTime' : 'received')}
      format={format}
      showTime={
        withTime
          ? {
              format: 'HH:mm',
              showSecond: false,
              defaultOpenValue: [dayjs('2000-01-01T00:00'), dayjs('2000-01-01T23:59')],
            }
          : false
      }
      value={value ? [dayjs(value[0]).locale(locale), dayjs(value[1]).locale(locale)] : null}
      onChange={(dates) =>
        onChange(
          dates?.[0] && dates[1]
            ? [dates[0].format(wireFormat), dates[1].format(wireFormat)]
            : null,
        )
      }
      allowClear
    />
  );
}
