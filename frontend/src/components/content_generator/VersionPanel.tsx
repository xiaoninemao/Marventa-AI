"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/contexts/i18n_context";
import type { Translate, TranslationValues } from "@/i18n/locale";
import { fetch_versions, restore_version } from "@/services/api_client";
import type { ContentVersion, ContentCard } from "@/types/content_generator";

type Feedback = string | { zh: string; en: string; values?: TranslationValues };

const get_card_meta = (t: Translate): Record<string, { label: string; tone: string }> => ({
  script: { label: t("脚本", "Script"), tone: "bg-slate-900" },
  title: { label: t("标题", "Title"), tone: "bg-slate-700" },
  copy: { label: t("文案", "Copy"), tone: "bg-blue-900" },
  hashtags: { label: t("话题", "Hashtags"), tone: "bg-cyan-900" },
  visual: { label: t("视觉", "Visuals"), tone: "bg-slate-800" },
});

interface Props {
  open: boolean;
  session_id: string;
  current_cards: ContentCard[];
  refresh_key: number;
  onRestore: (cards: ContentCard[], version_label: string) => void;
  onClose: () => void;
}

export default function VersionPanel({
  open, session_id, current_cards, refresh_key, onRestore, onClose,
}: Props) {
  const { t } = useI18n();
  const CARD_META = get_card_meta(t);
  const [versions, set_versions] = useState<ContentVersion[]>([]);
  const [loading, set_loading] = useState(false);
  const [selected_id, set_selected_id] = useState<string | null>(null);
  const [restoring, set_restoring] = useState(false);
  const [confirm_restore, set_confirm_restore] = useState<string | null>(null);
  const [toast, set_toast] = useState<Feedback | null>(null);

  const show_toast = useCallback((msg: Feedback) => {
    set_toast(msg);
    setTimeout(() => set_toast(null), 2000);
  }, []);

  useEffect(() => {
    if (!open || !session_id) return;
    set_loading(true);
    fetch_versions(session_id)
      .then((res) => {
        const data = (res.data || []) as ContentVersion[];
        set_versions(data);
        if (data.length > 0) {
          const last = data[data.length - 1];
          const match = data.find(
            (v) => v.major === last.major && v.minor === last.minor
          );
          set_selected_id(match?.id || last.id);
        }
      })
      .catch(() => set_versions([]))
      .finally(() => set_loading(false));
  }, [open, session_id, refresh_key]);

  const timeline_ref = useRef<HTMLDivElement>(null);
  const selected = versions.find((v) => v.id === selected_id) || null;

  useEffect(() => {
    if (!timeline_ref.current || !selected_id) return;
    const el = timeline_ref.current.querySelector(`[data-version-id="${selected_id}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selected_id, versions.length]);

  const latest = versions.length > 0 ? versions[versions.length - 1] : null;
  const is_current = selected && latest
    ? selected.major === latest.major && selected.minor === latest.minor
    : false;

  const display_cards = (() => {
    if (!selected) return [];
    if (selected.minor === 0) return selected.cards;
    const idx = versions.findIndex((v) => v.id === selected.id);
    const prev = idx > 0 ? versions[idx - 1] : null;
    if (!prev) return selected.cards;
    return selected.cards.filter((card) => {
      const prev_card = prev.cards.find((c) => c.id === card.id);
      if (!prev_card) return true;
      return (
        card.title !== prev_card.title ||
        card.preview !== prev_card.preview ||
        card.content !== prev_card.content ||
        JSON.stringify(card.tips) !== JSON.stringify(prev_card.tips)
      );
    });
  })();

  const handle_restore = async () => {
    if (!selected || restoring) return;
    if (confirm_restore !== selected.id) {
      set_confirm_restore(selected.id);
      return;
    }
    set_restoring(true);
    try {
      const res = await restore_version(session_id, selected.id);
      if (res.success) {
        const new_version = res.data.version as ContentVersion;
        onRestore(new_version.cards, `v${selected.major}.${selected.minor}`);
        show_toast({ zh: "已恢复到 {version}", en: "Restored to {version}", values: { version: selected.version_label } });
        set_versions((prev) => [...prev, new_version]);
        set_selected_id(new_version.id);
      } else {
        show_toast({ zh: "恢复失败", en: "Could not restore the version" });
      }
    } catch {
      show_toast({ zh: "恢复失败", en: "Could not restore the version" });
    } finally {
      set_restoring(false);
      set_confirm_restore(null);
    }
  };

  const jump_to_latest = () => {
    if (latest) {
      set_selected_id(latest.id);
      set_confirm_restore(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-xl">
          {typeof toast === "string" ? toast : t(toast.zh, toast.en, toast.values)}
        </div>
      )}

      <div className="relative w-96 max-w-[92vw] h-full bg-white dark:bg-zinc-950 shadow-2xl border-l border-zinc-200 dark:border-zinc-800 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">{t("版本历史", "Version history")}</h2>
          <button
            onClick={onClose}
            aria-label={t("关闭", "Close")}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <svg className="w-6 h-6 animate-spin text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : versions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
            {t("暂无版本记录", "No version history yet")}
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Timeline */}
            <div className="w-20 shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
              <button
                onClick={jump_to_latest}
                disabled={is_current}
                className="shrink-0 mx-2 mt-3 mb-1 py-1 rounded-lg text-[10px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer text-center"
              >
                {t("跳至最新", "Jump to latest")}
              </button>
              <div ref={timeline_ref} className="flex-1 overflow-y-auto py-1 relative">
                <div
                  className="absolute w-0.5 bg-zinc-200 dark:bg-zinc-700 inset-y-0"
                  style={{ left: "50%", transform: "translateX(-50%)" }}
                />
                <div className="relative flex flex-col items-center">
                  {versions.map((v) => {
                    const is_major = v.minor === 0;
                    const is_sel = v.id === selected_id;

                    return (
                      <button
                        key={v.id}
                        data-version-id={v.id}
                        onClick={() => {
                          set_selected_id(v.id);
                          set_confirm_restore(null);
                        }}
                        className={`relative z-10 flex items-center cursor-pointer w-full ${
                          is_major ? "py-2.5" : "py-1"
                        }`}
                      >
                        {/* Spacer to align dot center with the 40px line */}
                        <div className="shrink-0" style={{ width: is_major ? "33px" : "36px" }} />
                        <div
                          className={`rounded-full transition-all shrink-0 ${
                            is_major ? "w-3.5 h-3.5" : "w-2 h-2"
                          } ${
                            is_sel
                              ? "bg-amber-200 ring-2 ring-amber-100 dark:bg-amber-700/80 dark:ring-amber-600/50"
                              : is_major
                                ? "bg-slate-500 dark:bg-slate-400"
                                : "bg-zinc-400 dark:bg-zinc-500"
                          }`}
                        />
                        <span
                          className={`text-[10px] font-medium ml-1.5 ${
                            is_sel
                              ? "text-slate-800 dark:text-amber-200"
                              : "text-zinc-500 dark:text-zinc-400"
                          } ${is_major ? "font-semibold" : ""}`}
                        >
                          {v.version_label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: Version detail */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {selected ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        selected.minor === 0
                          ? "bg-amber-50 text-slate-800 dark:bg-amber-900/30 dark:text-amber-100"
                          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}>
                        {selected.version_label}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        {selected.minor === 0 ? t("完整生成", "Full generation") : t("卡片修改", "Card edit")}
                      </span>
                    </div>
                    {display_cards.length === 0 && selected.minor > 0 && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center py-4">
                        {t("此版本卡片与上一版本一致", "The cards in this version are unchanged from the previous version.")}
                      </p>
                    )}
                    {display_cards.map((card) => {
                      const meta = CARD_META[card.card_type] || CARD_META.script;
                      return (
                        <div
                          key={card.id}
                          className="rounded-xl bg-zinc-50/90 dark:bg-zinc-900/60 p-3 shadow-sm shadow-slate-900/5 ring-1 ring-white/50 dark:ring-white/10"
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className={`w-5 h-5 rounded-md ${meta.tone} flex items-center justify-center shadow-sm shadow-slate-900/10`}>
                              <span className="text-[9px] text-white font-semibold">{meta.label.slice(0, 1)}</span>
                            </div>
                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                              {card.title}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-2">
                            {card.preview}
                          </p>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <div className="text-center text-sm text-zinc-400 dark:text-zinc-500 mt-8">
                    {t("选择一个版本查看详情", "Select a version to view details")}
                  </div>
                )}
              </div>

              {/* Restore footer */}
              {selected && (
                <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0 space-y-2">
                  {confirm_restore === selected.id && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                      {t("确认恢复到 {version}？当前修改将丢失。", "Restore {version}? Your current changes will be lost.", { version: selected.version_label })}
                    </p>
                  )}
                  <button
                    onClick={handle_restore}
                    disabled={restoring || is_current}
                    className={`w-full py-2 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                      is_current
                        ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed"
                        : confirm_restore === selected.id
                          ? "bg-amber-500 text-white hover:bg-amber-600"
                          : "bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                    </svg>
                    {restoring
                      ? t("恢复中...", "Restoring...")
                      : is_current
                        ? t("当前版本", "Current version")
                        : confirm_restore === selected.id
                          ? t("确认恢复到 {version}", "Confirm restore to {version}", { version: selected.version_label })
                          : t("恢复到此版本", "Restore this version")}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
