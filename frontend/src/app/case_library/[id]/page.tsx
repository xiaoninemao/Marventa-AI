"use client";

import { useState, useEffect, useEffectEvent, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth_context";
import { fetch_case, favorite_case, unfavorite_case } from "@/services/api_client";
import type { CaseItem } from "@/types/case_library";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8765";

function media_url(path: string) {
  return `${API_BASE}/media/${path}`;
}

export default function CaseDetailPage() {
  const { t } = useI18n();
  const { showError } = useToast();
  const params = useParams();
  const router = useRouter();
  const search_params = useSearchParams();
  const { user } = useAuth();
  const id = params.id as string;
  const from_tab = search_params.get("tab");

  const [case_, set_case] = useState<CaseItem | null>(null);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [lightbox_open, set_lightbox_open] = useState(false);
  const [lightbox_idx, set_lightbox_idx] = useState(0);
  const [is_fav, set_is_fav] = useState(false);
  const [fav_pending, set_fav_pending] = useState(false);
  const [toast, set_toast] = useState<string | null>(null);
  const prev_ai_status = useRef<string | undefined>(undefined);
  const report_load_error = useEffectEvent(() => set_error(t("案例未找到", "Case not found")));

  const show_toast = useCallback((msg: string) => {
    set_toast(msg);
    setTimeout(() => set_toast(null), 4000);
  }, []);

  useEffect(() => {
    if (error) showError(error);
  }, [error, showError]);

  // Detect AI analysis status transitions and notify
  useEffect(() => {
    if (!case_) return;
    const prev = prev_ai_status.current;
    const curr = case_.ai_status;
    prev_ai_status.current = curr;
    if (prev === undefined || prev === curr) return;
    if (curr === "analyzing") {
      show_toast(t("AI 分析已开始，你可以离开页面，分析将在后台继续", "AI analysis has started. You can leave this page; analysis will continue in the background."));
    } else if (prev === "analyzing" && case_.ai_analysis) {
      show_toast(t("AI 分析已完成", "AI analysis complete"));
    } else if (prev === "analyzing" && curr === "failed") {
      show_toast(t("AI 分析失败", "AI analysis failed"));
    }
  }, [case_, show_toast, t]);

  useEffect(() => {
    if (!id) return;
    set_loading(true);
    fetch_case(id)
      .then((res) => { set_case(res.data); set_is_fav(res.data.is_favorited || false); })
      .catch(report_load_error)
      .finally(() => set_loading(false));
  }, [id]);

  // Auto-poll while AI is analyzing
  useEffect(() => {
    if (!id || case_?.ai_status !== "analyzing") return;
    const interval = setInterval(() => {
      fetch_case(id).then((res) => { set_case(res.data); set_is_fav(res.data.is_favorited || false); }).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [id, case_?.ai_status]);

  const handle_favorite = async () => {
    if (!user || fav_pending) return;
    set_fav_pending(true);
    try {
      if (is_fav) {
        await unfavorite_case(id);
        set_is_fav(false);
      } else {
        await favorite_case(id);
        set_is_fav(true);
      }
    } catch {
      showError(t("收藏操作失败，请重试", "Could not update favorite. Please try again."));
    } finally {
      set_fav_pending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <svg role="status" aria-label={t("加载中...", "Loading...")} className="w-8 h-8 animate-spin text-amber-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (error || !case_) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Link
            href="/case_library"
            className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
          >
            {t("返回案例库", "Back to Case Library")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-[calc(100%_-_40px)] px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-xl animate-in fade-in">
          {toast}
        </div>
      )}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Back button */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => router.push(from_tab ? `/case_library?tab=${from_tab}` : "/case_library")}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors cursor-pointer"
            title={t("返回案例库", "Back to Case Library")}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
            </svg>
          </button>
        </div>

        {/* Media */}
        {case_.content_type === "video" ? (
          <div className="rounded-2xl overflow-hidden bg-black mb-8">
            <video
              src={media_url(case_.video_url)}
              controls
              className="w-full max-h-[60vh] object-contain"
            />
          </div>
        ) : (
          <div className="mb-8">
            <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide -mx-6 px-6 pb-2">
              {case_.image_urls.map((url, i) => (
                <div
                  key={i}
                  className="shrink-0 w-[70vw] max-w-[600px] aspect-[4/3] rounded-2xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 cursor-pointer snap-center"
                  onClick={() => { set_lightbox_idx(i); set_lightbox_open(true); }}
                >
                  <img
                    src={media_url(url)}
                    alt={`${case_.title} - ${i + 1}`}
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Title & Meta */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
            case_.content_type === "video"
              ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          }`}>
            {case_.content_type === "video" ? t("视频", "Video") : t("图文", "Image post")}
          </span>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-white font-heading">
            {case_.title}
          </h1>
          {user && (
            <button
              onClick={handle_favorite}
              disabled={fav_pending}
              className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-xl transition-all cursor-pointer ${
                is_fav
                  ? "bg-amber-50 dark:bg-amber-950/30 text-amber-500"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30"
              }`}
              title={is_fav ? t("取消收藏", "Remove from favorites") : t("收藏", "Add to favorites")}
            >
              {is_fav ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M6.32 2.577a49.255 49.255 0 0111.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 01-1.085.67L12 18.089l-7.165 3.583A.75.75 0 013.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                </svg>
              )}
            </button>
          )}
        </div>

        {case_.description && (
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6">{case_.description}</p>
        )}

        {case_.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-8">
            {case_.tags.map((tag) => (
              <span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* AI Analysis */}
        {case_.ai_status === "analyzing" ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-10 text-center dark:border-blue-800/40 dark:bg-blue-950/20">
            <div className="relative mb-4">
              <div className="absolute inset-0 rounded-full bg-blue-200 opacity-50 animate-pulse dark:bg-blue-900" />
              <svg className="relative w-12 h-12 animate-spin text-indigo-600 mx-auto" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <p className="text-base font-semibold text-indigo-700 dark:text-indigo-400">{t("AI 正在分析中...", "AI analysis in progress...")}</p>
            <p className="text-xs text-indigo-400 dark:text-indigo-500 mt-2">{t("你可以离开此页面，分析将在后台自动完成", "You can leave this page. Analysis will finish in the background.")}</p>
          </div>
        ) : case_.ai_analysis ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-6 space-y-5">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white font-heading flex items-center gap-2">
              <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
              {t("AI 分析", "AI analysis")}
            </h2>
            {case_.ai_analysis.content_analysis && (
              <div className="p-4 rounded-xl bg-cyan-50 dark:bg-cyan-950/20">
                <h3 className="text-xs font-semibold text-cyan-600 dark:text-cyan-400 mb-1">{t("内容解析", "Content analysis")}</h3>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{case_.ai_analysis.content_analysis}</p>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-violet-50 dark:bg-violet-950/20">
                <h3 className="text-xs font-semibold text-violet-600 dark:text-violet-400 mb-1">{t("营销角度", "Marketing angle")}</h3>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{case_.ai_analysis.marketing_angle}</p>
              </div>
              <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/20">
                <h3 className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-1">{t("目标受众", "Target audience")}</h3>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{case_.ai_analysis.target_audience}</p>
              </div>
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20">
                <h3 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1">{t("经验借鉴", "Lessons learned")}</h3>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{case_.ai_analysis.experience_extraction}</p>
              </div>
            </div>
            {case_.ai_analysis.key_highlights.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 mb-2">{t("关键亮点", "Key highlights")}</h3>
                <div className="flex flex-wrap gap-2">
                  {case_.ai_analysis.key_highlights.map((h, i) => (
                    <span key={i} className="text-sm px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{h}</span>
                  ))}
                </div>
              </div>
            )}
            {case_.ai_analysis.improvement_suggestions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 mb-2">{t("改进建议", "Suggestions for improvement")}</h3>
                <ul className="space-y-1.5">
                  {case_.ai_analysis.improvement_suggestions.map((s, i) => (
                    <li key={i} className="text-sm text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5">✓</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {case_.ai_analysis.similar_approaches.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 mb-2">{t("类似营销方式", "Similar marketing approaches")}</h3>
                <div className="flex flex-wrap gap-2">
                  {case_.ai_analysis.similar_approaches.map((a, i) => (
                    <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{a}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : case_.ai_status === "failed" ? (
          <div className="rounded-2xl border border-red-200 dark:border-red-800/40 bg-red-50/50 dark:bg-red-950/20 p-8 text-center">
            <svg className="w-10 h-10 mx-auto text-red-300 dark:text-red-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-sm text-red-500 dark:text-red-400">{t("AI 分析失败", "AI analysis failed")}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30 p-8 text-center">
            <svg className="w-10 h-10 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("该案例尚未进行 AI 分析", "This case has not been analyzed by AI yet.")}</p>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox_open && case_.image_urls.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center"
          onClick={() => set_lightbox_open(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl w-10 h-10 flex items-center justify-center cursor-pointer"
            onClick={() => set_lightbox_open(false)}
            aria-label={t("关闭图片", "Close image viewer")}
          >
            ✕
          </button>
          {case_.image_urls.length > 1 && (
            <>
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white w-10 h-10 flex items-center justify-center text-2xl cursor-pointer"
                onClick={(e) => { e.stopPropagation(); set_lightbox_idx((lightbox_idx - 1 + case_.image_urls.length) % case_.image_urls.length); }}
                aria-label={t("上一张图片", "Previous image")}
              >
                ‹
              </button>
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white w-10 h-10 flex items-center justify-center text-2xl cursor-pointer"
                onClick={(e) => { e.stopPropagation(); set_lightbox_idx((lightbox_idx + 1) % case_.image_urls.length); }}
                aria-label={t("下一张图片", "Next image")}
              >
                ›
              </button>
            </>
          )}
          <img
            src={media_url(case_.image_urls[lightbox_idx])}
            alt={`${case_.title} - ${lightbox_idx + 1}`}
            className="max-w-[90vw] max-h-[85vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {case_.image_urls.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
              {case_.image_urls.map((_, i) => (
                <button
                  key={i}
                  aria-label={t("查看图片 {number}", "View image {number}", { number: i + 1 })}
                  className={`w-2 h-2 rounded-full transition-all cursor-pointer ${i === lightbox_idx ? "bg-white w-4" : "bg-white/40"}`}
                  onClick={(e) => { e.stopPropagation(); set_lightbox_idx(i); }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
