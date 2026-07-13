import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './util/theme'; // применяет начальную тему до первого рендера
import './index.css';

// Android-инициализация: если запущено в Capacitor, регистрируем
// нативные модули (push, lifecycle) ДО рендера React.
// Импорт происходит только на android платформе.
if (
  typeof window !== 'undefined' &&
  (window as any).Capacitor?.isNativePlatform()
) {
  import('./android-setup').then((m) => m.setupAndroid());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
