import { useState } from 'react';

// Поле пароля с глазиком показа/скрытия (как в Telegram): клик по иконке
// переключает тип input password↔text. Используется на экранах входа и
// регистрации, чтобы пользователь мог проверить введённый пароль.
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
        // Без слова «пароль» в подписи: иначе getByLabel('Пароль') в тестах
        // зацепил бы и эту кнопку вместе с полем ввода.
        aria-label={visible ? 'Скрыть' : 'Показать'}
        title={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        // Глазик не должен перехватывать табуляцию формы и сабмитить её.
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? EyeOff : Eye}
      </button>
    </div>
  );
}

// Иконки-глазики (inline SVG, чтобы не тянуть зависимость и совпадать по стилю).
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
