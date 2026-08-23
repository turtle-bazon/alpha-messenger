import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

// Supported UI languages (#58) — approved list, ordered as in the switcher.
// `name` is displayed in its own language (never translated).
export const LANGS = [
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ru', name: 'Русский' },
  { code: 'tt', name: 'Татарча' },
  { code: 'ba', name: 'Башҡортса' },
  { code: 'uk', name: 'Українська' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ko', name: '한국어' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
] as const;

export type Lang = (typeof LANGS)[number]['code'];

const STORAGE_KEY = 'alpha.lang';
const FALLBACK: Lang = 'en';

// BCP-47 tags for Intl / toLocale* based on the current UI language.
const INTL_LOCALES: Record<Lang, string> = {
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  pt: 'pt-BR',
  tr: 'tr-TR',
  ru: 'ru-RU',
  tt: 'tt-RU',
  ba: 'ba-RU',
  uk: 'uk-UA',
  ar: 'ar',
  hi: 'hi-IN',
  ko: 'ko-KR',
  zh: 'zh-CN',
  ja: 'ja-JP',
};

// Languages written right-to-left — the root element gets dir="rtl".
const RTL_LANGS: ReadonlySet<string> = new Set(['ar', 'he', 'fa', 'ur']);

export function isRtlLang(lang: string): boolean {
  return RTL_LANGS.has(lang);
}

function applyDir(lang: Lang): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dir = isRtlLang(lang) ? 'rtl' : 'ltr';
  }
}

function isLang(v: unknown): v is Lang {
  return LANGS.some((l) => l.code === v);
}

function savedLang(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

// First run: detect from the browser languages, fallback — English.
function detectLang(): Lang {
  const candidates = navigator.languages ?? [navigator.language];
  for (const l of candidates) {
    if (!l) continue;
    const base = l.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

// Locales are loaded on demand (one dynamic-import chunk per language),
// not all at once with the bundle.
async function loadDict(lang: Lang): Promise<Record<string, unknown>> {
  const { default: dict } = await import(`./locales/${lang}.json`);
  return dict;
}

export async function initI18n(): Promise<void> {
  const lang = savedLang() ?? detectLang();
  const dict = await loadDict(lang);
  await i18next.use(initReactI18next).init({
    lng: lang,
    fallbackLng: FALLBACK,
    resources: { [lang]: { translation: dict } },
    // React already escapes output; double-escaping is not needed.
    interpolation: { escapeValue: false },
  });
  applyDir(lang);
}

export async function switchLanguage(lang: Lang): Promise<void> {
  if (!i18next.hasResourceBundle(lang, 'translation')) {
    const dict = await loadDict(lang);
    i18next.addResourceBundle(lang, 'translation', dict, true, true);
  }
  await i18next.changeLanguage(lang);
  applyDir(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private mode etc. — the choice just won't persist.
  }
}

export function currentLang(): Lang {
  return (i18next.language as Lang) || FALLBACK;
}

// Locale tag for toLocaleDateString/toLocaleTimeString and Intl.* formatters,
// following the current UI language.
export function intlLocale(): string {
  return INTL_LOCALES[currentLang()];
}

// The i18next instance itself — for t() outside React components
// (util helpers, notification titles). Components use useTranslation().
export default i18next;
