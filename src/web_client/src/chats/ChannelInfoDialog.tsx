import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updateChat, subscribeChannel, unsubscribeChannel } from '../api/rest';
import type { Chat } from '../api/types';
import { IconX } from '../util/icons';

// Channel info dialog — opened by clicking the channel header.
interface ChannelInfoDialogProps {
  chat: Chat;
  myId: string | null;
  onClose: () => void;
  onUpdated: (chat: Chat) => void;
  onRemoved: (chatId: string) => void;
}

export function ChannelInfoDialog({ chat, myId, onClose, onUpdated, onRemoved }: ChannelInfoDialogProps): JSX.Element {
  const { t } = useTranslation();
  const [title, setTitle] = useState(chat.title ?? '');
  const [description, setDescription] = useState(chat.description ?? '');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const isOwner = chat.createdBy === myId;
  const isSubscribed = chat.participants.some((p) => p.userId === myId);

  async function handleSave(): Promise<void> {
    const updated = await updateChat(chat.chatId, { title, description });
    onUpdated(updated);
    setEditing(false);
  }

  async function handleSubscribe(): Promise<void> {
    await subscribeChannel(chat.chatId);
    onUpdated({ ...chat, subscriberCount: chat.subscriberCount + 1 });
  }

  async function handleUnsubscribe(): Promise<void> {
    await unsubscribeChannel(chat.chatId);
    onRemoved(chat.chatId);
  }

  return (
    <div
      className="members-backdrop"
      data-testid="channel-info-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="profile-dialog">
        <div className="profile-head">
          <span className="profile-title">{t('channelInfo.title')}</span>
          <button type="button" className="members-close" onClick={onClose} data-testid="channel-info-close" aria-label={t('common.close')}>
            <IconX />
          </button>
        </div>
        <div className="profile-body">
          <div className="channel-info-avatar">
            {title ? title.charAt(0).toUpperCase() : '#'}
          </div>

          {isOwner && editing ? (
            <>
              <input
                className="channel-info-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('newChat.channelTitle')}
                data-testid="channel-info-title"
              />
              <textarea
                className="channel-info-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('channelInfo.descOptional')}
                rows={3}
                data-testid="channel-info-description"
              />
              <div className="channel-info-actions">
                <button type="button" className="btn btn-primary" onClick={handleSave}>
                  {t('common.save')}
                </button>
                <button type="button" className="btn" onClick={() => setEditing(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="channel-info-title">{title || chat.username}</div>
              {chat.username && (
                <div className="channel-info-username">@{chat.username}</div>
              )}
              {description && (
                <div className="channel-info-desc">{description}</div>
              )}
              <div className="channel-info-link">
                <input
                  className="channel-info-link-input"
                  readOnly
                  value={chat.username
                    ? `${location.origin}/channel/${chat.username}/`
                    : `${location.origin}/channel/${chat.chatId}/`
                  }
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const url = chat.username
                      ? `${location.origin}/channel/${chat.username}/`
                      : `${location.origin}/channel/${chat.chatId}/`;
                    navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? t('common.copied') : t('common.copy')}
                </button>
              </div>
              <div className="channel-info-stats">
                <span>{t('channelInfo.subscribers', { count: chat.subscriberCount })}</span>
              </div>
              {isOwner && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditing(true)}
                >
                  {t('conv.edit')}
                </button>
              )}
              {!isOwner && (
                <div className="channel-info-actions">
                  {isSubscribed ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={handleUnsubscribe}
                    >
                      {t('channelInfo.unsubscribe')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSubscribe}
                    >
                      {t('conv.subscribe')}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
