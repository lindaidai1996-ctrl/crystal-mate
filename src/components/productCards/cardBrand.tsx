'use client';

import { useEffect, useRef, useState } from 'react';
import { App, Button, Checkbox, Input } from 'antd';
import { UploadOutlined, DeleteOutlined } from '@ant-design/icons';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import { cardAssetUrl, cardErrorMessages, type CardBrand } from '@/lib/product-cards/contracts';
import cardStyles from './productCards.module.css';

function BrandImage({
  label,
  assetId,
  onChange,
}: {
  label: string;
  assetId: string | null;
  onChange: (id: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { message } = App.useApp();
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      if (file.size > 8 * 1024 * 1024) throw new ClientApiError('INVALID_IMAGE');
      const body = new FormData();
      body.append('file', file);
      const asset = await apiFetch<{ id: string }>('/api/product-card-assets', {
        method: 'POST',
        body,
      });
      onChange(asset.id);
    } catch (error) {
      message.error(
        cardErrorMessages[error instanceof ClientApiError ? error.code : ''] ??
          '图片上传失败，请重试。',
      );
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className={cardStyles.brandImage}>
      <span>{label}</span>
      {assetId && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cardAssetUrl(assetId)} alt={label} />
        </>
      )}
      <input
        ref={input}
        hidden
        style={{ display: 'none' }}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={`上传${label}`}
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <Button icon={<UploadOutlined />} loading={uploading} onClick={() => input.current?.click()}>
        {assetId ? '替换' : '上传'}
        {label}
      </Button>
      {assetId && (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onChange(null)}
          aria-label={`移除${label}`}
        />
      )}
    </div>
  );
}
export function CardBrandEditor({
  value,
  onChange,
  onSaveDefaults,
  savingDefaults,
}: {
  value: CardBrand;
  onChange: (brand: CardBrand) => void;
  onSaveDefaults: () => void;
  savingDefaults: boolean;
}) {
  const { message } = App.useApp();
  const [loadingLogo, setLoadingLogo] = useState(false);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  return (
    <>
      <label className={cardStyles.label}>
        品牌名称
        <Input
          value={value.name}
          maxLength={40}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          placeholder="品牌名称（可留空）"
        />
      </label>
      <label className={cardStyles.label}>
        微信号
        <Input
          value={value.wechat}
          maxLength={80}
          onChange={(event) => onChange({ ...value, wechat: event.target.value })}
          placeholder="未填写时不展示"
        />
      </label>
      <div className={cardStyles.brandImages}>
        <BrandImage
          label="Logo"
          assetId={value.logoAssetId}
          onChange={(logoAssetId) => onChange({ ...latest.current, logoAssetId })}
        />
        <BrandImage
          label="二维码"
          assetId={value.qrAssetId}
          onChange={(qrAssetId) => onChange({ ...latest.current, qrAssetId })}
        />
      </div>
      <Button
        type="link"
        loading={loadingLogo}
        onClick={async () => {
          setLoadingLogo(true);
          try {
            const asset = await apiFetch<{ id: string }>('/api/product-card-assets', {
              method: 'POST',
              body: JSON.stringify({ builtin: true }),
            });
            onChange({
              ...latest.current,
              name: latest.current.name || '祝余 IWISH',
              logoAssetId: asset.id,
            });
          } catch {
            message.error('品牌素材读取失败，请上传 Logo。');
          } finally {
            setLoadingLogo(false);
          }
        }}
      >
        使用项目现有 Logo
      </Button>
      <div className={cardStyles.checks}>
        <Checkbox
          checked={value.showName}
          onChange={(event) => onChange({ ...value, showName: event.target.checked })}
        >
          显示品牌名
        </Checkbox>
        <Checkbox
          checked={value.showLogo}
          onChange={(event) => onChange({ ...value, showLogo: event.target.checked })}
        >
          显示 Logo
        </Checkbox>
        <Checkbox
          checked={value.showContact}
          onChange={(event) => onChange({ ...value, showContact: event.target.checked })}
        >
          显示微信和二维码
        </Checkbox>
      </div>
      <Button loading={savingDefaults} onClick={onSaveDefaults}>
        保存为品牌默认配置
      </Button>
      <p className={cardStyles.help}>
        用于之后新建的名片，不会改动已有名片。二维码请上传带完整白边的清晰图片。
      </p>
    </>
  );
}
