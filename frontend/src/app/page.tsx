"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import LanguageSwitcher from "@/components/shared/language_switcher";
import ModuleListing from "./module_listing";
import SlidingPanel from "@/components/auth/sliding_panel";
import InlineIcon, { type InlineIconName } from "@/components/redesign/InlineIcon";
import RedesignBadge from "@/components/redesign/RedesignBadge";
import RedesignButton from "@/components/redesign/RedesignButton";
import RedesignCard from "@/components/redesign/RedesignCard";
import RedesignIconBox from "@/components/redesign/RedesignIconBox";
import RedesignSectionHeader from "@/components/redesign/RedesignSectionHeader";
import { consumePendingAnchor, getPublicNavLinkClass, handlePublicAnchorClick } from "@/utils/public_anchor_navigation";

const navLinks = [
  { label: "产品功能", labelEn: "Features", href: "/#features" },
  { label: "解决方案", labelEn: "Solutions", href: "/#solutions" },
];

const solutionCards: Array<{
  title: string;
  titleEn: string;
  copy: string;
  copyEn: string;
  icon: InlineIconName;
  tone: "primary" | "cyan" | "purple";
}> = [
  {
    title: "市场洞察",
    titleEn: "Market Insight",
    copy: "深度解析市场与竞品，洞察用户需求与趋势，输出可执行的策略建议。",
    copyEn: "Analyze markets and competitors, understand customer needs and trends, and develop actionable recommendations.",
    icon: "chart",
    tone: "primary",
  },
  {
    title: "智能创作",
    titleEn: "Content Studio",
    copy: "AI 驱动内容生成，覆盖脚本、文案、标题、视觉参考等多种营销内容类型。",
    copyEn: "Use AI to create scripts, copy, headlines, visual references, and other marketing content.",
    icon: "edit",
    tone: "purple",
  },
  {
    title: "全渠道分发",
    titleEn: "Multichannel Distribution",
    copy: "面向多平台内容形态进行策略适配，提升触达效率与品牌声量。",
    copyEn: "Adapt your content strategy to different platforms and formats to improve reach and brand visibility.",
    icon: "upload",
    tone: "cyan",
  },
  {
    title: "效果追踪",
    titleEn: "Performance Tracking",
    copy: "持续跟踪传播数据与内容表现，帮助团队优化后续增长策略。",
    copyEn: "Track campaign metrics and content performance to refine your team's growth strategy.",
    icon: "trending",
    tone: "primary",
  },
];

const workflowSteps = [
  {
    index: "01",
    title: "策略洞察",
    titleEn: "Develop Insights",
    copy: "上传资料，AI 自动解析市场与竞品，生成清晰的营销洞察。",
    copyEn: "Upload your materials and let AI analyze your market and competitors to produce clear marketing insights.",
    icon: "search" as InlineIconName,
  },
  {
    index: "02",
    title: "内容创作",
    titleEn: "Create Content",
    copy: "基于洞察结果，AI 生成多平台营销内容，支持编辑与版本管理。",
    copyEn: "Turn insights into AI-generated content for multiple platforms, with editing and version management.",
    icon: "sparkle" as InlineIconName,
  },
  {
    index: "03",
    title: "渠道分发与优化",
    titleEn: "Distribute and Refine",
    copy: "围绕核心渠道制定内容路径，持续优化传播与转化效果。",
    copyEn: "Plan content for your key channels and continually improve reach and conversion.",
    icon: "trending" as InlineIconName,
  },
];

