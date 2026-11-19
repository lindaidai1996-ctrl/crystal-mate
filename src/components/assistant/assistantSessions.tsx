'use client';

import { useState } from 'react';
import { Alert, Button, Dropdown, Input, Modal } from 'antd';
import { DeleteOutlined, EditOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { AssistantSessionList } from '@/lib/ai-assistant/browser-contracts';
import assistantStyles from './assistantPage.module.css';
import { formatAssistantTime } from './displayTime';

type Props = {
  sessions: AssistantSessionList;
  selectedId: string | null;
  managingId: string | null;
  privacy: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onLoadMore: () => void;
  onRename: (id: string, title: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
};

export function AssistantSessions(props: Props) {
  const t = useTranslations('assistant');
  const locale = useLocale();
  const [dialog, setDialog] = useState<{
    id: string;
    name: string;
    kind: 'rename' | 'delete';
  } | null>(null);
  const [title, setTitle] = useState('');
  const [failed, setFailed] = useState(false);
  const busy = props.managingId !== null;
  const confirm = async () => {
    if (!dialog || busy || (dialog.kind === 'rename' && !title.trim())) return;
    setFailed(false);
    const saved =
      dialog.kind === 'rename'
        ? await props.onRename(dialog.id, title.trim())
        : await props.onRemove(dialog.id);
    if (saved) setDialog(null);
    else setFailed(true);
  };

  return (
    <aside className={assistantStyles.sessions} aria-label={t('sessions')}>
      <Button block icon={<PlusOutlined />} onClick={props.onCreate}>
        {t('newConversation')}
      </Button>
      <div className={assistantStyles.sessionList}>
        {props.sessions.items.map((session) => {
          const name =
            (!props.privacy && session.title) ||
            t('defaultConversationName', { number: session.number });
          return (
            <div
              key={session.id}
              className={assistantStyles.sessionRow}
              data-active={props.selectedId === session.id}
            >
              <button
                type="button"
                className={assistantStyles.sessionSelect}
                aria-current={props.selectedId === session.id ? 'page' : undefined}
                onClick={() => props.onSelect(session.id)}
              >
                <strong title={name}>{name}</strong>
                <span>{formatAssistantTime(session.updatedAt, locale)}</span>
              </button>
              <Dropdown
                trigger={['click']}
                disabled={busy}
                menu={{
                  items: [
                    { key: 'rename', label: t('renameConversation'), icon: <EditOutlined /> },
                    {
                      key: 'delete',
                      label: t('deleteConversation'),
                      icon: <DeleteOutlined />,
                      danger: true,
                    },
                  ],
                  onClick: ({ key }) => {
                    setFailed(false);
                    setTitle((!props.privacy && session.title) || '');
                    setDialog({ id: session.id, name, kind: key as 'rename' | 'delete' });
                  },
                }}
              >
                <Button
                  type="text"
                  className={assistantStyles.sessionActions}
                  icon={<MoreOutlined />}
                  aria-label={t('conversationActions', { name })}
                  loading={props.managingId === session.id}
                />
              </Dropdown>
            </div>
          );
        })}
      </div>
      {props.sessions.nextCursor && <Button onClick={props.onLoadMore}>{t('more')}</Button>}
      <Modal
        open={dialog !== null}
        title={t(dialog?.kind === 'delete' ? 'deleteConversation' : 'renameConversation')}
        okText={t(dialog?.kind === 'delete' ? 'confirmDelete' : 'saveConversationName')}
        cancelText={t('cancelDialog')}
        confirmLoading={busy}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        cancelButtonProps={{ disabled: busy }}
        okButtonProps={{
          danger: dialog?.kind === 'delete',
          disabled: dialog?.kind === 'rename' && !title.trim(),
        }}
        onCancel={() => !busy && setDialog(null)}
        onOk={() => void confirm()}
        afterOpenChange={(open) => {
          if (!open) setTitle('');
        }}
        destroyOnHidden
      >
        {failed && <Alert type="error" showIcon message={t('manageConversationFailed')} />}
        {dialog?.kind === 'rename' ? (
          <div className={assistantStyles.renameField}>
            <label htmlFor="assistant-conversation-name">{t('conversationName')}</label>
            <Input
              id="assistant-conversation-name"
              value={title}
              maxLength={80}
              showCount
              autoFocus
              disabled={busy}
              placeholder={t('conversationNamePlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
              onPressEnter={(event) => {
                if (!event.nativeEvent.isComposing) void confirm();
              }}
            />
          </div>
        ) : (
          <p className={assistantStyles.deleteHint}>
            {t('deleteConversationConfirm', { name: dialog?.name ?? '' })}
          </p>
        )}
      </Modal>
    </aside>
  );
}
