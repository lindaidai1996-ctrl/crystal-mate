'use client';

import { Skeleton } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import switcherStyles from './materialPricingGroupSwitcher.module.css';

export function MaterialPricingGroupSwitcher({
  groups,
  selected,
  loading,
  onChange,
}: {
  groups: { id: string; name: string }[];
  selected?: string;
  loading: boolean;
  onChange: (id: string) => void;
}) {
  const t = useTranslations('materialPricing');
  const common = useTranslations('common');
  return (
    <section
      className={switcherStyles.section}
      aria-label={t('chooseGroup')}
      aria-busy={loading && !groups.length}
    >
      <span className={switcherStyles.label}>{t('groupName')}</span>
      {loading && !groups.length ? (
        <div className={switcherStyles.options} role="status" aria-label={common('loading')}>
          {[120, 144, 112].map((width) => (
            <Skeleton.Button key={width} active style={{ width, height: 44 }} />
          ))}
        </div>
      ) : groups.length ? (
        <div className={switcherStyles.options} role="group" aria-label={t('chooseGroup')}>
          {[...groups]
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
            .map((group) => (
              <button
                key={group.id}
                type="button"
                aria-pressed={selected === group.id}
                onClick={() => onChange(group.id)}
              >
                <span>{group.name}</span>
                <CheckOutlined aria-hidden="true" className={switcherStyles.check} />
              </button>
            ))}
        </div>
      ) : null}
    </section>
  );
}
