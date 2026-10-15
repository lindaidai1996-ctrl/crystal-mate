'use client';

import { App, AutoComplete, Button, Drawer, Form, Input, Space } from 'antd';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { Distributor, DistributorValues } from '@/lib/client-types';
import { BatchAttachmentPicker } from './materialManagement/batchAttachmentPicker';

export function DistributorEditorDrawer({
  distributor,
  areas,
  onClose,
  onSaved,
}: {
  distributor: Distributor | null;
  areas: string[];
  onClose: () => void;
  onSaved: (value: Distributor) => void;
}) {
  const t = useTranslations('distributors');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [form] = Form.useForm<DistributorValues>();
  const [attachments, setAttachments] = useState<Distributor['attachments']>(
    distributor?.attachments ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  function areaLabel(area: string) {
    if (area === '东海') return t('donghai');
    if (area === '可塘') return t('ketang');
    if (area === '网络') return t('online');
    return area;
  }

  async function save() {
    const values = await form.validateFields().catch(() => null);
    if (!values || uploading || saving) return;
    setSaving(true);
    try {
      const saved = await apiFetch<Distributor>(
        distributor ? `/api/distributors/${distributor.id}` : '/api/distributors',
        {
          method: distributor ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...values,
            attachments: attachments.map(({ objectKey, fileName, notes }) => ({
              objectKey,
              fileName,
              notes,
            })),
          }),
        },
      );
      message.success(common('saved'));
      onSaved(saved);
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={distributor ? t('editTitle') : t('newTitle')}
      placement="right"
      open
      onClose={() => !uploading && !saving && onClose()}
      closable={!uploading && !saving}
      maskClosable={!uploading && !saving}
      keyboard={!uploading && !saving}
      width="min(520px, 100vw)"
      forceRender
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button disabled={uploading || saving} onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button type="primary" loading={saving} disabled={uploading} onClick={save}>
            {common('save')}
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        disabled={saving}
        layout="vertical"
        onFinish={save}
        initialValues={{
          name: distributor?.name ?? '',
          area: distributor?.area ?? '',
          address: distributor?.address ?? '',
          wechat: distributor?.wechat ?? '',
          phone: distributor?.phone ?? '',
          notes: distributor?.notes ?? '',
        }}
      >
        <Form.Item
          name="name"
          label={t('name')}
          rules={[{ required: true, whitespace: true, max: 120 }]}
        >
          <Input maxLength={120} autoFocus />
        </Form.Item>
        <Form.Item
          name="area"
          label={t('area')}
          rules={[{ required: true, whitespace: true, max: 60 }]}
        >
          <AutoComplete
            options={areas.map((area) => ({ value: area, label: areaLabel(area) }))}
            placeholder={t('areaPlaceholder')}
            filterOption={(input, option) =>
              `${option?.value ?? ''} ${option?.label ?? ''}`
                .toLocaleLowerCase()
                .includes(input.toLocaleLowerCase())
            }
            maxLength={60}
          />
        </Form.Item>
        <Form.Item name="address" label={t('address')} rules={[{ max: 300 }]}>
          <Input maxLength={300} />
        </Form.Item>
        <Form.Item name="wechat" label={t('wechat')} rules={[{ max: 100 }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="phone" label={t('phone')} rules={[{ max: 50 }]}>
          <Input maxLength={50} />
        </Form.Item>
        <Form.Item name="notes" label={t('notes')} rules={[{ max: 10000 }]}>
          <Input.TextArea rows={3} maxLength={10000} />
        </Form.Item>
        <Form.Item label={t('attachments')}>
          <BatchAttachmentPicker
            attachments={attachments}
            onChange={setAttachments}
            onUploadingChange={setUploading}
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
