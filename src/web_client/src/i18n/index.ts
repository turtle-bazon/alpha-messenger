import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

// Supported UI languages (#58). `name` is displayed in the switcher in its own
// language (never translated).
export const LANGS = [
  { code: 'ru', name: 'Русский' },
  { code: 'en', name: 'English' },
] as const;

export type Lang = (typeof LANGS)[number]['code'];

const STORAGE_KEY = 'alpha.lang';
const FALLBACK: Lang = 'en';

// BCP-47 tags for Intl / toLocale* based on the current UI language.
const INTL_LOCALES: Record<Lang, string> = { ru: 'ru-RU', en: 'en-US' };

function savedLang(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'ru' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

// First run: detect from the browser languages, fallback — English.
function detectLang(): Lang {
  const candidates = navigator.languages ?? [navigator.language];
  for (const l of candidates) {
    if (l && l.toLowerCase().startsWith('ru')) return 'ru';
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
}

export async function switchLanguage(lang: Lang): Promise<void> {
  if (!i18next.hasResourceBundle(lang, 'translation')) {
    const dict = await loadDict(lang);
    i18next.addResourceBundle(lang, 'translation', dict, true, true);
  }
  await i18next.changeLanguage(lang);
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
