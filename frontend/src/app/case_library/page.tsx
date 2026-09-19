"use client";

import { Suspense, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import CaseCard, { casePlatformLabel } from "@/components/case_library/case_card";
import { create_case_import_task, fetch_cases } from "@/services/api_client";
import type { CaseItem } from "@/types/case_library";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import type { Locale, Translate } from "@/i18n/locale";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8765";

type TabKey = "mine" | "favorites";
type FilterValue = "全部" | "图文" | "短视频" | "待确认";

const getTabs = (t: Translate): Array<{ key: TabKey; label: string }> => [
  { key: "mine", label: t("我的案例", "My cases") },
  { key: "favorites", label: t("我的收藏", "Favorites") },
];

const contentTypes: FilterValue[] = ["全部", "图文", "短视频", "待确认"];

function extractCases(data: unknown): CaseItem[] {
  if (Array.isArray(data)) return data as CaseItem[];
  if (data && typeof data === "object" && Array.isArray((data as { cases?: unknown }).cases)) {
    return (data as { cases: CaseItem[] }).cases;
  }
  return [];
}

function mediaUrl(value?: string): string {
  if (!value) return "";
  if (value.startsWith("http") || value.startsWith("/")) return value.startsWith("/media/") ? `${API_BASE}${value}` : value;
  return `${API_BASE}/media/${value}`;
}

function hydrateCase(item: CaseItem, tabType?: CaseItem["tabType"]): CaseItem {
  const inferredTab: CaseItem["tabType"] = tabType || (item.category === "curated" ? "industry" : item.category === "agency" ? "enterprise" : "mine");
  return {
    ...item,
    tabType: inferredTab,
    cover_url: mediaUrl(item.cover_url || item.image_urls?.[0]),
    image_urls: (item.image_urls || []).map(mediaUrl),
    video_url: mediaUrl(item.video_url),
    body: item.body || item.description,
    published_at: item.published_at || item.created_at?.slice(0, 10),
    platform: item.platform || item.source || "待确认",
    recognition_status: item.recognition_status || "recognized",
    reusable_structure: item.reusable_structure || item.ai_analysis?.similar_approaches || [],
    rewrite_suggestions: item.rewrite_suggestions || item.ai_analysis?.improvement_suggestions || [],
  };
}

function contentTypeLabel(type: CaseItem["content_type"]): FilterValue {
  if (type === "image_text") return "图文";
  if (type === "video") return "短视频";
  return "待确认";
}

function formatNumber(value: number | null | undefined, locale: Locale, t: Translate): string {
  if (value === undefined || value === null) return t("未公开", "Not disclosed");
  if (locale === "en") return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}w`;
  return String(value);
}

function detectPlatform(value: string): string | null {
  const text = value.toLowerCase();
  if (text.includes("xiaohongshu") || text.includes("xhslink") || value.includes("小红书")) return "小红书";
  if (text.includes("douyin") || text.includes("iesdouyin") || value.includes("抖音")) return "抖音";
  return null;
}

export default function CaseLibraryPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 dark:bg-slate-950" />}>
      <CaseLibraryContent />
    </Suspense>
  );
}

function CaseLibraryContent() {
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const tabs = getTabs(t);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("mine");
  const [contentType, setContentType] = useState<FilterValue>("全部");
  const [search, setSearch] = useState("");
  const [importInput, setImportInput] = useState("");
  const importTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedCase, setSelectedCase] = useState<CaseItem | null>(null);
  const reportLoadError = useEffectEvent(() => showError(t("案例读取失败，请稍后重试。", "Failed to load cases. Please try again later.")));

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch_cases(100, 0, "", "curated"),
      fetch_cases(100, 0, "", "agency"),
      fetch_cases(100, 0, "", "mine").catch(() => ({ data: [] })),
    ]).then(([curated, agency, mine]) => {
      if (!alive) return;
      setCases([
        ...extractCases(curated.data).map((item) => hydrateCase(item, "industry")),
        ...extractCases(agency.data).map((item) => hydrateCase(item, "enterprise")),
        ...extractCases(mine.data).map((item) => hydrateCase(item, "mine")),
      ]);
    }).catch(reportLoadError);
    return () => { alive = false; };
  }, []);


  const visibleCases = useMemo(() => {
    return cases
      .filter((item) => {
        if (activeTab === "favorites") return favoriteIds.includes(item.id) || item.is_favorited || item.isFavorited;
        return item.tabType === activeTab;
      })
      .filter((item) => contentType === "全部" || contentTypeLabel(item.content_type) === contentType)
      .filter((item) => {
        const query = search.trim().toLowerCase();
        if (!query) return true;
        return [item.title, item.description, item.body, item.platform, item.industry, ...(item.tags || [])].join(" ").toLowerCase().includes(query);
      });
  }, [activeTab, cases, contentType, favoriteIds, search]);

  const toggleFavorite = (caseId: string, currentlyFavorite: boolean) => {
    setFavoriteIds((prev) => currentlyFavorite ? prev.filter((id) => id !== caseId) : Array.from(new Set([...prev, caseId])));
  };

  const handleImport = async () => {
    if (isImporting) return;
    const rawInput = (importInput || importTextareaRef.current?.value || "").trim();
    if (!rawInput || !detectPlatform(rawInput)) {
      showError(t("请粘贴小红书或抖音链接/分享文本。", "Paste a Xiaohongshu or Douyin link or share text."));
      return;
    }
    setIsImporting(true);
    setMessage(null);
    try {
      const res = await create_case_import_task(rawInput, "", true);
      const imported = res.data.case;
      if (imported) {
        const next = hydrateCase(imported, "mine");
        setCases((items) => [next, ...items.filter((item) => item.id !== next.id)]);
        setActiveTab("mine");
        setImportInput("");
        setMessage({ type: "success", text: t("已识别链接，案例已加入我的案例。", "Link recognized. The case has been added to My cases.") });
      } else {
        setMessage({ type: "success", text: t("已创建导入任务，状态：{status}", "Import task created. Status: {status}", { status: recognitionStatusLabel(res.data.recognition_status, t) }) });
      }
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("导入失败", "Import failed"), locale));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="amp-redesign amp-workspace-page">
      <div className="flex min-h-full flex-col gap-5">
        <section className="amp-workspace-card p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <h1 className="amp-workspace-title">
                {t("浏览、导入和收藏可复用营销案例", "Browse, import and save reusable marketing cases")}
              </h1>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/case_library/admin" className="amp-button amp-button-primary">
                {t("上传案例", "Upload case")}
              </Link>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="sr-only">{t("粘贴小红书或抖音链接或分享文本", "Paste a Xiaohongshu or Douyin link or share text")}</span>
              <textarea
                ref={importTextareaRef}
                value={importInput}
                onChange={(event) => {
                  setImportInput(event.target.value);
                  setMessage(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) handleImport();
                }}
                placeholder={t("粘贴小红书 / 抖音链接或完整分享文本，识别后默认加入「我的案例」", "Paste a Xiaohongshu / Douyin link or the full share text. Recognized cases are added to My cases.")}
                rows={1}
                className="amp-workspace-control h-10 min-h-10 w-full resize-none overflow-hidden py-2"
              />
            </label>
            <button type="button" onClick={handleImport} disabled={isImporting} className="amp-button amp-button-primary !h-10 !min-h-10 lg:self-start">
              {isImporting ? t("识别中...", "Recognizing...") : t("导入识别", "Import link")}
            </button>
          </div>
          {message && (
            <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-300">
              {message.text}
            </p>
          )}
        </section>

        <section className="space-y-4">
          <div className="grid gap-2 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
                  activeTab === tab.key
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
                aria-pressed={activeTab === tab.key}
              >
                {tab.label}
              </button>
            ))}
          </div>

        </section>

        <section className="amp-workspace-card flex min-h-[max(420px,calc(100dvh-520px))] flex-1 flex-col overflow-hidden">
          <div className="grid gap-3 border-b border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">{t("内容形式", "Content format")}</span>
              <select value={contentType} onChange={(event) => setContentType(event.target.value as FilterValue)} className="amp-workspace-control w-full">
                {contentTypes.map((option) => <option key={option} value={option}>{filterLabel(option, t)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">{t("搜索", "Search")}</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("搜索标题、平台、标签", "Search titles, platforms or tags")} className="amp-workspace-control w-full" />
            </label>
          </div>

          {visibleCases.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{activeTab === "favorites" ? t("暂无收藏案例", "No favorite cases") : t("暂无我的案例", "No cases yet")}</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{activeTab === "favorites" ? t("收藏案例后会显示在这里。", "Favorited cases will appear here.") : t("导入小红书 / 抖音链接，或上传一个案例。", "Import a Xiaohongshu / Douyin link or upload a case.")}</p>
          </div>
        ) : (
          <div className="grid gap-5 p-5 md:grid-cols-2 xl:grid-cols-3">
            {visibleCases.map((item) => (
              <CaseCard
                key={item.id}
                item={item}
                is_favorited={favoriteIds.includes(item.id) || item.is_favorited || item.isFavorited}
                onFavorite={toggleFavorite}
                onOpen={setSelectedCase}
              />
            ))}
          </div>
        )}
        </section>
      </div>

      {selectedCase && <CaseDetailModal item={selectedCase} onClose={() => setSelectedCase(null)} />}
      {isImporting && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm" role="status" aria-live="polite">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl dark:bg-slate-950">
            <div className="flex items-center gap-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-slate-950 dark:text-white">{t("正在读取链接", "Reading link")}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{t("正在创建导入任务...", "Creating import task...")}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CaseDetailModal({ item, onClose }: { item: CaseItem; onClose: () => void }) {
  const { t, locale } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("案例详情", "Case details")}>
      <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <p className="text-xs font-medium text-cyan-700 dark:text-cyan-300">{casePlatformLabel(item.platform, t)} / {item.scene || t("营销场景", "Marketing scenario")}</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{item.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900" aria-label={t("关闭详情", "Close details")}>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="max-h-[calc(90vh-80px)] overflow-y-auto p-5">
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
                {item.cover_url ? (
                  <div className="relative aspect-[4/3]">
                    <Image src={item.cover_url} alt={item.title} fill unoptimized sizes="(min-width: 1024px) 320px, 100vw" className="object-cover" />
                  </div>
                ) : item.video_url ? (
                  <video src={item.video_url} className="aspect-[4/3] w-full object-cover" controls playsInline preload="metadata" />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center text-sm text-slate-500">{t("待补充封面", "No cover image yet")}</div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Metric label={t("点赞", "Likes")} value={formatNumber(item.likes, locale, t)} />
                <Metric label={t("收藏", "Favorites")} value={formatNumber(item.favorites_count, locale, t)} />
                <Metric label={t("评论", "Comments")} value={formatNumber(item.comments, locale, t)} />
              </div>
            </div>
            <div className="space-y-5">
              <DetailSection title={t("案例摘要", "Case summary")}>{item.description || item.body || t("待补充", "Not available yet")}</DetailSection>
              <DetailSection title={t("原文正文", "Original content")}>{item.body || item.description || t("待补充", "Not available yet")}</DetailSection>
              <DetailSection title={t("爆点分析", "Viral appeal analysis")}>{item.ai_analysis?.content_analysis || t("待 AI 分析", "Awaiting AI analysis")}</DetailSection>
              <DetailSection title={t("可复用结构", "Reusable structure")}>
                <BulletList items={item.reusable_structure || item.ai_analysis?.similar_approaches || [t("待补充", "Not available yet")]} />
              </DetailSection>
              <DetailSection title={t("改写建议", "Rewrite suggestions")}>
                <BulletList items={item.rewrite_suggestions || item.ai_analysis?.improvement_suggestions || [t("待补充", "Not available yet")]} />
              </DetailSection>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-100 px-2 py-3 dark:bg-slate-900">
      <div className="text-base font-semibold text-slate-950 dark:text-white">{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="text-sm font-semibold text-slate-950 dark:text-white">{title}</h3>
      <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function filterLabel(value: FilterValue, t: Translate): string {
  const labels = { "全部": "All", "图文": "Image post", "短视频": "Short video", "待确认": "Unconfirmed" };
  return t(value, labels[value]);
}

function recognitionStatusLabel(value: string, t: Translate): string {
  const labels: Record<string, string> = {
    pending: t("等待中", "Pending"),
    processing: t("处理中", "Processing"),
    recognized: t("已识别", "Recognized"),
    failed: t("失败", "Failed"),
  };
  return labels[value] || value;
}
