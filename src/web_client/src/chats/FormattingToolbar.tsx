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

  return (
    <div className="formatting-bar" data-testid="formatting-bar">
      <button
        type="button"
        className="formatting-btn"
        data-testid="format-bold"
        title="Жирный (Ctrl+B)"
        onMouseDown={(e) => { e.preventDefault(); onBold(); }}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        className="formatting-btn"
        data-testid="format-italic"
        title="Курсив (Ctrl+I)"
        onMouseDown={(e) => { e.preventDefault(); onItalic(); }}
      >
        <em>I</em>
      </button>
      <button
        type="button"
        className="formatting-btn"
        data-testid="format-strike"
        title="Зачёркнутый"
        onMouseDown={(e) => { e.preventDefault(); onStrike(); }}
      >
        <del>S</del>
      </button>
      <button
        type="button"
        className="formatting-btn"
        data-testid="format-code"
        title="Код"
        onMouseDown={(e) => { e.preventDefault(); onCode(); }}
      >
        {'</>'}
      </button>
      <span className="formatting-separator" />
      <button
        type="button"
        className="formatting-btn"
        data-testid="format-link"
        title="Ссылка (Ctrl+K)"
        onMouseDown={(e) => { e.preventDefault(); onLink(); }}
      >
        🔗
      </button>
    </div>
  );
}
