"use client";

import { createPortal } from "react-dom";
import { useI18n } from "@/contexts/i18n_context";
import { useDropdownMenu } from "@/hooks/use_dropdown_menu";

const languages = [
  { value: "en", label: "English", shortLabel: "EN" },
  { value: "zh-CN", label: "简体中文", shortLabel: "中文" },
] as const;

export default function LanguageSwitcher({ variant = "default" }: { variant?: "default" | "minimal" }) {
  const { locale, setLocale, t, persistenceError } = useI18n();
  const { open, position, triggerRef, menuRef, menuId, toggleMenu, closeMenu, handleTriggerKeyDown, handleMenuKeyDown } = useDropdownMenu(languages.length);
  const selected = languages.find((language) => language.value === locale) ?? languages[0];

  return (
    <div className={`amp-language-switcher${variant === "minimal" ? " amp-language-switcher-minimal" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="amp-language-trigger"
        aria-label={t("切换语言，当前为 {language}", "Change language, current: {language}", { language: selected.label })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => toggleMenu(languages.findIndex((language) => language.value === locale))}
        onKeyDown={handleTriggerKeyDown}
      >
        <svg className="amp-language-globe" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18" />
        </svg>
        <span>{selected.shortLabel}</span>
        <svg className="amp-language-chevron" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path d="m5 8 5 5 5-5" />
        </svg>
      </button>
      {open && createPortal(
        <div ref={menuRef} id={menuId}
          className={`amp-redesign amp-language-menu${variant === "minimal" ? " amp-language-menu-minimal" : ""}`} role="menu"
          aria-label={t("选择语言", "Choose a language")} style={position} onKeyDown={handleMenuKeyDown}>
          {languages.map((language) => (
            <button key={language.value} type="button" role="menuitemradio" aria-checked={locale === language.value}
              tabIndex={-1} lang={language.value} className="amp-language-option"
              onClick={() => { setLocale(language.value); closeMenu(); }}>
              <span>{language.label}</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                {locale === language.value && <path d="m5 12 4 4L19 6" />}
              </svg>
            </button>
          ))}
        </div>,
        document.body,
      )}
      {persistenceError && (
        <span className="amp-language-warning" role="status">
          {t("语言已切换，但浏览器无法保存此偏好。", "Language changed, but your browser could not save this preference.")}
        </span>
      )}
    </div>
  );
}
