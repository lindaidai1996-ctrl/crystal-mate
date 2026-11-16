'use client';

import { Alert, Button, Segmented, Slider, Spin } from 'antd';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { ResponsiveModal } from '@/components/responsive/responsiveDialog';
import { FramedImage } from '@/components/framedImage';
import type { ImageFraming } from '@/lib/image-framing';
import framingStyles from './imageFramingDialog.module.css';

export function ImageFramingDialog({
  url,
  framing,
  onCancel,
  onConfirm,
}: {
  url: string;
  framing?: ImageFraming | null;
  onCancel: () => void;
  onConfirm: (framing: ImageFraming) => void;
}) {
  const t = useTranslations('imageUpload');
  const common = useTranslations('common');
  const [mode, setMode] = useState<'cover' | 'contain'>(framing?.mode ?? 'cover');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(
    framing?.mode === 'cover' ? (framing.crop ?? null) : null,
  );
  const [initialArea, setInitialArea] = useState(
    framing?.mode === 'cover' ? framing.crop : undefined,
  );
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  return (
    <ResponsiveModal
      title={t('adjustCover')}
      open
      width={520}
      style={{ top: 24 }}
      afterOpenChange={setReady}
      onCancel={onCancel}
      onOk={() => {
        if (mode === 'contain') onConfirm({ mode });
        else if (area) onConfirm({ mode, crop: area });
      }}
      okButtonProps={{ disabled: failed || !loaded || (mode === 'cover' && !area) }}
      okText={t('applyCover')}
      cancelText={common('cancel')}
    >
      <p className="helper-text">{t('coverHelp')}</p>
      <Segmented
        block
        className={framingStyles.modes}
        value={mode}
        aria-label={t('coverMode')}
        options={[
          { value: 'cover', label: t('coverFill') },
          { value: 'contain', label: t('coverWhole') },
        ]}
        onChange={(value) => setMode(value as 'cover' | 'contain')}
      />
      <div className={framingStyles.stage} aria-busy={!loaded && !failed}>
        {mode === 'contain' && <FramedImage src={url} framing={{ mode: 'contain' }} />}
        {/* Keep the cropper mounted when switching modes so position and zoom survive. */}
        <div className={framingStyles.cropper} hidden={mode !== 'cover'}>
          {!loaded && !failed && <Spin />}
          {ready && (
            <Cropper
              key={resetKey}
              image={url}
              aspect={1}
              crop={crop}
              zoom={zoom}
              maxZoom={3}
              initialCroppedAreaPercentages={initialArea}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropAreaChange={(percentages) => setArea(percentages)}
              onMediaLoaded={() => setLoaded(true)}
              mediaProps={{ alt: t('coverPreview'), onError: () => setFailed(true) }}
              cropperProps={{ 'aria-label': t('cropArea') }}
              disableAutomaticStylesInjection
            />
          )}
        </div>
      </div>
      {failed && <Alert type="error" showIcon message={t('loadFailed')} />}
      {mode === 'cover' && (
        <div className={framingStyles.controls}>
          <label id="cover-zoom-label">{t('zoom')}</label>
          <Slider
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            disabled={!loaded || failed}
            onChange={setZoom}
            ariaLabelledByForHandle="cover-zoom-label"
          />
          <Button
            disabled={!loaded || failed}
            onClick={() => {
              setInitialArea(undefined);
              setCrop({ x: 0, y: 0 });
              setZoom(1);
              setArea(null);
              setResetKey((key) => key + 1);
            }}
          >
            {t('resetCrop')}
          </Button>
        </div>
      )}
      <p className="helper-text">{t('coverSaveHelp')}</p>
    </ResponsiveModal>
  );
}