const productFeatureCards: Array<{
  title: string;
  titleEn: string;
  copy: string;
  copyEn: string;
  icon: InlineIconName;
  tone: "primary" | "cyan" | "purple";
}> = [
  { title: "市场洞察", titleEn: "Market Insight", copy: "分析市场趋势与竞品动向，生成行业洞察、机会与优先级假设。", copyEn: "Analyze market and competitor trends to identify industry insights, opportunities, and potential priorities.", icon: "chart", tone: "primary" },
  { title: "策略中心", titleEn: "Strategy Center", copy: "整合营销目标与受众洞察，生成内容策略与跨渠道方向和框架。", copyEn: "Bring marketing goals and audience insights together to shape content strategies and cross-channel plans.", icon: "upload", tone: "cyan" },
  { title: "智能创作", titleEn: "Content Studio", copy: "AI 生成文章、图文、邮件、短视频等多种内容及创意模板。", copyEn: "Use AI to develop articles, image posts, emails, and short-video content, along with creative templates.", icon: "edit", tone: "purple" },
  { title: "内容资产库", titleEn: "Content Assets", copy: "统一管理与沉淀内容素材，便于复用、协同与持续迭代。", copyEn: "Organize and retain content assets for reuse, collaboration, and ongoing improvement.", icon: "folder", tone: "cyan" },
  { title: "发布与渠道", titleEn: "Publishing & Channels", copy: "一键发布，支持多渠道同步与内容分发管理。", copyEn: "Publish with one click, synchronize across channels, and manage content distribution.", icon: "bell", tone: "primary" },
  { title: "数据看板", titleEn: "Analytics Dashboard", copy: "智能数据分析与效果追踪，多维度呈现，提升 ROI。", copyEn: "Analyze data and track performance from multiple perspectives to improve return on investment.", icon: "trending", tone: "purple" },
];

const solutionPreviewCards: Array<{
  title: string;
  titleEn: string;
  copy: string;
  copyEn: string;
  icon: InlineIconName;
  tone: "primary" | "cyan" | "purple";
}> = [
  { title: "小红书营销", titleEn: "Xiaohongshu Marketing", copy: "从选题到内容发布，提升种草效率与转化率。", copyEn: "From choosing topics to publishing posts, help customers discover products and turn interest into action.", icon: "chart", tone: "purple" },
  { title: "抖音短视频运营", titleEn: "Douyin Video Marketing", copy: "AI 生成短视频脚本，提升短视频播放与转化。", copyEn: "Create short-video scripts with AI to improve video reach and conversion.", icon: "case", tone: "primary" },
  { title: "新品推广", titleEn: "Product Launches", copy: "构建从认知到转化的 7*24h 线索引擎。", copyEn: "Build an always-on lead generation process that connects awareness with conversion.", icon: "sparkle", tone: "cyan" },
  { title: "官网内容协作", titleEn: "Website Content Collaboration", copy: "多人协作与流程管理，提升企业内容生产力。", copyEn: "Improve content productivity through team collaboration and workflow management.", icon: "user", tone: "primary" },
];

const solutionPreviewIconImages = [
  { src: "/assets/solutions/xiaohongshu.png", alt: "小红书", altEn: "Xiaohongshu" },
  { src: "/assets/solutions/douyin.png", alt: "抖音", altEn: "Douyin" },
  { src: "/assets/solutions/new-product-promotion.png", alt: "新品推广", altEn: "Product launches" },
  { src: "/assets/solutions/website-content-collaboration.png", alt: "官网内容协作", altEn: "Website content collaboration" },
] as const;

