export type Locale = "zh-CN" | "en";
export type TranslationValues = Readonly<Record<string, string | number>>;
export type Translate = (zh: string, en: string, values?: TranslationValues) => string;

export const LOCALE_STORAGE_KEY = "marventa-locale";
export const DEFAULT_LOCALE: Locale = "zh-CN";

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en";
}

export function translate(locale: Locale, zh: string, en: string, values?: TranslationValues): string {
  const message = locale === "en" ? en : zh;
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder,
  );
}
