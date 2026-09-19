"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, isLocale, LOCALE_STORAGE_KEY, translate, type Locale, type Translate } from "@/i18n/locale";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  persistenceError: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [persistenceError, setPersistenceError] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(saved)) updateLocale(saved);
    } catch (error) {
      console.warn("Could not restore the interface language preference.", error);
      setPersistenceError(true);
    }
    const syncPreference = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
        updateLocale(isLocale(event.newValue) ? event.newValue : DEFAULT_LOCALE);
      }
    };
    window.addEventListener("storage", syncPreference);
    return () => window.removeEventListener("storage", syncPreference);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    updateLocale(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
      setPersistenceError(false);
    } catch (error) {
      console.warn("Could not save the interface language preference.", error);
      setPersistenceError(true);
    }
  }, []);

  const t = useCallback<Translate>((zh, en, values) => translate(locale, zh, en, values), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t, persistenceError }), [locale, setLocale, t, persistenceError]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
