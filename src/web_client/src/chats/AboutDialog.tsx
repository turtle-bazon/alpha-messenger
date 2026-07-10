import { useEffect, useRef } from 'react';

interface AboutDialogProps {
  onClose: () => void;
}

export function AboutDialog({ onClose }: AboutDialogProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="members-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="about-dialog"
        onClick={(e) => e.stopPropagation()}
        data-testid="about-dialog"
      >
        <h2>Alpha Messenger</h2>
        <p className="about-version">Мессенджер</p>
        <div className="about-section">
          <h3>Иконки</h3>
          <p>
            <a href="https://lucide.dev" target="_blank" rel="noopener noreferrer">
              Lucide Icons
            </a>
          </p>
          <p className="about-license">ISC License</p>
          <p className="about-copyright">Copyright (c) 2026 Lucide Icons and Contributors</p>
        </div>
        <div className="about-section">
          <h3>Проект</h3>
          <p>
            <a href="https://github.com/turtle-bazon/alpha-messenger" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </p>
          <p className="about-license">GNU General Public License v3.0</p>
        </div>
        <button type="button" className="about-close" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
