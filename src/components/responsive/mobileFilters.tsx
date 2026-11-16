'use client';

import { DownOutlined } from '@ant-design/icons';
import { Button, Drawer } from 'antd';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { useMobile } from './useMobile';
import mobileStyles from './responsive.module.css';

export type MobileFilterGroup<T> = {
  key: string;
  label: string;
  active?: boolean;
  count?: number;
  height?: string;
  render: (draft: T, update: (patch: Partial<T>) => void) => ReactNode;
  reset: (draft: T) => T;
  valid?: (draft: T) => boolean;
};

// Draft values live only in the sheet. Closing it never changes the applied filters.
export function MobileFilters<T>({
  value,
  groups,
  onApply,
  search,
  children,
}: {
  value: T;
  groups: MobileFilterGroup<T>[];
  onApply: (value: T) => void;
  search: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('mobile');
  const mobile = useMobile();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [draft, setDraft] = useState(value);
  const group = groups.find((item) => item.key === activeKey);

  return (
    <>
      <div className={mobileStyles.desktop}>{children}</div>
      <div className={mobileStyles.mobile}>
        <div className={mobileStyles.search}>{search}</div>
        <nav className={mobileStyles.filterBar} aria-label={t('filters')}>
          {groups.map((item) => (
            <Button
              autoInsertSpace={false}
              key={item.key}
              type="text"
              className={item.active ? mobileStyles.active : undefined}
              aria-haspopup="dialog"
              aria-expanded={mobile && activeKey === item.key}
              onClick={() => {
                setDraft(value);
                setActiveKey(item.key);
              }}
            >
              <span className={mobileStyles.filterLabel}>{item.label}</span>
              {!!item.count && <span className={mobileStyles.count}>{item.count}</span>}
              <DownOutlined aria-hidden />
            </Button>
          ))}
        </nav>
      </div>
      <Drawer
        title={group?.label}
        placement="bottom"
        height={group?.height ?? 'min(78dvh, 720px)'}
        open={mobile && !!group}
        onClose={() => setActiveKey(null)}
        rootClassName={mobileStyles.filterSheet}
        destroyOnHidden
        footer={
          <div className={mobileStyles.sheetActions}>
            <Button autoInsertSpace={false} onClick={() => group && setDraft(group.reset(draft))}>
              {t('reset')}
            </Button>
            <Button
              autoInsertSpace={false}
              type="primary"
              disabled={group?.valid ? !group.valid(draft) : false}
              onClick={() => {
                onApply(draft);
                setActiveKey(null);
              }}
            >
              {t('apply')}
            </Button>
          </div>
        }
      >
        {group?.render(draft, (patch) => setDraft((current) => ({ ...current, ...patch })))}
      </Drawer>
    </>
  );
}

export function FilterChoices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className={mobileStyles.choiceGroup}>
      <legend>{label}</legend>
      <div className={mobileStyles.choices}>
        {options.map((option) => (
          <Button
            autoInsertSpace={false}
            key={option.value}
            color={value === option.value ? 'primary' : 'default'}
            variant={value === option.value ? 'filled' : 'outlined'}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
