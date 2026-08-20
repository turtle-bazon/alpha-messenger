import { useState } from 'react';

// Password field with a show/hide eye toggle (like Telegram): clicking the icon
// switches the input type password↔text. Used on the login and registration
// screens so the user can verify the entered password.
export function PasswordInput({
  value,
  onChange,
  autoComplete,
  placeholder = 'Пароль',
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
}): JSX.Element {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input
        aria-label="Пароль"
        placeholder={placeholder}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="password-toggle"
        data-testid="password-toggle"
        // The label must not contain the word "password": otherwise the tests'
        // getByLabel(...) for the field would match this button along with the input.
        aria-label={visible ? 'Скрыть' : 'Показать'}
        title={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        // The eye toggle must not join the form's tab order or submit it.
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? EyeOff : Eye}
      </button>
    </div>
  );
}

// Eye icons (inline SVG, to avoid pulling in a dependency and to match the style).
const Eye = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
    />
    <circle
      cx="12"
      cy="12"
      r="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    />
  </svg>
);

const EyeOff = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2 12s3.5-7 10-7c2 0 3.8.6 5.3 1.5M22 12s-3.5 7-10 7c-2 0-3.8-.6-5.3-1.5M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2"
    />
  </svg>
);
