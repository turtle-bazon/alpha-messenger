import { ReactNode, useEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
  /** Панель быстрых реакций — рендерится над пунктами меню в одном контейнере. */
  reactionBar?: ReactNode;
}

export function ContextMenu({ items, x, y, onClose, reactionBar }: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    requestAnimationFrame(() => {
      const firstItem = ref.current?.querySelector('.context-menu-item:not(:disabled)') as HTMLElement | null;
      firstItem?.focus();
    });
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const menuWidth = rect.width;
    const menuHeight = rect.height;
    const left = Math.min(Math.max(x - menuWidth * 0.4, 8), window.innerWidth - menuWidth - 8);
    let top = y - menuHeight * 0.4;
    top = Math.max(8, Math.min(top, window.innerHeight - menuHeight - 8));
    setPos({ left, top });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
      data-testid="context-menu"
    >
      {reactionBar}
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={`sep-${i}`} className="context-menu-separator" />;
        }
        return (
          <button
            key={item.label}
            type="button"
            className={'context-menu-item' + (item.danger ? ' danger' : '')}
            disabled={item.disabled}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
