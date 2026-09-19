"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { useDropdownMenu } from "@/hooks/use_dropdown_menu";
import { localizeErrorMessage } from "@/i18n/errors";
import { organizationName, organizationRole } from "@/utils/organizations";
import InlineIcon from "@/components/redesign/InlineIcon";

export default function OrganizationSwitcher() {
  const { user, organizations, organizationsLoading, organizationsError, organizationBusy, reloadOrganizations, switchOrganization } = useAuth();
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const current = user?.current_organization ?? user?.default_organization;
  const name = current ? organizationName(current, t) : t("组织", "Organization");
  const count = organizationsLoading ? 0 : organizationsError ? 1 : organizations.length;
  const { open, position, triggerRef, menuRef, menuId, toggleMenu, closeMenu, handleTriggerKeyDown, handleMenuKeyDown } = useDropdownMenu(count);

  useEffect(() => {
    if (organizationsError) showError(localizeErrorMessage(organizationsError, locale));
  }, [organizationsError, locale, showError]);

  const selectOrganization = async (id: string) => {
    try {
      await switchOrganization(id);
      closeMenu();
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not switch organization", locale));
      if (triggerRef.current) {
        if (!menuRef.current) toggleMenu();
        menuRef.current?.focus();
      }
    }
  };

  return (
    <div className="amp-organization-switcher">
      <button type="button" ref={triggerRef} className="amp-app-brand amp-organization-trigger"
        title={name} aria-label={t("切换组织，当前为 {name}", "Switch organization, current: {name}", { name })}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => toggleMenu(Math.max(0, organizations.findIndex((item) => item.id === current?.id)))}
        onKeyDown={handleTriggerKeyDown}>
        <InlineIcon name="organization" className="amp-organization-symbol" />
        <span className="amp-app-brand-text">{name}</span>
        <svg className="amp-organization-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
          <path d="m5 8 5 5 5-5" />
        </svg>
      </button>
      {open && createPortal(
        <div ref={menuRef} id={menuId} className="amp-redesign amp-language-menu amp-organization-menu"
          role="menu" tabIndex={-1} aria-label={t("切换组织", "Switch organization")} style={position} onKeyDown={handleMenuKeyDown}>
          {organizationsLoading ? <p className="amp-organization-menu-message" role="status">{t("正在加载组织...", "Loading organizations...")}</p>
            : organizationsError ? (
              <div className="amp-organization-menu-message">
                <button type="button" role="menuitem" tabIndex={-1} className="amp-language-option" onClick={reloadOrganizations}>{t("重新加载", "Retry")}</button>
              </div>
            ) : organizations.map((item) => (
              <button key={item.id} type="button" role="menuitemradio" tabIndex={-1}
                aria-checked={current?.id === item.id} disabled={organizationBusy}
                className="amp-language-option amp-organization-option" title={organizationName(item, t)}
                onClick={() => { if (current?.id === item.id) closeMenu(); else void selectOrganization(item.id); }}>
                <span><strong>{organizationName(item, t)}</strong><small>{organizationRole(item.role, t)}</small></span>
                {current?.id === item.id && <InlineIcon name="check" />}
              </button>
              ))}
            {organizationBusy && <p className="amp-organization-menu-message" role="status">{t("正在更新组织...", "Updating organization...")}</p>}
        </div>, document.body,
      )}
    </div>
  );
}
