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

  // TEMP DEBUG (#93): элементы, вылезающие за левый/правый край + скролл.
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:0;left:0;z-index:99999;background:#000c;color:#0f0;' +
    'font:10px monospace;padding:2px 4px;pointer-events:none;white-space:pre';
  const update = () => {
    const sc = document.querySelector('.conv-scroll');
    const out: string[] = [];
    document.querySelectorAll('.conv-scroll *').forEach((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      if ((r.right > window.innerWidth + 2 || r.left < -2) && e.children.length < 8) {
        const c = String((e as HTMLElement).className || e.tagName).slice(0, 40);
        out.push(`${c} L${Math.round(r.left)} R${Math.round(r.right)} W${Math.round(r.width)}`);
      }
    });
    el.textContent =
      `iw=${window.innerWidth} docSW=${document.documentElement.scrollWidth}` +
      ` scL=${sc ? Math.round(sc.scrollLeft) : '?'} scW=${sc ? sc.scrollWidth : '?'}` +
      `\n${out.slice(0, 6).join('\n') || '-'}`;
  };
  update();
  setInterval(update, 1000);
  document.body.appendChild(el);
});
