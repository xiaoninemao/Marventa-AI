"use client";

import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import PublicHomepage from "@/components/landing/PublicHomepage";
import ModuleListing from "./module_listing";

export default function LandingPage() {
  const { user, loading } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="amp-page-loading" role="status" aria-label={t("加载中", "Loading")}>
        <span className="amp-page-loading-stack" aria-hidden="true">
          <span className="amp-page-loading-sheet amp-page-loading-sheet-back" />
          <span className="amp-page-loading-sheet amp-page-loading-sheet-middle" />
          <span className="amp-page-loading-sheet amp-page-loading-sheet-front">
            <i />
            <i />
            <i />
          </span>
        </span>
      </div>
    );
  }

  return user ? <ModuleListing /> : <PublicHomepage />;
}
