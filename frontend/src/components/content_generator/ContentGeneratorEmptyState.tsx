"use client";

import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";

export default function ContentGeneratorEmptyState() {
  const { t } = useI18n();

  return (
    <section className="amp-content-result-panel" aria-labelledby="creation-empty-title">
      <div id="canvas-brief" className="amp-content-result-empty">
        <span className="amp-content-result-empty-icon" aria-hidden="true">
          <InlineIcon name="sparkle" strokeWidth={1.5} />
        </span>
        <h2 id="creation-empty-title">{t("开始智能创作", "Start creating")}</h2>
        <p>{t(
          "在左侧描述你的产品和创作需求，AI 将帮你生成脚本、标题、文案等内容。",
          "Describe your product and creative needs on the left. AI will help create scripts, titles, copy, and more.",
        )}</p>
      </div>
    </section>
  );
}
