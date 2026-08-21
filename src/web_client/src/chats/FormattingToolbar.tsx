import { IconLink } from '../util/icons';
import { useTranslation } from 'react-i18next';

export interface FormattingToolbarProps {
  visible: boolean;
  onBold: () => void;
  onItalic: () => void;
  onStrike: () => void;
  onCode: () => void;
  onLink: () => void;
}

export function FormattingToolbar({
  visible,
  onBold,
  onItalic,
  onStrike,
  onCode,
  onLink,
}: FormattingToolbarProps): JSX.Element | null {
  if (!visible) return null;

  const { t } = useTranslation();
  return (
    <div className="formatting-bar" data-testid="formatting-bar">
      <button
        type="button"
        className="formatting-btn"
        data-testid="format-bold"
        title={t('composer.bold')}
        onMouseDown={(e) => { e.preventDefault(); onBold(); }}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        className="formatting-btn"
        data-testid="format-italic"
        title={t('composer.italic')}
        onMouseDown={(e) => { e.preventDefault(); onItalic(); }}
      >
        <em>I</em>
      </button>
      <button
        type="button"
        className="formatting-btn"
        data-testid="format-strike"
        title={t('composer.strike')}
        onMouseDown={(e) => { e.preventDefault(); onStrike(); }}
      >
        <del>S</del>
      </button>
      <button
        type="button"
        className="formatting-btn"
        data-testid="format-code"
        title={t('composer.code')}
        onMouseDown={(e) => { e.preventDefault(); onCode(); }}
      >
        {'</>'}
      </button>
      <span className="formatting-separator" />
      <button
        type="button"
        className="formatting-btn"
        data-testid="format-link"
        title={t('composer.link')}
        onMouseDown={(e) => { e.preventDefault(); onLink(); }}
      >
        <IconLink />
      </button>
    </div>
  );
}
