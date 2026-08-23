import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initI18n } from './i18n';
import './util/theme'; // applies the initial theme before the first render
import './index.css';

// Android initialization: when running under Capacitor, register
// native modules (push, lifecycle) BEFORE React renders.
// The import happens only on the android platform.
if (
  typeof window !== 'undefined' &&
  (window as any).Capacitor?.isNativePlatform()
) {
  import('./android-setup').then((m) => m.setupAndroid());
}

// The locale dict is loaded before the first render (#58): no flash of
// untranslated strings on startup.
initI18n().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
