'use client';

import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import dayjs from 'dayjs';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { DateRange } from '@/lib/date-range';
import mobileStyles from './responsive.module.css';

export function validMobileDateRange(value: DateRange) {
  return !value || Boolean(value[0] && value[1] && value[0] <= value[1]);
}

export function MobileDateRange({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (value: DateRange) => void;
}) {
  const t = useTranslations('mobile');
  const dateText = useTranslations('dateRangeFilter');
  const locale = useLocale() === 'en' ? 'en-US' : 'zh-CN';
  // Creation filters use Beijing wall time even if the browser is in another timezone.
  const [today] = useState(() =>
    dayjs(new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)),
  );
  const [month, setMonth] = useState(() =>
    dayjs(value?.[0] || today.format('YYYY-MM-DD')).startOf('month'),
  );
  const [active, setActive] = useState<0 | 1>(value?.[0] && !value[1] ? 1 : 0);
  const start = value?.[0]?.slice(0, 10) ?? '';
  const end = value?.[1]?.slice(0, 10) ?? '';
  const timeAt = (index: 0 | 1) =>
    value?.[index]?.slice(11, 16) || (index === 0 ? '00:00' : '23:59');
  const presets = [
    { key: 'today', start: today },
    { key: 'last7Days', start: today.subtract(6, 'day') },
    { key: 'last30Days', start: today.subtract(29, 'day') },
    { key: 'thisMonth', start: today.startOf('month') },
  ];
  const firstDayOffset = (month.day() + 6) % 7;
  const days = Array.from({ length: firstDayOffset + month.daysInMonth() }, (_, index) =>
    index < firstDayOffset ? null : month.date(index - firstDayOffset + 1),
  );
  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });

  function selectDate(date: string) {
    if (active === 0 || !start || date < start) {
      onChange([`${date}T${timeAt(0)}`, end && date <= end ? value![1] : '']);
      setActive(1);
    } else {
      onChange([value![0], `${date}T${timeAt(1)}`]);
    }
  }

  function changeTime(index: 0 | 1, part: 0 | 1, next: string) {
    if (!value?.[index]) return;
    const time = timeAt(index).split(':');
    time[part] = next;
    const range: [string, string] = [...value];
    range[index] = `${range[index].slice(0, 10)}T${time.join(':')}`;
    onChange(range);
  }

  return (
    <fieldset className={mobileStyles.choiceGroup}>
      <legend>{dateText('created')}</legend>
      <div className={mobileStyles.datePresets}>
        {presets.map((preset) => {
          const range: [string, string] = [
            `${preset.start.format('YYYY-MM-DD')}T00:00`,
            `${today.format('YYYY-MM-DD')}T23:59`,
          ];
          const selected = value?.[0] === range[0] && value?.[1] === range[1];
          return (
            <Button
              key={preset.key}
              autoInsertSpace={false}
              color={selected ? 'primary' : 'default'}
              variant={selected ? 'filled' : 'outlined'}
              aria-pressed={selected}
              onClick={() => {
                onChange(range);
                setMonth(preset.start.startOf('month'));
                setActive(0);
              }}
            >
              {t(preset.key)}
            </Button>
          );
        })}
      </div>
      <div className={mobileStyles.dateEndpoints}>
        {([0, 1] as const).map((index) => (
          <Button
            key={index}
            autoInsertSpace={false}
            className={active === index ? mobileStyles.dateEndpointActive : undefined}
            aria-pressed={active === index}
            onClick={() => {
              setActive(index);
              setMonth(dayjs(value?.[index] || today.format('YYYY-MM-DD')).startOf('month'));
            }}
          >
            <span>{t(index === 0 ? 'start' : 'end')}</span>
            <strong>{value?.[index] ? value[index].slice(0, 10) : t('selectDate')}</strong>
          </Button>
        ))}
      </div>
      <p className={mobileStyles.dateHint} aria-live="polite">
        {t(active === 0 ? 'pickStart' : 'pickEnd')}
      </p>
      <div className={mobileStyles.calendarHeader}>
        <Button
          icon={<LeftOutlined />}
          aria-label={t('previousMonth')}
          onClick={() => setMonth(month.subtract(1, 'month'))}
        />
        <select
          className={mobileStyles.calendarSelect}
          aria-label={t('year')}
          value={month.year()}
          onChange={(event) => setMonth(month.year(Number(event.target.value)))}
        >
          {Array.from({ length: Math.max(today.year(), month.year()) + 11 - 1900 }, (_, index) => (
            <option key={index} value={1900 + index}>
              {1900 + index}
            </option>
          ))}
        </select>
        <select
          className={mobileStyles.calendarSelect}
          aria-label={t('month')}
          value={month.month()}
          onChange={(event) => setMonth(month.month(Number(event.target.value)))}
        >
          {Array.from({ length: 12 }, (_, index) => (
            <option key={index} value={index}>
              {new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2026, index, 1))}
            </option>
          ))}
        </select>
        <Button
          icon={<RightOutlined />}
          aria-label={t('nextMonth')}
          onClick={() => setMonth(month.add(1, 'month'))}
        />
      </div>
      <div className={mobileStyles.calendar} role="group" aria-label={month.format('YYYY-MM')}>
        {Array.from({ length: 7 }, (_, index) => (
          <span key={`weekday-${index}`} className={mobileStyles.weekday} aria-hidden>
            {weekdayFormatter.format(new Date(Date.UTC(2026, 0, 5 + index)))}
          </span>
        ))}
        {days.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} />;
          const date = day.format('YYYY-MM-DD');
          const endpoint = date === start || date === end;
          const inRange = Boolean(start && end && date >= start && date <= end);
          return (
            <button
              key={date}
              type="button"
              className={[
                mobileStyles.calendarDay,
                endpoint && mobileStyles.calendarEndpoint,
                inRange && mobileStyles.calendarInRange,
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={date}
              aria-pressed={endpoint}
              aria-current={date === today.format('YYYY-MM-DD') ? 'date' : undefined}
              onClick={() => selectDate(date)}
            >
              {day.date()}
            </button>
          );
        })}
      </div>
      <details className={mobileStyles.preciseTime}>
        <summary>{t('preciseTime')}</summary>
        {([0, 1] as const).map((index) => (
          <div key={index} className={mobileStyles.timeRow}>
            <span>{t(index === 0 ? 'start' : 'end')}</span>
            {([0, 1] as const).map((part) => (
              <select
                key={part}
                className={mobileStyles.calendarSelect}
                aria-label={`${t(index === 0 ? 'start' : 'end')} ${t(part === 0 ? 'hour' : 'minute')}`}
                disabled={!value?.[index]}
                value={timeAt(index).split(':')[part]}
                onChange={(event) => changeTime(index, part, event.target.value)}
              >
                {Array.from({ length: part === 0 ? 24 : 60 }, (_, number) => (
                  <option key={number} value={String(number).padStart(2, '0')}>
                    {String(number).padStart(2, '0')}
                  </option>
                ))}
              </select>
            ))}
          </div>
        ))}
      </details>
      {value && (
        <Button
          type="link"
          autoInsertSpace={false}
          onClick={() => {
            onChange(null);
            setActive(0);
          }}
        >
          {t('clearDates')}
        </Button>
      )}
      {value?.[0] && value[1] && value[0] > value[1] && <p role="alert">{t('invalidRange')}</p>}
    </fieldset>
  );
}
