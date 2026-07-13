import { useEffect, useRef } from 'react';
import type { Participant } from '../api/types';
import { colorFor, initialFor } from './avatar';

interface MentionPopupProps {
  participants: Participant[];
  filter: string;
  myId: string | null;
  selected: number;
  onSelect: (username: string) => void;
  onClose: () => void;
}

export function MentionPopup({
  participants,
  filter,
  myId,
  selected,
  onSelect,
  onClose,
}: MentionPopupProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);

  const lowerFilter = filter.toLowerCase();
  const filtered = participants.filter(
    (p) =>
      p.userId !== myId &&
      (p.username.toLowerCase().includes(lowerFilter) ||
        p.username.toLowerCase().startsWith(lowerFilter)),
  );

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // Закрытие по Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (filtered.length === 0) return <div className="mention-popup" data-testid="mention-popup" />;

  return (
    <div className="mention-popup" data-testid="mention-popup" ref={listRef}>
      {filtered.map((p, i) => (
        <button
          key={p.userId}
          type="button"
          className={'mention-item' + (i === selected ? ' selected' : '')}
          data-testid="mention-item"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(p.username);
          }}
          onMouseEnter={() => {}}
        >
          <span className="mention-avatar" style={{ background: colorFor(p.username) }}>
            {initialFor(p.username)}
          </span>
          <span className="mention-name">{p.username}</span>
        </button>
      ))}
    </div>
  );
}

// Возвращает отфильтрованный список для использования снаружи.
export function getFilteredParticipants(
  participants: Participant[],
  filter: string,
  myId: string | null,
): Participant[] {
  const lowerFilter = filter.toLowerCase();
  return participants.filter(
    (p) =>
      p.userId !== myId &&
      (p.username.toLowerCase().includes(lowerFilter) ||
        p.username.toLowerCase().startsWith(lowerFilter)),
  );
}
