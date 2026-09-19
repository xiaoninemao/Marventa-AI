"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import {
  fetch_admin_cases, fetch_my_cases, create_video_case, create_image_text_case,
  update_case, delete_case, replace_case_media, analyze_case,
} from "@/services/api_client";
import type { CaseItem } from "@/types/case_library";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { casePlatformLabel } from "@/components/case_library/case_card";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8765";

const MAX_VIDEO_MB = 100;
const MAX_IMAGE_MB = 10;
const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;

function media_url(path: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${API_BASE}/media/${path}`;
}

export default function CaseAdminPage() {
  const { t } = useI18n();
  const { showError } = useToast();
  const { user, loading: auth_loading } = useAuth();
  const router = useRouter();

  const is_admin = user?.role === "admin";

  const [cases, set_cases] = useState<CaseItem[]>([]);
  const [loading, set_loading] = useState(true);
  const [selected_id, set_selected_id] = useState<string | null>(null);
  const [toast, set_toast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [media_error, set_media_error] = useState("");

  const show_toast = useCallback((type: "success" | "error", msg: string) => {
    if (type === "error") {
      showError(msg);
      return;
    }
    set_toast({ type, msg });
    setTimeout(() => set_toast(null), 3000);
  }, [showError]);

  // Create / Edit form
  const [is_creating, set_is_creating] = useState(true);
  const [content_type, set_content_type] = useState<"video" | "image_text">("video");
  const [title, set_title] = useState("");
  const [description, set_description] = useState("");
  const [tags, set_tags] = useState("");
  const [video_file, set_video_file] = useState<File | null>(null);
  const [image_files, set_image_files] = useState<File[]>([]);
  const [is_public, set_is_public] = useState(false);
  const [category, set_category] = useState<"agency" | "curated">("curated");
  const [source, set_source] = useState("");
  const [submitting, set_submitting] = useState(false);
  const [replacing_media, set_replacing_media] = useState(false);
  const [analyzing, set_analyzing] = useState<string | null>(null);
  const [error, set_error] = useState<string | null>(null);
  const [filter_text, set_filter_text] = useState("");
  const [sort_order, set_sort_order] = useState<"newest" | "oldest">("newest");

  useEffect(() => {
    if (error) showError(error);
  }, [error, showError]);
  const video_input_ref = useRef<HTMLInputElement>(null);
  const image_input_ref = useRef<HTMLInputElement>(null);

  // Auth guard
  useEffect(() => {
    if (!auth_loading && !user) {
      router.replace("/");
    }
  }, [user, auth_loading, router]);

  const load_cases = useCallback(async () => {
    try {
      if (is_admin) {
        const res = await fetch_admin_cases();
        set_cases(res.data as CaseItem[]);
      } else {
        const res = await fetch_my_cases();
        const data = res.data as { cases: CaseItem[]; favorite_ids: string[] };
        set_cases(data.cases || []);
      }
    } catch {
      // silently fail
    } finally {
      set_loading(false);
    }
  }, [is_admin]);

  useEffect(() => {
    if (user) load_cases();
  }, [user, load_cases]);

  const filtered_cases = useMemo(() => {
    let result = [...cases];
    if (filter_text.trim()) {
      const kw = filter_text.trim().toLowerCase();
      result = result.filter((c) =>
        c.title.toLowerCase().includes(kw) ||
        (c.description || "").toLowerCase().includes(kw) ||
        c.tags.some((t) => t.toLowerCase().includes(kw))
      );
    }
    result.sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sort_order === "newest" ? tb - ta : ta - tb;
    });
    return result;
  }, [cases, filter_text, sort_order]);

  // Auto-poll while any case is analyzing
  useEffect(() => {
    const has_analyzing = cases.some((c) => c.ai_status === "analyzing");
    if (!has_analyzing) return;
    const interval = setInterval(() => { load_cases(); }, 3000);
    return () => clearInterval(interval);
  }, [cases, load_cases]);

  const selected_case = cases.find((c) => c.id === selected_id) || null;

  const select_case = (c: CaseItem) => {
    set_selected_id(c.id);
    set_is_creating(false);
    set_content_type(c.content_type as "video" | "image_text");
    set_title(c.title);
    set_description(c.description);
    set_tags(c.tags.join(", "));
    set_is_public(c.is_public);
    set_category(c.category as "agency" | "curated");
    set_source(c.source || "");
    set_video_file(null);
    set_image_files([]);
    set_error(null);
  };

  const reset_form = () => {
    set_is_creating(true);
    set_selected_id(null);
    set_content_type("video");
    set_title("");
    set_description("");
    set_tags("");
    set_video_file(null);
    set_image_files([]);
    set_is_public(false);
    set_category("curated");
    set_source("");
    set_error(null);
  };

  const handle_submit = async () => {
    if (!title.trim()) { set_error(t("请输入标题", "Enter a title")); return; }
    set_submitting(true);
    set_error(null);

    try {
      const tag_list = tags.split(",").map((t) => t.trim()).filter(Boolean);

      const save_category = is_admin ? category : "curated";

      if (selected_id) {
        await update_case(selected_id, {
          title: title.trim(),
          description: description.trim(),
          tags: tag_list,
          category: save_category,
          source: source.trim(),
          ...(is_admin ? { is_public } : {}),
        });
        show_toast("success", t("案例已更新", "Case updated"));
      } else {
        if (content_type === "video") {
          if (!video_file) { set_error(t("请选择视频文件", "Select a video file")); set_submitting(false); return; }
          await create_video_case(title.trim(), description.trim(), tag_list, video_file, is_admin && is_public, save_category, source.trim());
        } else {
          if (image_files.length === 0) { set_error(t("请选择至少一张图片", "Select at least one image")); set_submitting(false); return; }
          await create_image_text_case(title.trim(), description.trim(), tag_list, image_files, is_admin && is_public, save_category, source.trim());
        }
        show_toast("success", t("案例已创建", "Case created"));
        reset_form();
      }
      load_cases();
    } catch (e) {
      set_error(e instanceof Error ? e.message : t("操作失败", "Operation failed"));
    } finally {
      set_submitting(false);
    }
  };

  const handle_delete = async (id: string) => {
    if (!window.confirm(t("确定删除此案例吗？", "Delete this case?"))) return;
    try {
      await delete_case(id);
      if (selected_id === id) reset_form();
      show_toast("success", t("案例已删除", "Case deleted"));
      load_cases();
    } catch (e) {
      show_toast("error", e instanceof Error ? e.message : t("删除失败", "Failed to delete"));
    }
  };

  const remove_image = (idx: number) => {
    set_image_files((prev) => prev.filter((_, i) => i !== idx));
  };

  const handle_analyze = async (id: string) => {
    set_analyzing(id);
    try {
      await analyze_case(id);
      show_toast("success", t("AI 分析已开始", "AI analysis started"));
      load_cases();
    } catch (e) {
      show_toast("error", e instanceof Error ? e.message : t("AI 分析失败", "AI analysis failed"));
    } finally {
      set_analyzing(null);
    }
  };

  const handle_replace_media = async () => {
    if (!selected_id) return;
    if (!video_file && image_files.length === 0) {
      set_error(t("请选择要替换的媒体文件", "Select replacement media files"));
      return;
    }
    set_replacing_media(true);
    set_error(null);
    try {
      await replace_case_media(
        selected_id,
        content_type === "video" ? video_file : null,
        content_type === "image_text" ? image_files : [],
      );
      set_video_file(null);
      set_image_files([]);
      show_toast("success", t("媒体已替换", "Media replaced"));
      load_cases();
    } catch (e) {
      set_error(e instanceof Error ? e.message : t("替换媒体失败", "Failed to replace media"));
    } finally {
      set_replacing_media(false);
    }
  };

  if (auth_loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-950">
        <svg role="status" aria-label={t("加载中...", "Loading...")} className="w-8 h-8 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      {/* Toast */}
      {toast && (
        <div className="fixed top-16 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium"
          style={{ background: toast.type === "success" ? "#ecfdf5" : "#fef2f2", color: toast.type === "success" ? "#065f46" : "#991b1b" }}>
          {toast.msg}
          <button onClick={() => set_toast(null)} className="opacity-60 hover:opacity-100 ml-1 cursor-pointer">{t("关闭", "Close")}</button>
        </div>
      )}

      {/* Left: Case list */}
      <div className="w-56 lg:w-72 xl:w-80 border-r border-zinc-200 dark:border-zinc-800 flex flex-col shrink-0">
        <div className="p-3 lg:p-4 border-b border-zinc-200 dark:border-zinc-800 space-y-3">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 font-heading">
            {is_admin ? t("案例列表", "Cases") : t("我的案例", "My cases")}
          </h2>
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={filter_text}
              onChange={(e) => set_filter_text(e.target.value)}
              placeholder={t("搜索关键词...", "Search keywords...")}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition-all"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => set_sort_order("newest")}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                sort_order === "newest"
                  ? "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {t("最新", "Newest")}
            </button>
            <button
              onClick={() => set_sort_order("oldest")}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                sort_order === "oldest"
                  ? "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {t("最早", "Oldest")}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="animate-pulse space-y-1.5">
                  <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4" />
                  <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : cases.length === 0 ? (
            <div className="p-4 text-center text-sm text-zinc-400">{t("暂无案例", "No cases yet")}</div>
          ) : filtered_cases.length === 0 ? (
            <div className="p-4 text-center text-sm text-zinc-400">{t("无匹配案例", "No matching cases")}</div>
          ) : (
            filtered_cases.map((c) => (
              <div
                key={c.id}
                onClick={() => select_case(c)}
                className={`p-2 lg:p-3 border-b border-zinc-100 dark:border-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${
                  selected_id === c.id ? "bg-amber-50 dark:bg-amber-950/30 border-l-2 border-l-amber-500" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{c.title}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {c.content_type === "video" ? t("短视频", "Short video") : t("图文", "Image post")}
                      {" · "}
                      <span className={c.is_public ? "text-emerald-500" : "text-amber-500"}>
                        {c.is_public ? t("公开", "Public") : t("个人", "Private")}
                      </span>
                      {c.ai_status === "analyzing" && (
                        <span className="ml-1 text-indigo-500"> {t("/ AI 分析中", "/ AI analyzing")}</span>
                      )}
                      {c.ai_status === "completed" && (
                        <span className="ml-1 text-emerald-500"> {t("/ AI 已分析", "/ AI analyzed")}</span>
                      )}
                      {c.ai_status === "failed" && (
                        <span className="ml-1 text-red-400"> {t("/ AI 分析失败", "/ AI analysis failed")}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: Form */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => {
                if (!is_creating && selected_case) {
                  reset_form();
                } else {
                  router.push("/case_library");
                }
              }}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors cursor-pointer"
              title={t("返回案例库", "Back to Case Library")}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white font-heading">
              {is_creating ? t("新建案例", "New case") : selected_case ? t("编辑: {title}", "Edit: {title}", { title: selected_case.title }) : t("选择一个案例或创建新案例", "Select a case or create a new one")}
            </h2>
          </div>

          {(is_creating || selected_case) ? (
            <>
              {/* Content type toggle (create mode only) */}
              {is_creating && (
                <div className="mb-5">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t("案例类型", "Case type")}</label>
                  <div className="flex gap-2">
                    {(["video", "image_text"] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => set_content_type(type)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                          content_type === type
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {type === "video" ? t("短视频", "Short video") : t("图文", "Image post")}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Category selector (admin only) */}
              {is_admin && (
                <div className="mb-5">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t("上传到", "Add to")}</label>
                  <div className="flex gap-2">
                    {(["curated", "agency"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => set_category(c)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                          category === c
                            ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {c === "agency" ? t("企业定制", "Agency cases") : t("行业精选", "Curated cases")}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Title */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t("标题", "Title")} <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => set_title(e.target.value)}
                  placeholder={t("案例标题", "Case title")}
                  className="w-full px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                />
              </div>

              {/* Description */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t("描述", "Description")}</label>
                <textarea
                  value={description}
                  onChange={(e) => set_description(e.target.value)}
                  placeholder={t("案例描述...", "Case description...")}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 resize-none"
                />
              </div>

              {/* Tags */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t("标签（逗号分隔）", "Tags (comma-separated)")}</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => set_tags(e.target.value)}
                  placeholder={t("例如：产品演示, SaaS, B2B", "e.g. Product demo, SaaS, B2B")}
                  className="w-full px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                />
              </div>

              {/* Source */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t("来源平台（可选）", "Source platform (optional)")}</label>
                <div className="flex gap-2 flex-wrap">
                  {["抖音", "小红书", "视频号", "微信", "B站", "微博", "快手", "其他"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => set_source(source === s ? "" : s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        source === s
                          ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 ring-1 ring-sky-300"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {casePlatformLabel(s, t)}
                    </button>
                  ))}
                </div>
              </div>

              {/* File upload (create mode only) */}
              {is_creating ? (
                content_type === "video" ? (
                  <div className="mb-5">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t("视频文件 (MP4)", "Video file (MP4)")} <span className="text-red-500">*</span></label>
                    <div
                      onClick={() => video_input_ref.current?.click()}
                      className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-8 text-center cursor-pointer hover:border-amber-400 dark:hover:border-amber-600 transition-colors"
                    >
                      {video_file ? (
                        <p className="text-sm text-amber-600 dark:text-amber-400">{video_file.name} ({(video_file.size / 1024 / 1024).toFixed(1)} MB)</p>
                      ) : (
                        <p className="text-sm text-zinc-400">{t("点击选择 MP4 视频文件", "Click to select an MP4 video file")} <span className="text-red-500">*</span></p>
                      )}
                      <input ref={video_input_ref} type="file" accept=".mp4,video/mp4" className="hidden"
                        onChange={(e) => {
                          set_media_error("");
                          const f = e.target.files?.[0];
                          if (!f) return;
                          if (f.size > MAX_VIDEO_BYTES) {
                            set_media_error(t("视频过大（{size}MB），最大支持 {max}MB", "Video too large ({size} MB). Maximum: {max} MB.", { size: (f.size / 1024 / 1024).toFixed(1), max: MAX_VIDEO_MB }));
                            return;
                          }
                          set_video_file(f);
                        }} />
                      {media_error && (
                        <p className="mt-2 text-xs text-red-500 dark:text-red-400 font-medium">{media_error}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mb-5">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t("图片文件 (JPG/PNG/GIF/WebP)", "Image files (JPG/PNG/GIF/WebP)")} <span className="text-red-500">*</span></label>
                    <div
                      onClick={() => image_input_ref.current?.click()}
                      className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-8 text-center cursor-pointer hover:border-amber-400 dark:hover:border-amber-600 transition-colors"
                    >
                      <p className="text-sm text-zinc-400">{t("点击选择图片文件（可多选）", "Click to select images (multiple files allowed)")}<span className="text-red-500">*</span></p>
                      <input ref={image_input_ref} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" multiple className="hidden"
                        onChange={(e) => {
                          set_media_error("");
                          const files = Array.from(e.target.files || []);
                          if (!files.length) return;
                          const oversized = files.find(f => f.size > MAX_IMAGE_BYTES);
                          if (oversized) {
                            set_media_error(t("图片过大（{size}MB），单张最大支持 {max}MB", "Image too large ({size} MB). Maximum per image: {max} MB.", { size: (oversized.size / 1024 / 1024).toFixed(1), max: MAX_IMAGE_MB }));
                            return;
                          }
                          set_image_files((prev) => [...prev, ...files]);
                        }} />
                      {media_error && (
                        <p className="mt-2 text-xs text-red-500 dark:text-red-400 font-medium">{media_error}</p>
                      )}
                    </div>
                    {image_files.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {image_files.map((f, i) => (
                          <div key={i} className="relative group w-20 h-20 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                            <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                            <button aria-label={t("移除图片：{name}", "Remove image: {name}", { name: f.name })} onClick={() => remove_image(i)}
                              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              ) : selected_case && (
                <div className="mb-5 p-4 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 space-y-3">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {t("类型:", "Type:")} {selected_case.content_type === "video" ? t("短视频", "Short video") : t("图文", "Image post")}
                  </p>
                  {selected_case.content_type === "video" && selected_case.video_url && (
                    <div>
                      <p className="text-xs text-zinc-500 mb-1.5">{t("当前视频", "Current video")}</p>
                      <video src={media_url(selected_case.video_url)} controls className="w-full max-w-md rounded-lg border border-zinc-200 dark:border-zinc-700" preload="metadata" />
                    </div>
                  )}
                  {selected_case.content_type === "image_text" && selected_case.image_urls.length > 0 && (
                    <div>
                      <p className="text-xs text-zinc-500 mb-1.5">{t("当前图片（{count} 张）", "Current images ({count})", { count: selected_case.image_urls.length })}</p>
                      <div className="flex flex-wrap gap-2">
                        {selected_case.image_urls.map((url, i) => (
                          <a key={i} href={media_url(url)} target="_blank" rel="noopener noreferrer">
                            <img src={media_url(url)} alt={t("图片 {number}", "Image {number}", { number: i + 1 })} className="w-20 h-20 object-cover rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-amber-400 transition-colors" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected_case.content_type === "image_text" && selected_case.image_urls.length === 0 && (
                    <p className="text-sm text-zinc-400 italic">{t("暂无图片", "No images")}</p>
                  )}
                  {selected_case.content_type === "video" && !selected_case.video_url && (
                    <p className="text-sm text-zinc-400 italic">{t("暂无视频", "No video")}</p>
                  )}
                  {selected_case.content_type === "video" ? (
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t("替换视频 (MP4)", "Replace video (MP4)")}</label>
                      <div
                        onClick={() => video_input_ref.current?.click()}
                        className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-6 text-center cursor-pointer hover:border-amber-400 dark:hover:border-amber-600 transition-colors"
                      >
                        {video_file ? (
                          <p className="text-sm text-amber-600 dark:text-amber-400">{video_file.name} ({(video_file.size / 1024 / 1024).toFixed(1)} MB)</p>
                        ) : (
                          <p className="text-sm text-zinc-400">{t("点击选择新视频文件", "Click to select a new video file")}</p>
                        )}
                        <input ref={video_input_ref} type="file" accept=".mp4,video/mp4" className="hidden"
                          onChange={(e) => {
                            set_media_error("");
                            const f = e.target.files?.[0];
                            if (!f) return;
                            if (f.size > MAX_VIDEO_BYTES) {
                              set_media_error(t("视频过大（{size}MB），最大支持 {max}MB", "Video too large ({size} MB). Maximum: {max} MB.", { size: (f.size / 1024 / 1024).toFixed(1), max: MAX_VIDEO_MB }));
                              return;
                            }
                            set_video_file(f);
                          }} />
                        {media_error && (
                          <p className="mt-2 text-xs text-red-500 dark:text-red-400 font-medium">{media_error}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t("替换图片 (JPG/PNG/GIF/WebP)", "Replace images (JPG/PNG/GIF/WebP)")}</label>
                      <div
                        onClick={() => image_input_ref.current?.click()}
                        className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-6 text-center cursor-pointer hover:border-amber-400 dark:hover:border-amber-600 transition-colors"
                      >
                        <p className="text-sm text-zinc-400">{t("点击选择图片文件（可多选）", "Click to select images (multiple files allowed)")}</p>
                        <input ref={image_input_ref} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" multiple className="hidden"
                          onChange={(e) => {
                            set_media_error("");
                            const files = Array.from(e.target.files || []);
                            if (!files.length) return;
                            const oversized = files.find(f => f.size > MAX_IMAGE_BYTES);
                            if (oversized) {
                              set_media_error(t("图片过大（{size}MB），单张最大支持 {max}MB", "Image too large ({size} MB). Maximum per image: {max} MB.", { size: (oversized.size / 1024 / 1024).toFixed(1), max: MAX_IMAGE_MB }));
                              return;
                            }
                            set_image_files((prev) => [...prev, ...files]);
                          }} />
                        {media_error && (
                          <p className="mt-2 text-xs text-red-500 dark:text-red-400 font-medium">{media_error}</p>
                        )}
                      </div>
                      {image_files.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {image_files.map((f, i) => (
                            <div key={i} className="relative group w-20 h-20 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                              <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                              <button aria-label={t("移除图片：{name}", "Remove image: {name}", { name: f.name })} onClick={() => remove_image(i)}
                                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">×</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={handle_replace_media}
                    disabled={replacing_media || (!video_file && image_files.length === 0)}
                    className="px-4 py-2 rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 text-sm font-medium enabled:hover:bg-indigo-200 dark:enabled:hover:bg-indigo-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {replacing_media ? t("替换中...", "Replacing...") : t("替换媒体", "Replace media")}
                  </button>
                </div>
              )}

              {/* AI Analysis (edit mode only) */}
              {!is_creating && selected_case && (
                <div className="mb-5 p-4 rounded-xl bg-zinc-100 dark:bg-zinc-800/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("AI 分析", "AI analysis")}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {selected_case.ai_status === "analyzing" && t("AI 正在分析此案例...", "AI is analyzing this case...")}
                        {selected_case.ai_status === "completed" && t("AI 分析已完成", "AI analysis complete")}
                        {selected_case.ai_status === "failed" && t("上次 AI 分析失败，可重新分析", "The last AI analysis failed. You can try again.")}
                        {!selected_case.ai_status && t("使用 AI 分析此案例的营销策略与效果", "Use AI to analyze this case’s marketing strategy and performance.")}
                      </p>
                    </div>
                    <button
                      onClick={() => handle_analyze(selected_case.id)}
                      disabled={analyzing === selected_case.id || selected_case.ai_status === "analyzing"}
                      className="amp-button amp-button-primary shrink-0 cursor-pointer"
                    >
                      {analyzing === selected_case.id
                        ? t("启动中...", "Starting...")
                        : selected_case.ai_status === "completed"
                        ? t("重新分析", "Analyze again")
                        : selected_case.ai_status === "analyzing"
                        ? t("AI 分析中...", "AI analysis in progress...")
                        : t("AI 分析", "AI analysis")}
                    </button>
                  </div>
                  {selected_case.ai_analysis && (
                    <div className="mt-3 space-y-2">
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        <span className="font-medium">{t("内容解析：", "Content analysis:")}</span>{selected_case.ai_analysis.content_analysis}
                      </div>
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        <span className="font-medium">{t("营销角度：", "Marketing angle:")}</span>{selected_case.ai_analysis.marketing_angle}
                      </div>
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        <span className="font-medium">{t("目标受众：", "Target audience:")}</span>{selected_case.ai_analysis.target_audience}
                      </div>
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        <span className="font-medium">{t("经验借鉴：", "Lessons learned:")}</span>{selected_case.ai_analysis.experience_extraction}
                      </div>
                      {selected_case.ai_analysis.key_highlights.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {selected_case.ai_analysis.key_highlights.map((h, i) => (
                            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">{h}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Public toggle (admin in edit mode, or admin in create mode) */}
              {is_admin && (
                <div className="mb-5 flex items-center gap-3">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("公开状态", "Visibility")}</label>
                  <button
                    onClick={() => set_is_public(!is_public)}
                    aria-label={t("公开状态", "Visibility")}
                    aria-pressed={is_public}
                    className={`relative w-10 h-6 rounded-full transition-colors cursor-pointer ${is_public ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${is_public ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                  <span className={`text-sm ${is_public ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}`}>
                    {is_public ? t("公开", "Public") : t("个人", "Private")}
                  </span>
                </div>
              )}

              {!is_admin && (
                <div className="mb-5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 text-sm text-amber-700 dark:text-amber-400">
                  {t("普通用户创建的案例仅自己可见。如需要公开案例，请联系管理员。", "Cases created by regular users are private. Contact an administrator to make a case public.")}
                </div>
              )}

              {/* Submit */}
              {!is_creating ? (
                (() => {
                  const original_tags = selected_case?.tags.join(", ") || "";
                  const current_tags = tags;
                  const has_changes =
                    title !== (selected_case?.title || "") ||
                    description !== (selected_case?.description || "") ||
                    current_tags !== original_tags ||
                    category !== (selected_case?.category || "curated") ||
                    source !== (selected_case?.source || "") ||
                    (is_admin && is_public !== (selected_case?.is_public || false));
                  const save_disabled = submitting || !title.trim() || !has_changes;

                  return (
                    <div className="flex gap-3">
                      <button
                        onClick={handle_submit}
                        disabled={save_disabled}
                        className="amp-button amp-button-primary cursor-pointer"
                      >
                        {submitting ? t("提交中...", "Submitting...") : t("保存修改", "Save changes")}
                      </button>
                      <button
                        onClick={reset_form}
                        className="min-h-[44px] px-6 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
                      >
                        {t("取消", "Cancel")}
                      </button>
                      {selected_id && (
                        <button
                          onClick={() => handle_delete(selected_id)}
                          className="min-h-[44px] px-6 py-2.5 rounded-xl border border-red-200 dark:border-red-800/50 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                        >
                          {t("删除案例", "Delete case")}
                        </button>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={handle_submit}
                    disabled={submitting || !title.trim() || (content_type === "video" && !video_file) || (content_type === "image_text" && image_files.length === 0)}
                    className="amp-button amp-button-primary cursor-pointer"
                  >
                    {submitting ? t("提交中...", "Submitting...") : t("创建案例", "Create case")}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-16">
              <svg className="w-16 h-16 mx-auto text-zinc-300 dark:text-zinc-700 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <p className="text-zinc-500 dark:text-zinc-400 mb-6">{t("从左侧列表选择一个案例进行编辑，或点击新建创建新案例", "Select a case from the list on the left to edit, or click New case to create one.")}</p>
              <button
                onClick={reset_form}
                className="amp-button amp-button-primary cursor-pointer"
              >
                {t("新建案例", "New case")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
