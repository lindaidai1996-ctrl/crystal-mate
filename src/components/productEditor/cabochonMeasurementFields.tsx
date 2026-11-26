import { ScanOutlined } from '@ant-design/icons';
import { Button, Form, Input, InputNumber } from 'antd';
import { useTranslations } from 'next-intl';
import { CompactFields } from '@/components/responsive/compactFields';
import editorStyles from '../productEditor.module.css';

export function CabochonMeasurementFields({
  saving,
  recognitionInput,
  onRecognitionInputChange,
  onRecognize,
}: {
  saving: boolean;
  recognitionInput: string;
  onRecognitionInputChange: (value: string) => void;
  onRecognize: () => void;
}) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const form = Form.useFormInstance();
  const lengthMm = Form.useWatch(['measurement', 'lengthMm'], form);

  return (
    <div className={editorStyles.measurements}>
      <div className="compact-field-heading">
        <h3 className={editorStyles.measurementHeading}>{t('measurements')}</h3>
        <Button
          type="link"
          size="small"
          htmlType="button"
          disabled={saving || lengthMm == null || !Number.isFinite(lengthMm) || lengthMm <= 0}
          onClick={() =>
            form.setFieldsValue({
              measurement: { widthMm: lengthMm, heightMm: lengthMm },
            })
          }
        >
          {common('applyToWidthHeight')}
        </Button>
      </div>
      <CompactFields className="measurement-fields" columns={3}>
        {(['lengthMm', 'widthMm', 'heightMm'] as const).map((field) => (
          <Form.Item
            key={field}
            name={['measurement', field]}
            label={t(field)}
            rules={[{ type: 'number', min: 0.01, max: 99999999.99 }]}
          >
            <InputNumber
              min={0.01}
              max={99999999.99}
              precision={2}
              step={0.01}
              inputMode="decimal"
              suffix="mm"
              style={{ width: '100%' }}
            />
          </Form.Item>
        ))}
      </CompactFields>
      <Form.Item className="editor-recognizer-field" label={t('smartRecognition')}>
        <div className="measurement-recognizer">
          <Input
            value={recognitionInput}
            onChange={(event) => onRecognitionInputChange(event.target.value)}
            onPressEnter={(event) => {
              event.preventDefault();
              onRecognize();
            }}
            placeholder={t('recognitionPlaceholder')}
          />
          <Button icon={<ScanOutlined />} onClick={onRecognize}>
            {t('recognize')}
          </Button>
        </div>
      </Form.Item>
    </div>
  );
}