export default function LandingPage() {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const [authMode, setAuthMode] = useState<"login" | "register" | null>(null);
  const [activeHash, setActiveHash] = useState("");

  const openLogin = useCallback(() => {
    setAuthMode("login");
  }, []);

  const openRegister = useCallback(() => {
    setAuthMode("register");
  }, []);

  useEffect(() => {
    consumePendingAnchor();
    const sectionIds = ["features", "solutions"];

    const updateActiveHash = () => {
      const current = sectionIds.reduce((active, id) => {
        const section = document.getElementById(id);
        if (!section) return active;
        const top = section.getBoundingClientRect().top;
        return top <= 120 ? `#${id}` : active;
      }, "");

      setActiveHash(current);
    };

    updateActiveHash();
    window.addEventListener("hashchange", updateActiveHash);
    window.addEventListener("scroll", updateActiveHash, { passive: true });
    return () => {
      window.removeEventListener("hashchange", updateActiveHash);
      window.removeEventListener("scroll", updateActiveHash);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white" role="status" aria-label={t("加载中", "Loading")}>
        <InlineIcon name="sparkle" className="h-8 w-8 animate-pulse text-blue-600" />
      </div>
    );
  }

  if (user) {
    return <ModuleListing />;
  }

  return (
    <div className="amp-redesign">
      <div className="amp-landing-shell">
        <SlidingPanel
          mode={authMode ?? "login"}
          open={authMode !== null}
          onClose={() => setAuthMode(null)}
          onSwitch={() => setAuthMode((mode) => mode === "login" ? "register" : "login")}
        />

        <header className="amp-container amp-landing-header">
          <nav className="amp-landing-nav" aria-label={t("主导航", "Main navigation")}>
            <Link href="/" className="amp-brand" aria-label={t("Marventa AI 首页", "Marventa AI home")}>
              <img src="/assets/brand/marventa-logo.png" alt="" className="amp-brand-icon" />
              <span>Marventa AI</span>
            </Link>

            <div className="amp-landing-nav-links">
              {navLinks.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={getPublicNavLinkClass(item.href, pathname, activeHash)}
                  onClick={(event) => {
                    handlePublicAnchorClick(item.href, event);
                    if (item.href.startsWith("/#")) setActiveHash(item.href.slice(1));
                  }}
                >
                  {t(item.label, item.labelEn)}
                </Link>
              ))}
            </div>

            <div className="amp-landing-nav-actions flex items-center gap-3">
              <LanguageSwitcher />
              <button type="button" onClick={openLogin} className="amp-button amp-button-ghost">
                {t("登录", "Sign in")}
              </button>
              <RedesignButton onClick={openRegister}>{t("免费注册", "Sign up free")}</RedesignButton>
            </div>
          </nav>
        </header>

        <main>
          <section className="amp-landing-hero">
            <div className="amp-container">
              <div className="amp-hero-content">
                <RedesignBadge icon={<InlineIcon name="sparkle" className="h-4 w-4" />}>
                  {t("AI 驱动 · 数据智能 · 品牌增长", "AI-powered · Data-driven · Brand growth")}
                </RedesignBadge>
                <h1 className="amp-hero-title">
                  {t("释放 AI 营销的力量", "Unlock the power of AI marketing")}
                  <span className="amp-hero-title-highlight">{t("助力科技型中小企业品牌飞跃", "Helping tech SMEs grow their brands")}</span>
                </h1>
                <p className="amp-hero-subtitle">
                  {t("Marventa AI 帮助企业从市场洞察到内容创作，再到全渠道策略优化，构建数据驱动的智能营销闭环，快速提升品牌影响力与业务增长。", "Marventa AI connects market insight, content creation, and cross-channel strategy in a data-driven marketing workflow, helping businesses strengthen their brands and accelerate growth.")}
                </p>
                <div className="amp-hero-actions">
                  <RedesignButton onClick={openRegister}>{t("免费体验", "Try it free")}</RedesignButton>
                  <RedesignButton variant="secondary" onClick={openRegister}>
                    {t("了解更多", "Learn more")}
                  </RedesignButton>
                </div>
              </div>
            </div>
          </section>

          <section className="amp-section amp-solution-section">
            <div className="amp-container">
              <RedesignSectionHeader
                title={t("一站式 AI 营销解决方案", "An All-in-One AI Marketing Solution")}
                subtitle={t("覆盖营销全链路，打造高效、智能、可衡量的增长引擎", "Connect your entire marketing workflow for efficient, intelligent, and measurable growth.")}
              />
              <div className="amp-solution-grid">
                {solutionCards.map((card) => (
                  <RedesignCard key={card.title} className="amp-solution-card" hover>
                    <RedesignIconBox tone={card.tone}>
                      <InlineIcon name={card.icon} className="h-6 w-6" />
                    </RedesignIconBox>
                    <h3 className="amp-card-title">{t(card.title, card.titleEn)}</h3>
                    <p className="amp-card-copy">{t(card.copy, card.copyEn)}</p>
                  </RedesignCard>
                ))}
              </div>
            </div>
          </section>

          <section className="amp-workflow-section">
            <div className="amp-container">
              <RedesignSectionHeader title={t("三步开启智能营销新体验", "Start Your AI Marketing Workflow in Three Steps")} subtitle={t("简单三步，快速上手，开启 AI 营销之旅", "Get started with AI marketing in three simple steps.")} />
              <div className="amp-workflow-grid">
                {workflowSteps.map((step) => (
                  <div key={step.index} className="amp-workflow-step">
                    <span className="amp-workflow-asset-icon">
                      <InlineIcon name={step.icon} className="amp-workflow-icon" />
                    </span>
                    <h3 className="amp-workflow-title">
                      <span className="amp-workflow-index">{step.index}</span>
                      {t(step.title, step.titleEn)}
                    </h3>
                    <p className="amp-workflow-copy">{t(step.copy, step.copyEn)}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="features" className="amp-container amp-section amp-anchor-section">
            <RedesignSectionHeader title={t("产品功能", "Product Features")} subtitle={t("覆盖营销全链路的 AI 能力，让内容生产、决策与复盘更智能", "AI capabilities for content production, decision-making, and performance review across your marketing workflow.")} />
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-6">
              {productFeatureCards.map((card) => (
                <RedesignCard key={card.title} className="p-6" hover>
                  <RedesignIconBox tone={card.tone}>
                    <InlineIcon name={card.icon} className="h-5 w-5" />
                  </RedesignIconBox>
                  <h3 className="mt-5 text-lg font-black text-slate-950">{t(card.title, card.titleEn)}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{t(card.copy, card.copyEn)}</p>
                </RedesignCard>
              ))}
            </div>
          </section>

          <section id="solutions" className="amp-container amp-section amp-anchor-section">
            <RedesignSectionHeader title={t("解决方案", "Solutions")} subtitle={t("针对不同行业与场景，提供可落地的 AI 营销解决方案", "Practical AI marketing solutions for different industries and use cases.")} />
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {solutionPreviewCards.map((card, index) => (
                <RedesignCard key={card.title} className="p-7" hover>
                  <RedesignIconBox tone={card.tone} className="h-14 w-14 overflow-hidden rounded-full p-0">
                    <Image
                      src={solutionPreviewIconImages[index].src}
                      alt={t(solutionPreviewIconImages[index].alt, solutionPreviewIconImages[index].altEn)}
                      width={56}
                      height={56}
                      className="h-full w-full object-cover"
                    />
                  </RedesignIconBox>
                  <h3 className="mt-6 text-lg font-black text-slate-950">{t(card.title, card.titleEn)}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{t(card.copy, card.copyEn)}</p>
                </RedesignCard>
              ))}
            </div>
          </section>

          <section className="amp-container amp-section amp-cta-section">
            <div className="amp-landing-cta">
              <h2 className="mb-3 text-3xl font-black">{t("准备好让品牌实现增长了吗？", "Ready to Grow Your Brand?")}</h2>
              <p className="mx-auto mb-7 max-w-xl text-white/85">
                {t("加入 Marventa AI，开启从洞察到增长的智能营销新未来。", "Start with Marventa AI and turn insights into growth with smarter marketing.")}
              </p>
              <RedesignButton onClick={openRegister} variant="secondary">
                {t("立即免费体验", "Try it free today")}
              </RedesignButton>
            </div>
          </section>

        </main>
      </div>
    </div>
  );
}
