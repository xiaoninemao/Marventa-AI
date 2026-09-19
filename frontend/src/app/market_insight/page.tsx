"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { HistoryRecord, AIAnalysis } from "@/types/market_insight";
import {
  fetch_history, fetch_history_item, update_history_item, delete_history_item,
  parse_file, parse_repo, create_manual_insight,
} from "@/services/api_client";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { translate, type Locale } from "@/i18n/locale";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8765";

function media_url(path: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${API_BASE}/media/${path}`;
}

const EMPTY_ANALYSIS: AIAnalysis = {
  product_name: "", product_category: "", product_description: "",
  similar_products: [], strengths: [], weaknesses: [],
  product_summary: "", target_audience: "", use_cases: [],
  market_positioning: "", tech_highlights: [], suggested_marketing_angles: [],
  marketing_stage: "", product_images: [],
};

export default function MarketInsightPage() {
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const { user, loading: auth_loading } = useAuth();
  const router = useRouter();

  // ── All hooks must be called before any early return ──
  const [history, set_history] = useState<HistoryRecord[]>([]);
  const [selected_id, set_selected_id] = useState<string | null>(null);
  const [selected_record, set_selected_record] = useState<HistoryRecord | null>(null);
  const [editing, set_editing] = useState(false);
  const [edited_analysis, set_edited_analysis] = useState<AIAnalysis | null>(null);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [warning, set_warning] = useState<string | null>(null);
  const MAX_FILES = 5;
  const [repo_url, set_repo_url] = useState("");
  const [selected_files, set_selected_files] = useState<File[]>([]);
  const [show_manual, set_show_manual] = useState(false);
  const [history_loading, set_history_loading] = useState(true);
  const [toast, set_toast] = useState<string | null>(null);
  const [filter_text, set_filter_text] = useState("");
  const [sort_order, set_sort_order] = useState<"newest" | "oldest">("newest");
  const [manual_form, set_manual_form] = useState<AIAnalysis>({
    product_name: "", product_category: "", product_description: "",
    similar_products: [], strengths: [], weaknesses: [],
    product_summary: "", target_audience: "", use_cases: [],
    market_positioning: "", tech_highlights: [], suggested_marketing_angles: [],
    marketing_stage: "", product_images: [],
  });

  const load_history = useCallback(async () => {
    try {
      const res = await fetch_history();
      if (res.success && res.data) set_history(res.data);
    } catch { /* ignore */ }
    finally { set_history_loading(false); }
  }, []);

  useEffect(() => { if (user) load_history(); }, [user, load_history]);

  useEffect(() => {
    if (error) showError(error);
  }, [error, showError]);

  const select_record = useCallback(async (id: string) => {
    if (selected_id === id) {
      set_selected_id(null);
      set_selected_record(null);
      set_editing(false);
      set_edited_analysis(null);
      return;
    }
    set_selected_id(id);
    set_editing(false);
    set_error(null);
    set_warning(null);
    try {
      const res = await fetch_history_item(id);
      if (res.success && res.data) set_selected_record(res.data);
    } catch {
      set_error(t("加载记录失败", "Failed to load record"));
    }
  }, [selected_id, t]);

  const refresh_record = useCallback(async (id: string) => {
    try {
      const res = await fetch_history_item(id);
      if (res.success && res.data) set_selected_record(res.data);
    } catch { /* ignore */ }
  }, []);

  const back_to_list = useCallback(() => {
    set_selected_id(null);
    set_selected_record(null);
    set_editing(false);
    set_edited_analysis(null);
  }, []);

  const handle_new_result = useCallback((record_id?: string) => {
    load_history();
    // Auto-select the new record after a short delay for DB write
    setTimeout(() => {
      if (record_id) {
        set_selected_id(record_id);
        refresh_record(record_id);
      } else {
        fetch_history().then(res => {
          if (res.success && res.data && res.data.length > 0) {
            set_selected_id(res.data[0].id);
            refresh_record(res.data[0].id);
          }
        });
      }
    }, 500);
  }, [load_history, refresh_record]);

  const handle_delete = useCallback(async (id: string) => {
    try {
      await delete_history_item(id);
      if (selected_id === id) {
        set_selected_id(null);
        set_selected_record(null);
      }
      load_history();
    } catch (e) {
      set_error(e instanceof Error ? e.message : t("删除失败", "Failed to delete"));
    }
  }, [selected_id, load_history, t]);

  const start_edit = useCallback(() => {
    set_edited_analysis(JSON.parse(JSON.stringify(selected_record?.ai_analysis || EMPTY_ANALYSIS)));
    set_editing(true);
  }, [selected_record]);

  const save_edit = useCallback(async () => {
    if (!selected_id || !edited_analysis) return;
    set_loading(true);
    try {
      const res = await update_history_item(selected_id, edited_analysis);
      if (res.success && res.data) {
        set_selected_record(res.data);
        set_editing(false);
        load_history();
      }
    } catch (e) {
      set_error(e instanceof Error ? e.message : t("更新失败", "Update failed"));
    } finally {
      set_loading(false);
    }
  }, [selected_id, edited_analysis, load_history, t]);

  const cancel_edit = useCallback(() => {
    set_editing(false);
    set_edited_analysis(null);
  }, []);

  const validate_github_url = (url: string): boolean => {
    return /^https?:\/\/github\.com\/[^/]+\/[^/]+/.test(url.trim());
  };

  const can_analyze = repo_url.trim() !== ""
    ? validate_github_url(repo_url)
    : selected_files.length > 0;

  const show_toast = useCallback((msg: string) => {
    set_toast(msg);
    setTimeout(() => set_toast(null), 3000);
  }, []);

  const handle_analyze = useCallback(async () => {
    set_loading(true); set_error(null); set_warning(null);
    try {
      if (selected_files.length > 0) {
        let failed = 0;
        let last_record_id: string | undefined;
        for (const file of selected_files) {
          const res = await parse_file(file);
          if (res.success && res.data?.record_id) last_record_id = res.data.record_id;
          else failed++;
        }
        set_selected_files([]);
        if (failed > 0) {
          show_toast(t("{submitted}/{total} 个文档已提交解析，{failed} 个失败", "{submitted}/{total} documents submitted for parsing; {failed} failed", { submitted: selected_files.length - failed, total: selected_files.length, failed }));
        } else {
          show_toast(t("{count} 个文档正在解析中，AI 正在分析...", "Parsing {count} document(s). AI analysis is in progress...", { count: selected_files.length }));
        }
        handle_new_result(last_record_id);
      } else if (repo_url.trim()) {
        if (!validate_github_url(repo_url)) {
          set_error(t("GitHub URL 格式有误，请输入正确的仓库地址（如 https://github.com/owner/repo）", "Invalid GitHub URL. Enter a repository URL such as https://github.com/owner/repo."));
          set_loading(false);
          return;
        }
        const res = await parse_repo(repo_url.trim());
        if (res.success && res.data) {
          set_repo_url("");
          show_toast(t("文档正在解析中，AI 正在分析...", "Document parsing and AI analysis are in progress..."));
          handle_new_result(res.data.record_id);
        } else {
          set_error(res.message || t("解析失败", "Parse failed"));
        }
      }
    } catch (e) {
      set_error(e instanceof Error ? e.message : t("未知错误", "Unknown error"));
    } finally { set_loading(false); }
  }, [selected_files, repo_url, show_toast, handle_new_result, t]);

  const handle_manual = useCallback(async () => {
    set_loading(true); set_error(null);
    try {
      const res = await create_manual_insight(manual_form);
      if (res.success && res.data) {
        handle_new_result(res.data.id);
        set_manual_form({
          product_name: "", product_category: "", product_description: "",
          similar_products: [], strengths: [], weaknesses: [],
          product_summary: "", target_audience: "", use_cases: [],
          market_positioning: "", tech_highlights: [], suggested_marketing_angles: [],
          marketing_stage: "", product_images: [],
        });
        set_show_manual(false);
      } else {
        set_error(res.message || t("创建失败", "Create failed"));
      }
    } catch (e) {
      set_error(e instanceof Error ? e.message : t("未知错误", "Unknown error"));
    } finally { set_loading(false); }
  }, [manual_form, handle_new_result, t]);

  // Auto-refresh history every 2s
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => { load_history(); }, 2000);
    return () => clearInterval(interval);
  }, [load_history, user]);

  // Auto-enter edit mode when no AI analysis (not analyzing or failed)
  useEffect(() => {
    if (selected_record && !selected_record.ai_analysis && selected_record.status !== "analyzing" && selected_record.status !== "failed" && !editing) {
      set_edited_analysis(JSON.parse(JSON.stringify(EMPTY_ANALYSIS)));
      set_editing(true);
    }
  }, [selected_record, editing]);

  // Auto-refresh selected record while analyzing
  useEffect(() => {
    if (!selected_id || selected_record?.status !== "analyzing") return;
    const interval = setInterval(() => { refresh_record(selected_id); }, 2000);
    return () => clearInterval(interval);
  }, [selected_id, selected_record?.status, refresh_record]);

  // Auto-reload history when a new result appears (for the handle_new_result flow)
  useEffect(() => {
    if (selected_id && selected_record?.status === "analyzing") {
      const updated = history.find(h => h.id === selected_id);
      if (updated && updated.status === "completed") {
        refresh_record(selected_id);
        load_history();
      }
    }
  }, [history, selected_id, selected_record?.status, refresh_record, load_history]);

  const analysis = editing ? (edited_analysis || EMPTY_ANALYSIS) : (selected_record?.ai_analysis || EMPTY_ANALYSIS);
  const has_analysis = !!selected_record?.ai_analysis;

  const filtered_history = useMemo(() => {
    let result = [...history];
    if (filter_text.trim()) {
      const kw = filter_text.trim().toLowerCase();
      result = result.filter(item =>
        (item.ai_analysis?.product_name || "").toLowerCase().includes(kw) ||
        (item.filename || "").toLowerCase().includes(kw) ||
        (item.ai_analysis?.product_category || "").toLowerCase().includes(kw)
      );
    }
    result.sort((a, b) => {
      const ta = new Date(a.upload_time).getTime();
      const tb = new Date(b.upload_time).getTime();
      return sort_order === "newest" ? tb - ta : ta - tb;
    });
    return result;
  }, [history, filter_text, sort_order]);

  // Auth guard — must be after all hooks
  useEffect(() => {
    if (!auth_loading && !user) {
      router.replace("/");
    }
  }, [user, auth_loading, router]);

  if (auth_loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <svg role="status" aria-label={t("加载中...", "Loading...")} className="w-8 h-8 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="amp-redesign amp-workspace-page flex h-full min-h-0 flex-col overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-lg bg-slate-900 text-white text-sm font-medium shadow-lg flex items-center gap-3 animate-[fadeIn_0.2s_ease-out]">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{toast}</span>
          <button aria-label={t("关闭通知", "Dismiss notification")} onClick={() => set_toast(null)} className="text-indigo-200 hover:text-white ml-2">✕</button>
        </div>
      )}
      <div className="amp-library-layout amp-library-shell amp-workspace-card flex min-h-0 flex-1 overflow-hidden">
      {/* Left: History Panel */}
      <div className="amp-library-sidebar w-56 lg:w-72 xl:w-80 border-r border-zinc-200 dark:border-zinc-800 flex flex-col shrink-0">
        <div className="amp-library-sidebar-header p-3 lg:p-4 border-b border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 font-heading">{t("历史记录", "History")}</h2>
            <button onClick={load_history} className="text-xs text-indigo-700 hover:text-indigo-500 cursor-pointer shrink-0 transition-colors">{t("刷新", "Refresh")}</button>
          </div>
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={filter_text}
              onChange={e => set_filter_text(e.target.value)}
              placeholder={t("搜索关键词...", "Search keywords...")}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400 transition-all"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => set_sort_order("newest")}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                sort_order === "newest"
                  ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {t("最新", "Newest")}
            </button>
            <button
              onClick={() => set_sort_order("oldest")}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                sort_order === "oldest"
                  ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {t("最早", "Oldest")}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {history_loading ? (
            <div className="p-2 space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-3 animate-pulse">
                  <div className="h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4 mb-2" />
                  <div className="h-2.5 bg-zinc-100 dark:bg-zinc-800/50 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-16 h-16 rounded-xl bg-blue-50 dark:bg-blue-950 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-indigo-400 dark:text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">{t("暂无分析记录", "No analyses yet")}</p>
              <p className="text-xs text-zinc-400 max-w-[200px]">{t("上传技术文档或输入 GitHub 仓库，开启首次 AI 分析", "Upload technical documents or enter a GitHub repository to start your first AI analysis.")}</p>
            </div>
          ) : filtered_history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <p className="text-sm text-zinc-400">{t("无匹配记录", "No matching records")}</p>
            </div>
          ) : (
            filtered_history.map((item) => (
              <div
                key={item.id}
                onClick={() => select_record(item.id)}
                className={`p-2 lg:p-3 border-b border-zinc-100 dark:border-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${
                  selected_id === item.id ? "bg-indigo-50 dark:bg-indigo-950 border-l-2 border-l-indigo-600" : ""
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs lg:text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                      {item.ai_analysis?.product_name || item.filename}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">{item.filename}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {item.status === "analyzing" ? (
                        <span className="flex items-center gap-1 text-xs text-indigo-600">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          {t("AI分析中...", "AI analysis in progress...")}
                        </span>
                      ) : (
                        <>
                          <span className="text-xs text-zinc-400">{_format_size(item.file_size)}</span>
                          <span className="text-xs text-zinc-400 hidden lg:inline">{_format_time(item.upload_time, locale)}</span>
                          {item.is_edited && (
                            <span className="text-xs text-amber-500">{t("已编辑", "Edited")}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: Detail / Upload */}
      <div className="amp-library-content flex-1 overflow-y-auto p-4 lg:p-6 min-w-0 bg-zinc-50/30 dark:bg-zinc-950/30">
        {!selected_record ? (
          <div className="max-w-xl mx-auto pt-8 lg:pt-12">
            <h2 className="mb-2 text-base font-semibold text-slate-900">{t("新建洞察", "New insight")}</h2>
            <p className="text-sm text-zinc-500 mb-6">
              {t("上传产品资料或仓库链接，生成结构化市场洞察。", "Upload product materials or a repository link to generate structured market insight.")}
            </p>

            {/* File Upload */}
            <UploadArea
              selected_files={selected_files}
              on_files_change={set_selected_files}
              loading={loading}
              max_files={MAX_FILES}
            />

            {/* GitHub URL */}
            <div className="mt-4">
              <label className="text-xs font-semibold text-zinc-500 block mb-1.5">{t("GitHub 仓库", "GitHub repository")}</label>
              <input
                type="text"
                value={repo_url}
                onChange={e => set_repo_url(e.target.value)}
                placeholder="https://github.com/owner/repo"
                disabled={loading}
                className="w-full rounded-lg border px-4 py-2.5 text-sm bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {repo_url.trim() !== "" && !validate_github_url(repo_url) && (
                <p className="text-xs text-amber-500 mt-1">{t("URL 格式不正确，请输入 https://github.com/owner/repo 格式的地址", "Invalid URL. Use the format https://github.com/owner/repo.")}</p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={handle_analyze}
                disabled={!can_analyze || loading}
                className="amp-button amp-button-primary"
              >
                {loading ? t("上传中...", "Uploading...") : t("洞察", "Analyze")}
              </button>
              <button
                onClick={() => set_show_manual(!show_manual)}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors"
              >
                {show_manual ? t("收起", "Collapse") : t("自主创建", "Create manually")}
              </button>
            </div>

            {/* Manual entry form */}
            {show_manual && (
              <div className="mt-5 border border-zinc-200 dark:border-zinc-700 rounded-xl p-5">
                <ManualEntryForm form={manual_form} onChange={set_manual_form} onSubmit={handle_manual} loading={loading} />
              </div>
            )}

            {/* Warning */}
            {warning && (
              <div className="mt-5 p-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm text-amber-700 dark:text-amber-300">{warning}</p>
                </div>
                <button aria-label={t("关闭警告", "Dismiss warning")} onClick={() => set_warning(null)} className="text-amber-400 hover:text-amber-600">✕</button>
              </div>
            )}

            {loading && (
              <p className="text-sm text-zinc-500 text-center mt-4">{t("上传中...", "Uploading...")}</p>
            )}
          </div>
        ) : (
          /* Detail view with edit capability */
          <div>
            {/* Header with back button */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={back_to_list}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                title={t("返回列表", "Back to list")}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-semibold tracking-tight text-slate-900">
                  {selected_record.ai_analysis?.product_name || (selected_record.title && selected_record.title.length > 2 ? selected_record.title : selected_record.filename) || t("未命名", "Untitled")}
                </h2>
                <div className="flex items-center gap-3 mt-1 text-sm text-zinc-500 flex-wrap">
                  <span className="truncate">{selected_record.filename}</span>
                  <span className="hidden sm:inline">{_format_size(selected_record.file_size)}</span>
                  <span className="hidden sm:inline">{formatTimestamp(selected_record.upload_time, locale)}</span>
                  <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-xs">
                    {selected_record.source_type}
                  </span>
                  {selected_record.is_edited && (
                    <span className="text-xs text-amber-500">{t("已人工编辑", "Manually edited")}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {!editing ? (
                  <>
                    <button onClick={start_edit}
                      className="amp-button amp-button-primary">
                      {t("编辑", "Edit")}
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(t("确定删除此记录吗？", "Delete this record?"))) handle_delete(selected_record.id);
                      }}
                      className="px-4 py-2 rounded-lg text-sm font-medium border border-red-200 dark:border-red-800/50 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      {t("删除", "Delete")}
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={save_edit} disabled={loading}
                      className="amp-button amp-button-primary disabled:opacity-40 disabled:cursor-not-allowed">
                      {loading ? t("保存中...", "Saving...") : t("保存", "Save")}
                    </button>
                    <button onClick={cancel_edit}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 transition-colors">
                      {t("取消", "Cancel")}
                    </button>
                  </>
                )}
              </div>
            </div>

            {selected_record?.status === "analyzing" ? (
              <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-10 dark:border-slate-800 dark:bg-slate-900">
                <div className="relative flex flex-col items-center text-center">
                  <div className="relative mb-5">
                    <div className="absolute inset-0 rounded-full bg-blue-100 opacity-60 animate-pulse dark:bg-blue-950" />
                    <svg className="relative w-12 h-12 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                  <p className="text-base font-semibold text-blue-700 dark:text-blue-300">{t("AI 正在分析中，请稍候...", "AI analysis in progress. Please wait...")}</p>
                  <p className="text-sm text-zinc-500 mt-1.5">{t("分析结果将自动更新", "Results will update automatically.")}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {!has_analysis && (
                  <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 text-sm text-amber-700 dark:text-amber-400">
                    <svg className="w-5 h-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <span>{t("AI 分析未完成 — 以下字段为空，你可以手动填写后保存。", "AI analysis is incomplete. You can fill in the empty fields below and save.")}</span>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <EditableField label={t("产品名称", "Product name")} value={analysis.product_name}
                    editing={editing} onChange={v => set_edited_analysis({...edited_analysis!, product_name: v})} />
                  <EditableField label={t("产品类别", "Product category")} value={analysis.product_category}
                    editing={editing} onChange={v => set_edited_analysis({...edited_analysis!, product_category: v})} />
                </div>

                <EditableField label={t("产品介绍", "Product description")} value={analysis.product_description} textarea
                  editing={editing} onChange={v => set_edited_analysis({...edited_analysis!, product_description: v})} />

                <EditableList label={t("相似产品", "Similar products")} items={analysis.similar_products}
                  editing={editing}
                  onItemsChange={v => set_edited_analysis({...edited_analysis!, similar_products: v})} />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <EditableList label={t("产品优势", "Product strengths")} items={analysis.strengths}
                    editing={editing} positive
                    onItemsChange={v => set_edited_analysis({...edited_analysis!, strengths: v})} />
                  <EditableList label={t("产品劣势", "Product weaknesses")} items={analysis.weaknesses}
                    editing={editing}
                    onItemsChange={v => set_edited_analysis({...edited_analysis!, weaknesses: v})} />
                </div>

                <EditableField label={t("产品摘要", "Product summary")} value={analysis.product_summary} textarea
                  editing={editing} onChange={v => set_edited_analysis({...edited_analysis!, product_summary: v})} />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <EditableField label={t("目标用户", "Target users")} value={analysis.target_audience} textarea
                    editing={editing} onChange={v => set_edited_analysis({...edited_analysis!, target_audience: v})} />
                  <EditableList label={t("使用场景", "Use cases")} items={analysis.use_cases}
                    editing={editing}
                    onItemsChange={v => set_edited_analysis({...edited_analysis!, use_cases: v})} />
                </div>

                <EditableField label={t("市场定位", "Market positioning")} value={analysis.market_positioning} textarea
                  editing={editing} onChange={v => set_edited_analysis({...edited_analysis!, market_positioning: v})} />

                <EditableField label={t("营销阶段", "Marketing stage")} value={analysis.marketing_stage}
                  editing={editing} onChange={v => set_edited_analysis({...edited_analysis!, marketing_stage: v})} />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <EditableList label={t("技术亮点", "Technical highlights")} items={analysis.tech_highlights}
                    editing={editing}
                    onItemsChange={v => set_edited_analysis({...edited_analysis!, tech_highlights: v})} />
                  <EditableList label={t("营销切入角度", "Marketing angles")} items={analysis.suggested_marketing_angles}
                    editing={editing}
                    onItemsChange={v => set_edited_analysis({...edited_analysis!, suggested_marketing_angles: v})} />
                </div>

                {/* Product Images */}
                {!editing && (
                  <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white dark:bg-zinc-900/50 hover:shadow-sm transition-shadow">
                    <h3 className="text-xs font-semibold text-zinc-500 uppercase mb-3">{t("产品图片", "Product images")}</h3>
                    {(analysis.product_images || []).length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {(analysis.product_images || []).map((url, i) => (
                          <a key={i} href={media_url(url)} target="_blank" rel="noopener noreferrer" className="block aspect-[4/3] rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors">
                            <ProductImage
                              key={url}
                              src={media_url(url)}
                              alt={t("产品图片 {number}", "Product image {number}", { number: i + 1 })}
                            />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-400 italic">{t("暂无产品图片", "No product images")}</p>
                    )}
                  </div>
                )}

                {editing && edited_analysis && (
                  <EditableImageList label={t("产品图片", "Product images")} images={edited_analysis.product_images || []}
                    onImagesChange={v => set_edited_analysis({...edited_analysis, product_images: v})} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

/* ── Reusable Editable Components ── */

function ProductImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useI18n();
  const [failed, set_failed] = useState(false);
  return failed ? (
    <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs">
      {t("加载失败", "Failed to load")}
    </div>
  ) : (
    <img src={src} alt={alt} className="w-full h-full object-cover" onError={() => set_failed(true)} />
  );
}

function EditableField({ label, value, editing, onChange, textarea }: {
  label: string; value: string; editing: boolean;
  onChange: (v: string) => void; textarea?: boolean;
}) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white dark:bg-zinc-900/50 hover:shadow-sm transition-shadow">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase mb-2">{label}</h3>
      {editing ? (
        textarea ? (
          <textarea value={value} onChange={e => onChange(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-900 resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-indigo-600" />
        ) : (
          <input value={value} onChange={e => onChange(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-600" />
        )
      ) : (
        <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{value || "—"}</p>
      )}
    </div>
  );
}

function EditableList({ label, items, editing, onItemsChange, positive }: {
  label: string; items: string[]; editing: boolean;
  onItemsChange: (v: string[]) => void; positive?: boolean;
}) {
  const { t } = useI18n();
  const add_item = () => onItemsChange([...items, ""]);
  const remove_item = (i: number) => onItemsChange(items.filter((_, idx) => idx !== i));
  const update_item = (i: number, v: string) => {
    const copy = [...items];
    copy[i] = v;
    onItemsChange(copy);
  };

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white dark:bg-zinc-900/50 hover:shadow-sm transition-shadow">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase mb-2">{label}</h3>
      {items.length === 0 && !editing ? (
        <p className="text-sm text-zinc-400 italic">—</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={`mt-1 shrink-0 ${positive ? "text-emerald-500" : "text-zinc-400"}`}>
                {positive ? "✓" : "•"}
              </span>
              {editing ? (
                <div className="flex-1 flex gap-1">
                  <input value={item} onChange={e => update_item(i, e.target.value)}
                    className="flex-1 rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-600" />
                  <button aria-label={t("删除条目", "Remove item")} onClick={() => remove_item(i)}
                    className="text-xs text-red-500 hover:text-red-700 px-1">✕</button>
                </div>
              ) : (
                <span className="text-zinc-700 dark:text-zinc-300">{item}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <button onClick={add_item}
          className="mt-2 text-xs font-medium text-indigo-600 hover:text-violet-600 dark:text-indigo-400 dark:hover:text-violet-400 transition-colors">{t("+ 添加", "+ Add")}</button>
      )}
    </div>
  );
}

/* ── Upload Area ── */

function UploadArea({ selected_files, on_files_change, loading, max_files }: {
  selected_files: File[];
  on_files_change: (files: File[]) => void;
  loading: boolean;
  max_files: number;
}) {
  const { t } = useI18n();
  const [dragging, set_dragging] = useState(false);
  const input_ref = useRef<HTMLInputElement>(null);

  const add_files = (new_files: FileList | File[]) => {
    const existing = [...selected_files];
    const remaining = max_files - existing.length;
    if (remaining <= 0) return;
    const to_add = Array.from(new_files).slice(0, remaining);
    on_files_change([...existing, ...to_add]);
    if (input_ref.current) input_ref.current.value = "";
  };

  const remove_file = (index: number) => {
    on_files_change(selected_files.filter((_, i) => i !== index));
    if (input_ref.current) input_ref.current.value = "";
  };

  return (
    <div>
      <div
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
          dragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950" : "border-zinc-300 dark:border-zinc-700"
        } ${selected_files.length >= max_files ? "opacity-50 pointer-events-none" : ""}`}
        onDragOver={e => { e.preventDefault(); set_dragging(true); }}
        onDragLeave={() => set_dragging(false)}
        onDrop={e => { e.preventDefault(); set_dragging(false); if (e.dataTransfer.files.length > 0) add_files(e.dataTransfer.files); }}
      >
        <input
          ref={input_ref}
          type="file"
          accept=".md,.markdown,.pdf,.docx"
          multiple
          onChange={e => { if (e.target.files && e.target.files.length > 0) add_files(e.target.files); }}
          className="absolute inset-0 opacity-0 cursor-pointer"
          disabled={loading || selected_files.length >= max_files}
        />

        <div className="flex flex-col items-center gap-2 pointer-events-none">
          <svg className="w-10 h-10 text-indigo-400 dark:text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
          </svg>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {selected_files.length >= max_files ? t("已达上限 {count} 个文件", "File limit reached ({count})", { count: max_files }) : t("拖拽文档或点击选择（可多选）", "Drag documents here or click to select multiple files")}
          </p>
          <p className="text-xs text-zinc-500">{t("支持 .md / .pdf / .docx · 最多 {count} 个文件", "Supports .md / .pdf / .docx · Up to {count} files", { count: max_files })}</p>
        </div>
      </div>

      {/* File list */}
      {selected_files.length > 0 && (
        <div className="mt-3 space-y-2">
          {selected_files.map((file, i) => {
            const file_colors = ["border-l-indigo-400", "border-l-violet-400", "border-l-emerald-400", "border-l-amber-400", "border-l-cyan-400"];
            const file_icon_colors = ["text-indigo-500", "text-violet-500", "text-emerald-500", "text-amber-500", "text-cyan-500"];
            return (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 border-l-2 ${file_colors[i]}`}>
              <svg className={`w-5 h-5 shrink-0 ${file_icon_colors[i]}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">{file.name}</p>
                <p className="text-xs text-zinc-500">{_format_size(file.size)}</p>
              </div>
              <button
                onClick={() => remove_file(i)}
                aria-label={t("移除文件：{name}", "Remove file: {name}", { name: file.name })}
                disabled={loading}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-xs text-zinc-400 enabled:hover:text-red-500 enabled:hover:bg-red-50 dark:enabled:hover:bg-red-950 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ✕
              </button>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Manual Entry Form (without weaknesses - AI handles that) ── */

function ManualEntryForm({ form, onChange, onSubmit, loading }: {
  form: AIAnalysis;
  onChange: (f: AIAnalysis) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1">{t("产品名称", "Product name")} <span className="text-red-500">*</span></label>
          <input value={form.product_name} onChange={e => onChange({...form, product_name: e.target.value})}
            className="w-full rounded-lg border px-3 py-1.5 text-sm bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-600" />
        </div>
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1">{t("产品类别", "Product category")} <span className="text-red-500">*</span></label>
          <input value={form.product_category} onChange={e => onChange({...form, product_category: e.target.value})}
            className="w-full rounded-lg border px-3 py-1.5 text-sm bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-600" />
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-zinc-500 block mb-1">{t("产品介绍", "Product description")} <span className="text-red-500">*</span></label>
        <textarea value={form.product_description} onChange={e => onChange({...form, product_description: e.target.value})}
          rows={4} placeholder={t("详细描述产品功能、价值主张...", "Describe product features and the value proposition in detail...")}
          className="w-full rounded-lg border px-3 py-2 text-sm bg-white dark:bg-zinc-900 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-600" />
      </div>

      <div>
        <label className="text-xs font-semibold text-zinc-500 block mb-1">{t("产品图片", "Product images")}</label>
        <div className="flex gap-3 flex-wrap">
          {(form.product_images || []).map((img, i) => (
            <div key={i} className="relative group shrink-0">
              <img
                src={img}
                alt={t("产品图片 {number}", "Product image {number}", { number: i + 1 })}
                className="w-24 h-24 object-cover rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <button
                aria-label={t("删除图片 {number}", "Remove image {number}", { number: i + 1 })}
                onClick={() => {
                  const imgs = [...(form.product_images || [])];
                  imgs.splice(i, 1);
                  onChange({...form, product_images: imgs});
                }}
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm opacity-0 group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
                    <label className="flex items-center justify-center w-24 h-24 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors bg-zinc-50 dark:bg-zinc-900 shrink-0">
            <div className="flex flex-col items-center gap-0.5 text-zinc-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span className="text-[10px]">{t("上传", "Upload")}</span>
            </div>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = () => {
                    const imgs = [...(form.product_images || []), reader.result as string];
                    onChange({...form, product_images: imgs});
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />
          </label>
        </div>
      </div>

      <ManualListInput label={t("产品优势", "Product strengths")} items={form.strengths}
        onChange={v => onChange({...form, strengths: v})} />

      <ManualListInput label={t("相似产品", "Similar products")} items={form.similar_products}
        onChange={v => onChange({...form, similar_products: v})} />

      <div>
        <label className="text-xs font-semibold text-zinc-500 block mb-1">{t("产品摘要", "Product summary")}</label>
        <textarea value={form.product_summary} onChange={e => onChange({...form, product_summary: e.target.value})}
          rows={2} placeholder={t("2-3 句营销摘要...", "A 2–3 sentence marketing summary...")}
          className="w-full rounded-lg border px-3 py-2 text-sm bg-white dark:bg-zinc-900 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-600" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1">{t("目标用户", "Target users")} <span className="text-red-500">*</span></label>
          <input value={form.target_audience} onChange={e => onChange({...form, target_audience: e.target.value})}
            className="w-full rounded-lg border px-3 py-1.5 text-sm bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-600" />
        </div>
        <ManualListInput label={t("使用场景", "Use cases")} items={form.use_cases}
          onChange={v => onChange({...form, use_cases: v})} />
      </div>

      <div>
        <label className="text-xs font-semibold text-zinc-500 block mb-1">{t("市场定位", "Market positioning")}</label>
        <textarea value={form.market_positioning} onChange={e => onChange({...form, market_positioning: e.target.value})}
          rows={2} placeholder={t("相对竞品的市场定位...", "Market positioning relative to competitors...")}
          className="w-full rounded-lg border px-3 py-2 text-sm bg-white dark:bg-zinc-900 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-600" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ManualListInput label={t("技术亮点", "Technical highlights")} items={form.tech_highlights}
          onChange={v => onChange({...form, tech_highlights: v})} />
        <ManualListInput label={t("营销切入角度", "Marketing angles")} items={form.suggested_marketing_angles}
          onChange={v => onChange({...form, suggested_marketing_angles: v})} />
      </div>

      <button onClick={onSubmit} disabled={loading || !form.product_name.trim() || !form.product_category.trim() || !form.product_description.trim() || !form.target_audience.trim()}
        className="amp-button amp-button-primary w-full">
        {loading ? t("保存中...", "Saving...") : t("保存记录", "Save record")}
      </button>
    </div>
  );
}

function ManualListInput({ label, items, onChange }: {
  label: string; items: string[]; onChange: (v: string[]) => void;
}) {
  const { t } = useI18n();
  return (
    <div>
      <label className="text-xs font-semibold text-zinc-500 block mb-1">{label}</label>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex gap-1">
            <input value={item} onChange={e => {
              const copy = [...items]; copy[i] = e.target.value; onChange(copy);
            }} className="flex-1 rounded border px-2 py-1 text-xs bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-600" />
            <button aria-label={t("删除条目", "Remove item")} onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="text-xs text-red-500 hover:text-red-700 px-1">✕</button>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...items, ""])}
        className="mt-1 text-xs font-medium text-indigo-600 hover:text-violet-600 dark:text-indigo-400 dark:hover:text-violet-400 transition-colors">{t("+ 添加", "+ Add")}</button>
    </div>
  );
}

function EditableImageList({ label, images, onImagesChange }: {
  label: string; images: string[]; onImagesChange: (v: string[]) => void;
}) {
  const { t } = useI18n();
  const add_image = () => {
    const url = window.prompt(t("输入图片 URL:", "Enter an image URL:"));
    if (url && url.trim()) {
      onImagesChange([...images, url.trim()]);
    }
  };
  const remove_image = (i: number) => onImagesChange(images.filter((_, idx) => idx !== i));

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white dark:bg-zinc-900/50 hover:shadow-sm transition-shadow">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase mb-2">{label}</h3>
      {images.length === 0 ? (
        <p className="text-sm text-zinc-400 italic mb-2">{t("暂无图片", "No images")}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
          {images.map((url, i) => (
            <div key={i} className="relative group">
              <img
                src={url}
                alt={`${label} ${i + 1}`}
                className="w-full aspect-[4/3] object-cover rounded-lg border border-zinc-200 dark:border-zinc-700"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <button
                onClick={() => remove_image(i)}
                aria-label={t("删除图片 {number}", "Remove image {number}", { number: i + 1 })}
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center hover:bg-red-600 transition-colors"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <button onClick={add_image}
        className="text-xs font-medium text-indigo-600 hover:text-violet-600 dark:text-indigo-400 dark:hover:text-violet-400 transition-colors">
        {t("+ 添加图片 URL", "+ Add image URL")}
      </button>
    </div>
  );
}

/* ── Helpers ── */

function _format_size(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTimestamp(value: string, locale: Locale): string {
  const date = new Date(value);
  return locale === "en" && !Number.isNaN(date.getTime())
    ? date.toLocaleString("en", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : value;
}

function _format_time(timestamp: string, locale: Locale): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return translate(locale, "刚刚", "Just now");
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (diff < 3600_000) return relative.format(-Math.floor(diff / 60_000), "minute");
  if (diff < 86400_000) return relative.format(-Math.floor(diff / 3600_000), "hour");
  if (diff < 604800_000) return relative.format(-Math.floor(diff / 86400_000), "day");
  return locale === "en" ? d.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }) : timestamp.slice(0, 10);
}
