'use client';

import { Form, Input, Select } from 'antd';
import { useTranslations } from 'next-intl';
import { DateInput } from '@/components/date-input';
import type { MaterialBatch, MaterialBatchSelection } from '@/lib/client-types';

export function todayInChina() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function BatchSelector({
  selection,
  onChange,
  batches,
}: {
  selection: MaterialBatchSelection | null;
  onChange: (selection: MaterialBatchSelection | null) => void;
  batches: MaterialBatch[];
}) {
  const t = useTranslations('materialBatches');
  const newBatch = selection && 'newBatch' in selection ? selection.newBatch : null;
  const value = newBatch ? '__new__' : selection?.batchId;

  function changeNew(field: 'name' | 'receivedAt' | 'notes', value: string) {
    onChange({
      newBatch: {
        name: '',
        receivedAt: todayInChina(),
        notes: '',
        ...newBatch,
        [field]: value,
      },
    });
  }

  return (
    <section className="editor-block">
      <h2>{t('batch')}</h2>
      <div className="material-field-grid">
        <Form.Item label={t('choose')} required>
          <Select
            aria-label={t('choose')}
            showSearch
            optionFilterProp="label"
            value={value}
            placeholder={t('choose')}
            options={[
              ...batches.map((batch) => ({
                value: batch.id,
                label: batch.name,
              })),
              { value: '__new__', label: t('create') },
            ]}
            onChange={(next) =>
              onChange(
                next === '__new__'
                  ? {
                      newBatch: {
                        name: '',
                        receivedAt: todayInChina(),
                        notes: '',
                      },
                    }
                  : { batchId: next },
              )
            }
          />
        </Form.Item>
        {newBatch && (
          <>
            <Form.Item label={t('name')} required>
              <Input
                aria-label={t('name')}
                value={newBatch.name}
                maxLength={120}
                onChange={(event) => changeNew('name', event.target.value)}
              />
            </Form.Item>
            <Form.Item label={t('date')} required>
              <DateInput
                aria-label={t('date')}
                value={newBatch.receivedAt}
                onChange={(date) => changeNew('receivedAt', date)}
              />
            </Form.Item>
            <Form.Item label={t('notes')} className="material-full-width">
              <Input.TextArea
                aria-label={t('notes')}
                value={newBatch.notes}
                maxLength={10000}
                rows={2}
                onChange={(event) => changeNew('notes', event.target.value)}
              />
            </Form.Item>
          </>
        )}
      </div>
    </section>
  );
}
