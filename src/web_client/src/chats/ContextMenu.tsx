import { ReactNode, useEffect, useRef } from 'react';

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
    // Фокус на первом пункте меню — requestAnimationFrame чтобы браузер успел отрисовать
    requestAnimationFrame(() => {
      const firstItem = ref.current?.querySelector('.context-menu-item:not(:disabled)') as HTMLElement | null;
      firstItem?.focus();
    });
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Корректируем позицию: не вылезает за экран ни по горизонтали, ни по вертикали
  const menuWidth = 220;
  const itemHeight = 36;
  const reactionBarHeight = reactionBar ? 48 : 0;
  const menuHeight = items.length * itemHeight + reactionBarHeight;
  const correctedX = Math.min(Math.max(x - menuWidth / 2, 8), window.innerWidth - menuWidth - 8);
  const correctedY = Math.min(
    Math.max(y, 8), // не выше верха
    window.innerHeight - menuHeight - 8, // не ниже низа
  );

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: correctedX, top: correctedY }}
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
