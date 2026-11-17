'use client';

import { CalendarOutlined, RightOutlined } from '@ant-design/icons';
import { Button, DatePicker, Drawer } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { DateRange } from '@/lib/date-range';
import { MobileDateRange, validMobileDateRange } from './responsive/mobileDateRange';
import { useMobile } from './responsive/useMobile';
import mobileStyles from './responsive/responsive.module.css';
import dateRangeStyles from './date-range-filter.module.css';

type Props = {
  kind: 'created' | 'received';
  label?: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
};

export function DateRangeFilter({ kind, label, value, onChange }: Props) {
  const t = useTranslations('dateRangeFilter');
  const mobileText = useTranslations('mobile');
  const locale = useLocale() === 'en' ? 'en' : 'zh-cn';
  const mobile = useMobile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const withTime = kind === 'created';
  const format = withTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD';
  const wireFormat = withTime ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD';
  const title = label ?? t(kind);

  if (mobile) {
    return (
      <>
        <Button
          className={dateRangeStyles.mobileTrigger}
          icon={<CalendarOutlined />}
          aria-label={title}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setDraft(value);
            setOpen(true);
          }}
        >
          <span className={dateRangeStyles.triggerText}>
            <span>{title}</span>
            {value && (
              <strong>{value.map((date) => dayjs(date).format(format)).join(' → ')}</strong>
            )}
          </span>
          <RightOutlined className={dateRangeStyles.triggerArrow} />
        </Button>
        <Drawer
          title={title}
          placement="bottom"
          height="min(90dvh, 800px)"
          open={open}
          rootClassName={`${mobileStyles.filterSheet} ${dateRangeStyles.mobileSheet}`}
          onClose={() => setOpen(false)}
          destroyOnHidden
          footer={
            <div className={mobileStyles.sheetActions}>
              <Button autoInsertSpace={false} onClick={() => setDraft(null)}>
                {mobileText('reset')}
              </Button>
              <Button
                type="primary"
                autoInsertSpace={false}
                disabled={!validMobileDateRange(draft)}
                onClick={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              >
                {mobileText('apply')}
              </Button>
            </div>
          }
        >
          {open && (
            <MobileDateRange
              kind={kind}
              label={title}
              hideLabel
              value={draft}
              onChange={setDraft}
            />
          )}
        </Drawer>
      </>
    );
  }

  return (
    <DatePicker.RangePicker
      className={withTime ? dateRangeStyles.dateTime : dateRangeStyles.date}
      aria-label={title}
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
