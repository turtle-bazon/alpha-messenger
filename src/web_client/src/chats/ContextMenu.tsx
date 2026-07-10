import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
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
}

export function ContextMenu({ items, x, y, onClose }: ContextMenuProps): JSX.Element {
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
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Корректируем позицию, чтобы меню не вылезало за экран
  const correctedX = Math.min(x, window.innerWidth - 220);
  const correctedY = Math.min(y, window.innerHeight - items.length * 40);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: correctedX, top: correctedY }}
      data-testid="context-menu"
    >
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
