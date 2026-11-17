'use client';

import { CameraOutlined, PictureOutlined } from '@ant-design/icons';
import { Button, Modal, Space } from 'antd';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ChangeEvent } from 'react';

export function useImageFilePicker({
  disabled = false,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (files: File[]) => void;
}) {
  const t = useTranslations('imageUpload');
  const library = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [choosingSource, setChoosingSource] = useState(false);

  function openFilePicker() {
    if (disabled) return;
    if (window.matchMedia('(max-width: 767px), (pointer: coarse)').matches) {
      setChoosingSource(true);
    } else {
      library.current?.click();
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    // A new selection of the same file (or a cancelled camera) must remain usable.
    event.currentTarget.value = '';
    if (!disabled && files.length) onSelect(files);
  }

  const filePicker = (
    <>
      <input
        ref={library}
        hidden
        style={{ display: 'none' }}
        type="file"
        aria-label={t('chooseFromLibrary')}
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={disabled}
        onChange={selectFiles}
      />
      <input
        ref={camera}
        hidden
        style={{ display: 'none' }}
        type="file"
        aria-label={t('takePhoto')}
        accept="image/*"
        capture="environment"
        disabled={disabled}
        onChange={selectFiles}
      />
      <Modal
        title={t('chooseSource')}
        open={choosingSource && !disabled}
        centered
        width={360}
        footer={null}
        onCancel={() => setChoosingSource(false)}
      >
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <Button
            block
            icon={<CameraOutlined />}
            style={{ minHeight: 44 }}
            onClick={() => {
              setChoosingSource(false);
              // Keep the native picker in this user gesture, especially on iOS.
              camera.current?.click();
            }}
          >
            {t('takePhoto')}
          </Button>
          <Button
            block
            icon={<PictureOutlined />}
            style={{ minHeight: 44 }}
            onClick={() => {
              setChoosingSource(false);
              library.current?.click();
            }}
          >
            {t('chooseFromLibrary')}
          </Button>
        </Space>
      </Modal>
    </>
  );

  return { openFilePicker, filePicker };
}
