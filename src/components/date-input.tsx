'use client';

import { DatePicker, type DatePickerProps } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { useLocale } from 'next-intl';

const DATE_FORMAT = 'YYYY-MM-DD';

type DateInputProps = Pick<
  DatePickerProps,
  'id' | 'aria-label' | 'disabled' | 'status' | 'onBlur'
> & {
  value: string;
  onChange: (value: string) => void;
};

export function DateInput({ value, onChange, ...props }: DateInputProps) {
  const locale = useLocale() === 'en' ? 'en' : 'zh-cn';

  return (
    <DatePicker
      {...props}
      style={{ width: '100%' }}
      format={DATE_FORMAT}
      value={value ? dayjs(value).locale(locale) : null}
      onChange={(date) => onChange(date?.format(DATE_FORMAT) ?? '')}
    />
  );
}
