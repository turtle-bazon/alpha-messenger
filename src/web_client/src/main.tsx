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

  // TEMP DEBUG (#75): viewport probe for Android builds. Shows the numbers
  // that distinguish layout-viewport vs visual-viewport mismatch.
  // Remove after diagnosis.
  if (localStorage.getItem('alpha.vpdebug') === '1' || /Capacitor/i.test(navigator.userAgent)) {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;top:0;left:0;z-index:99999;background:#000c;color:#0f0;' +
      'font:10px monospace;padding:2px 4px;pointer-events:none;white-space:pre';
    const update = () => {
      const vv = window.visualViewport;
      el.textContent =
        `inner=${window.innerWidth} client=${document.documentElement.clientWidth}` +
        `\nvisual=${vv ? Math.round(vv.width) : '?'} scale=${vv ? vv.scale.toFixed(2) : '?'}` +
        ` dpr=${window.devicePixelRatio}`;
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    document.body.appendChild(el);
  }
});
