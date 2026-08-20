import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
