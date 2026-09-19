"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/contexts/i18n_context";
import type { TranslationValues } from "@/i18n/locale";
import { fetch_history } from "@/services/api_client";
import { fetch_cases, fetch_my_cases, fetch_my_favorites } from "@/services/api_client";
import type { HistoryRecord } from "@/types/market_insight";
import type { CaseItem } from "@/types/case_library";

export interface RefLabel { id: string; label: string }

type Feedback = string | { zh: string; en: string; values?: TranslationValues };

interface Props {
  open: boolean;
  selected_insight_ids: string[];
  selected_case_ids: string[];
  onConfirm: (insight_ids: string[], case_ids: string[], insight_labels: RefLabel[], case_labels: RefLabel[]) => void;
  onClose: () => void;
}

export default function ReferencePanel({
  open, selected_insight_ids, selected_case_ids,
  onConfirm, onClose,
}: Props) {
  const { t, locale } = useI18n();
  const [tab, set_tab] = useState<"insight" | "case">("insight");
  const [insights, set_insights] = useState<HistoryRecord[]>([]);
  const [curated_cases, set_curated_cases] = useState<CaseItem[]>([]);
  const [my_cases, set_my_cases] = useState<CaseItem[]>([]);
  const [favorite_cases, set_favorite_cases] = useState<CaseItem[]>([]);
  const [loading, set_loading] = useState(false);
  const [picked_insights, set_picked_insights] = useState<string[]>([]);
  const [picked_cases, set_picked_cases] = useState<string[]>([]);
  const [search, set_search] = useState("");
  const [case_filter, set_case_filter] = useState<"all" | "video" | "image_text">("all");
  const [case_subtab, set_case_subtab] = useState<"curated" | "favorites" | "my">("curated");
  const [expanded, set_expanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    set_picked_insights([...selected_insight_ids]);
    set_picked_cases([...selected_case_ids]);
    set_loading(true);
    Promise.all([
      fetch_history().catch(() => ({ success: true, message: "", data: [] as HistoryRecord[] })),
      fetch_cases(100, 0, "", "curated").catch(() => ({ success: true, message: "", data: { cases: [] as CaseItem[], favorite_ids: [] } })),
      fetch_my_cases(100, 0).catch(() => ({ success: true, message: "", data: { cases: [] as CaseItem[], favorite_ids: [] } })),
      fetch_my_favorites(100, 0).catch(() => ({ success: true, message: "", data: { cases: [] as CaseItem[], favorite_ids: [] } })),
    ]).then(([hRes, cRes, mRes, fRes]) => {
      set_insights(hRes.data as HistoryRecord[]);
      const cData = cRes.data as { cases: CaseItem[]; favorite_ids: string[] };
      set_curated_cases(cData.cases || []);
      const mData = mRes.data as { cases: CaseItem[]; favorite_ids: string[] };
      set_my_cases(mData.cases || []);
      const fData = fRes.data as { cases: CaseItem[]; favorite_ids: string[] };
      set_favorite_cases(fData.cases || []);
    }).finally(() => set_loading(false));
  }, [open]);

  const [toast, set_toast] = useState<Feedback | null>(null);

  const show_toast = (msg: Feedback) => {
    set_toast(msg);
    setTimeout(() => set_toast(null), 2000);
  };

  const get_picked_case_type = (): "video" | "image_text" | null => {
    if (picked_cases.length === 0) return null;
    const all_cases = [...curated_cases, ...my_cases, ...favorite_cases];
    const picked = all_cases.find((c) => c.id === picked_cases[0]);
    return (picked?.content_type as "video" | "image_text") || null;
  };

  const toggle_insight = (id: string) => {
    set_picked_insights((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 1) { show_toast({ zh: "市场洞察最多选择 1 个", en: "You can select only one Market Insight" }); return prev; }
      return [...prev, id];
    });
  };

  const toggle_case = (id: string) => {
    set_picked_cases((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const all_cases = [...curated_cases, ...my_cases, ...favorite_cases];
      const c = all_cases.find((x) => x.id === id);
      if (!c) return prev;
      const existing_type = get_picked_case_type();
      if (existing_type && c.content_type !== existing_type) {
        show_toast(existing_type === "video" ? { zh: "已选择视频案例，不能同时选择图文案例", en: "A video case is selected. Image post cases cannot be selected at the same time." } : { zh: "已选择图文案例，不能同时选择视频案例", en: "An image post case is selected. Video cases cannot be selected at the same time." });
        return prev;
      }
      if (c.content_type === "video" && prev.length >= 1) {
        show_toast({ zh: "视频案例最多选择 1 个", en: "You can select only one video case" }); return prev;
      }
      if (c.content_type === "image_text" && prev.length >= 3) {
        show_toast({ zh: "图文案例最多选择 3 个", en: "You can select up to three image post cases" }); return prev;
      }
      return [...prev, id];
    });
  };

  const toggle_expand = (id: string) => {
    set_expanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handle_confirm = () => {
    const seen_insights = new Set<string>();
    const insight_labels: RefLabel[] = insights
      .filter((i) => picked_insights.includes(i.id) && !seen_insights.has(i.id) && seen_insights.add(i.id))
      .map((i) => ({ id: i.id, label: i.ai_analysis?.product_name || i.title || i.filename }));

    const seen_cases = new Set<string>();
    const case_labels: RefLabel[] = [...curated_cases, ...my_cases, ...favorite_cases]
      .filter((c) => picked_cases.includes(c.id) && !seen_cases.has(c.id) && seen_cases.add(c.id))
      .map((c) => ({ id: c.id, label: c.title }));
    onConfirm(picked_insights, picked_cases, insight_labels, case_labels);
    onClose();
  };

  const filtered_insights = search
    ? insights.filter((i) => {
        const label = (i.ai_analysis?.product_name || i.title || i.filename).toLowerCase();
        const cat = (i.ai_analysis?.product_category || "").toLowerCase();
        const q = search.toLowerCase();
        return label.includes(q) || cat.includes(q);
      })
    : insights;

  const filtered_curated = curated_cases.filter((c) => {
    if (case_filter !== "all" && c.content_type !== case_filter) return false;
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filtered_my = my_cases.filter((c) => {
    if (case_filter !== "all" && c.content_type !== case_filter) return false;
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filtered_favorites = favorite_cases.filter((c) => {
    if (case_filter !== "all" && c.content_type !== case_filter) return false;
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-96 max-w-[92vw] h-full bg-white dark:bg-zinc-950 shadow-2xl border-l border-zinc-200 dark:border-zinc-800 flex flex-col">
        {/* Header */}
        <div className="flex items-center px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">{t("引用素材", "Reference materials")}</h2>
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-xl">
            {typeof toast === "string" ? toast : t(toast.zh, toast.en, toast.values)}
          </div>
        )}

        {/* Tabs */}
        <div className="flex p-1 mx-3 mt-3 rounded-lg bg-zinc-100 dark:bg-zinc-800/60">
          <button
            onClick={() => { set_tab("insight"); set_search(""); }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              tab === "insight" ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm" : "text-zinc-500"
            }`}
          >
            {t("市场洞察 ({count})", "Market Insight ({count})", { count: picked_insights.length.toLocaleString(locale) })}
          </button>
          <button
            onClick={() => { set_tab("case"); set_search(""); set_case_subtab("curated"); }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              tab === "case" ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm" : "text-zinc-500"
            }`}
          >
            {t("案例库 ({count})", "Case Library ({count})", { count: picked_cases.length.toLocaleString(locale) })}
          </button>
        </div>

        {/* Search + Filter */}
        <div className="px-3 pt-3 space-y-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              value={search}
              onChange={(e) => set_search(e.target.value)}
              placeholder={tab === "insight" ? t("搜索产品名称、品类...", "Search product names or categories...") : t("搜索案例标题...", "Search case titles...")}
              className="w-full pl-8 pr-8 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
            />
            {search && (
              <button
                onClick={() => set_search("")}
                aria-label={t("清除搜索", "Clear search")}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-500 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors cursor-pointer"
              >
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {tab === "case" && (
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-zinc-100/60 dark:bg-zinc-800/60">
              {[
                { key: "all", label: t("全部", "All") },
                { key: "video", label: t("视频", "Video") },
                { key: "image_text", label: t("图文", "Image post") },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => set_case_filter(f.key as "all" | "video" | "image_text")}
                  className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    case_filter === f.key
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="w-6 h-6 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : tab === "insight" ? (
            insights.length === 0 ? (
              <p className="text-center text-sm text-zinc-400 py-12">{t("暂无市场洞察记录", "No Market Insight records yet")}</p>
            ) : filtered_insights.length === 0 ? (
              <p className="text-center text-sm text-zinc-400 py-12">{t("无匹配结果", "No matching results")}</p>
            ) : (
              <div className="space-y-2">
                {filtered_insights.map((item) => {
                  const sel = picked_insights.includes(item.id);
                  const is_expanded = expanded.has(item.id);
                  const a = item.ai_analysis;
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border transition-all ${
                        sel
                          ? "border-violet-400 dark:border-violet-600 bg-violet-50 dark:bg-violet-950/20"
                          : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center p-3">
                        <button
                          onClick={() => toggle_insight(item.id)}
                          className="flex-1 text-left min-w-0 cursor-pointer"
                        >
                          <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                            {a?.product_name || item.title || item.filename}
                          </p>
                          {a?.product_category && (
                            <p className="text-xs text-zinc-500 mt-0.5 truncate">{a.product_category}</p>
                          )}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggle_expand(item.id); }}
                          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors ml-1 cursor-pointer"
                        >
                          <svg className={`w-4 h-4 transition-transform ${is_expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </button>
                        {sel && (
                          <svg className="w-5 h-5 text-violet-500 shrink-0 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        )}
                      </div>
                      {is_expanded && (
                        <div className="px-3 pb-3 pt-0 text-xs text-zinc-600 dark:text-zinc-400 space-y-2 border-t border-zinc-100 dark:border-zinc-800">
                          {a?.product_description && (
                            <div>
                              <span className="font-medium text-zinc-500">{t("产品描述：", "Product description:")}</span>
                              <span className="line-clamp-4">{a.product_description}</span>
                            </div>
                          )}
                          {a?.market_positioning && (
                            <div>
                              <span className="font-medium text-zinc-500">{t("市场定位：", "Market positioning:")}</span>
                              <span>{a.market_positioning}</span>
                            </div>
                          )}
                          {a?.target_audience && (
                            <div>
                              <span className="font-medium text-zinc-500">{t("目标受众：", "Target audience:")}</span>
                              <span>{a.target_audience}</span>
                            </div>
                          )}
                          {a?.strengths && a.strengths.length > 0 && (
                            <div>
                              <span className="font-medium text-zinc-500">{t("优势：", "Strengths:")}</span>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {a.strengths.map((s, i) => (
                                  <span key={i} className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">{s}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {a?.suggested_marketing_angles && a.suggested_marketing_angles.length > 0 && (
                            <div>
                              <span className="font-medium text-zinc-500">{t("营销角度：", "Marketing angles:")}</span>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {a.suggested_marketing_angles.map((m, i) => (
                                  <span key={i} className="px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">{m}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <>
              {/* Case sub-tabs */}
              <div className="flex p-0.5 rounded-lg bg-zinc-100/60 dark:bg-zinc-800/60 mb-3">
                <button
                  onClick={() => set_case_subtab("curated")}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    case_subtab === "curated"
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {t("行业精选", "Industry picks")}
                </button>
                <button
                  onClick={() => set_case_subtab("my")}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    case_subtab === "my"
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {t("我的案例", "My cases")}
                </button>
                <button
                  onClick={() => set_case_subtab("favorites")}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    case_subtab === "favorites"
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {t("我的收藏", "My favorites")}
                </button>
              </div>

              {case_subtab === "curated" && (
                curated_cases.length === 0 ? (
                  <p className="text-center text-sm text-zinc-400 py-12">{t("暂无行业精选案例", "No industry picks yet")}</p>
                ) : filtered_curated.length === 0 ? (
                  <p className="text-center text-sm text-zinc-400 py-12">{t("无匹配结果", "No matching results")}</p>
                ) : (
                  <div className="space-y-2">
                    {filtered_curated.map((c) => {
                      const sel = picked_cases.includes(c.id);
                      const is_expanded = expanded.has(c.id);
                      const a = c.ai_analysis;
                      return (
                        <div
                          key={c.id}
                          className={`rounded-xl border transition-all ${
                            sel
                              ? "border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/20"
                              : "border-zinc-200 dark:border-zinc-800"
                          }`}
                        >
                          <div className="flex items-center p-3">
                            <button
                              onClick={() => toggle_case(c.id)}
                              className="flex-1 text-left min-w-0 cursor-pointer"
                            >
                              <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{c.title}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                  c.content_type === "video"
                                    ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                }`}>
                                  {c.content_type === "video" ? t("视频", "Video") : t("图文", "Image post")}
                                </span>
                                {c.source && (
                                  <span className="text-xs text-zinc-400">{c.source}</span>
                                )}
                              </div>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggle_expand(c.id); }}
                              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors ml-1 cursor-pointer"
                            >
                              <svg className={`w-4 h-4 transition-transform ${is_expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                              </svg>
                            </button>
                            {sel && (
                              <svg className="w-5 h-5 text-amber-500 shrink-0 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                            )}
                          </div>
                          {is_expanded && (
                            <div className="px-3 pb-3 pt-0 text-xs text-zinc-600 dark:text-zinc-400 space-y-2 border-t border-zinc-100 dark:border-zinc-800">
                              {c.description && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("描述：", "Description:")}</span>
                                  <span className="line-clamp-4">{c.description}</span>
                                </div>
                              )}
                              {c.tags && c.tags.length > 0 && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("标签：", "Tags:")}</span>
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {c.tags.map((t, i) => (
                                      <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{t}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {a?.content_analysis && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("内容分析：", "Content analysis:")}</span>
                                  <span className="line-clamp-4">{a.content_analysis}</span>
                                </div>
                              )}
                              {a?.marketing_angle && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("营销角度：", "Marketing angles:")}</span>
                                  <span>{a.marketing_angle}</span>
                                </div>
                              )}
                              {a?.key_highlights && a.key_highlights.length > 0 && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("亮点：", "Highlights:")}</span>
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {a.key_highlights.map((h, i) => (
                                      <span key={i} className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">{h}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}
              {case_subtab === "favorites" && (
                favorite_cases.length === 0 ? (
                  <p className="text-center text-sm text-zinc-400 py-12">{t("暂无收藏案例", "No favorite cases yet")}</p>
                ) : filtered_favorites.length === 0 ? (
                  <p className="text-center text-sm text-zinc-400 py-12">{t("无匹配结果", "No matching results")}</p>
                ) : (
                  <div className="space-y-2">
                    {filtered_favorites.map((c) => {
                      const sel = picked_cases.includes(c.id);
                      const is_expanded = expanded.has(c.id);
                      const a = c.ai_analysis;
                      return (
                        <div
                          key={c.id}
                          className={`rounded-xl border transition-all ${
                            sel
                              ? "border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/20"
                              : "border-zinc-200 dark:border-zinc-800"
                          }`}
                        >
                          <div className="flex items-center p-3">
                            <button
                              onClick={() => toggle_case(c.id)}
                              className="flex-1 text-left min-w-0 cursor-pointer"
                            >
                              <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{c.title}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                  c.content_type === "video"
                                    ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                }`}>
                                  {c.content_type === "video" ? t("视频", "Video") : t("图文", "Image post")}
                                </span>
                              </div>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggle_expand(c.id); }}
                              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors ml-1 cursor-pointer"
                            >
                              <svg className={`w-4 h-4 transition-transform ${is_expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                              </svg>
                            </button>
                            {sel && (
                              <svg className="w-5 h-5 text-amber-500 shrink-0 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                            )}
                          </div>
                          {is_expanded && (
                            <div className="px-3 pb-3 pt-0 text-xs text-zinc-600 dark:text-zinc-400 space-y-2 border-t border-zinc-100 dark:border-zinc-800">
                              {c.description && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("描述：", "Description:")}</span>
                                  <span className="line-clamp-4">{c.description}</span>
                                </div>
                              )}
                              {c.tags && c.tags.length > 0 && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("标签：", "Tags:")}</span>
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {c.tags.map((t, i) => (
                                      <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{t}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {a?.content_analysis && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("内容分析：", "Content analysis:")}</span>
                                  <span className="line-clamp-4">{a.content_analysis}</span>
                                </div>
                              )}
                              {a?.marketing_angle && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("营销角度：", "Marketing angles:")}</span>
                                  <span>{a.marketing_angle}</span>
                                </div>
                              )}
                              {a?.key_highlights && a.key_highlights.length > 0 && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("亮点：", "Highlights:")}</span>
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {a.key_highlights.map((h, i) => (
                                      <span key={i} className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">{h}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}
              {case_subtab === "my" && (
                my_cases.length === 0 ? (
                  <p className="text-center text-sm text-zinc-400 py-12">{t("暂无我的案例", "No cases yet")}</p>
                ) : filtered_my.length === 0 ? (
                  <p className="text-center text-sm text-zinc-400 py-12">{t("无匹配结果", "No matching results")}</p>
                ) : (
                  <div className="space-y-2">
                    {filtered_my.map((c) => {
                      const sel = picked_cases.includes(c.id);
                      const is_expanded = expanded.has(c.id);
                      const a = c.ai_analysis;
                      return (
                        <div
                          key={c.id}
                          className={`rounded-xl border transition-all ${
                            sel
                              ? "border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/20"
                              : "border-zinc-200 dark:border-zinc-800"
                          }`}
                        >
                          <div className="flex items-center p-3">
                            <button
                              onClick={() => toggle_case(c.id)}
                              className="flex-1 text-left min-w-0 cursor-pointer"
                            >
                              <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{c.title}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                  c.content_type === "video"
                                    ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                }`}>
                                  {c.content_type === "video" ? t("视频", "Video") : t("图文", "Image post")}
                                </span>
                              </div>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggle_expand(c.id); }}
                              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors ml-1 cursor-pointer"
                            >
                              <svg className={`w-4 h-4 transition-transform ${is_expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                              </svg>
                            </button>
                            {sel && (
                              <svg className="w-5 h-5 text-amber-500 shrink-0 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                            )}
                          </div>
                          {is_expanded && (
                            <div className="px-3 pb-3 pt-0 text-xs text-zinc-600 dark:text-zinc-400 space-y-2 border-t border-zinc-100 dark:border-zinc-800">
                              {c.description && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("描述：", "Description:")}</span>
                                  <span className="line-clamp-4">{c.description}</span>
                                </div>
                              )}
                              {c.tags && c.tags.length > 0 && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("标签：", "Tags:")}</span>
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {c.tags.map((t, i) => (
                                      <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{t}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {a?.content_analysis && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("内容分析：", "Content analysis:")}</span>
                                  <span className="line-clamp-4">{a.content_analysis}</span>
                                </div>
                              )}
                              {a?.marketing_angle && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("营销角度：", "Marketing angles:")}</span>
                                  <span>{a.marketing_angle}</span>
                                </div>
                              )}
                              {a?.key_highlights && a.key_highlights.length > 0 && (
                                <div>
                                  <span className="font-medium text-zinc-500">{t("亮点：", "Highlights:")}</span>
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {a.key_highlights.map((h, i) => (
                                      <span key={i} className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">{h}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
          >
            {t("取消", "Cancel")}
          </button>
          <button
            onClick={handle_confirm}
            className="amp-button amp-button-primary flex-1 cursor-pointer"
          >
            {t("确认选择", "Confirm selection")}
          </button>
        </div>
      </div>
    </div>
  );
}
