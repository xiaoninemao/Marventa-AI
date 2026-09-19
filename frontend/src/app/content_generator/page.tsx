"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage, ContentCard, SessionRecord } from "@/types/content_generator";
import {
  create_session, fetch_sessions, fetch_session,
  send_chat_message, generate_cards, delete_session,
  set_session_references, modify_card, generate_document,
  create_publish_task, save_content_project,
} from "@/services/api_client";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import type { Translate, TranslationValues } from "@/i18n/locale";
import ReferencePanel, { type RefLabel } from "@/components/content_generator/ReferencePanel";
import VersionPanel from "@/components/content_generator/VersionPanel";
import { getContentPreviewItems } from "./preview_parser";

type Feedback = string | { zh: string; en: string; values?: TranslationValues };

const ACTIVE_SESSION_STORAGE_KEY = "amp-content-generator-active-session-v1";
const PENDING_DOCUMENTS_STORAGE_KEY = "amp-content-generator-pending-documents-v1";

function add_pending_document_session(session_id: string) {
  try {
    const raw = window.localStorage.getItem(PENDING_DOCUMENTS_STORAGE_KEY);
    const pending = raw ? JSON.parse(raw) as string[] : [];
    if (!pending.includes(session_id)) {
      window.localStorage.setItem(PENDING_DOCUMENTS_STORAGE_KEY, JSON.stringify([...pending, session_id]));
    }
  } catch {
    window.localStorage.setItem(PENDING_DOCUMENTS_STORAGE_KEY, JSON.stringify([session_id]));
  }
}

function remove_pending_document_session(session_id: string) {
  try {
    const raw = window.localStorage.getItem(PENDING_DOCUMENTS_STORAGE_KEY);
    const pending = raw ? JSON.parse(raw) as string[] : [];
    const next = pending.filter((id) => id !== session_id);
    if (next.length > 0) {
      window.localStorage.setItem(PENDING_DOCUMENTS_STORAGE_KEY, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(PENDING_DOCUMENTS_STORAGE_KEY);
    }
  } catch {
    window.localStorage.removeItem(PENDING_DOCUMENTS_STORAGE_KEY);
  }
}

// ── Card metadata ──

const get_card_meta = (t: Translate): Record<string, { icon: React.ReactNode; label: string; tone: string }> => ({
  script: {
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25M3.375 4.5h17.25m-12.75 0v15m8.25-15v15M5.625 7.5h.008v.008H5.625V7.5zm0 3h.008v.008H5.625V10.5zm0 3h.008v.008H5.625V13.5z" /></svg>,
    label: t("脚本", "Script"),
    tone: "bg-slate-900",
  },
  title: {
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" /></svg>,
    label: t("标题", "Title"),
    tone: "bg-slate-700",
  },
  copy: {
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>,
    label: t("文案", "Copy"),
    tone: "bg-blue-900",
  },
  hashtags: {
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5" /></svg>,
    label: t("话题", "Hashtags"),
    tone: "bg-cyan-900",
  },
  visual: {
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    label: t("视觉", "Visuals"),
    tone: "bg-slate-800",
  },
});

type DetailProfile = {
  format: string;
  core: string;
  platforms: string;
  tone: string;
  labels: string[];
};

const get_card_detail_profile = (t: Translate): Record<ContentCard["card_type"], DetailProfile> => ({
  title: {
    format: t("图文方案", "Image post plan"),
    core: t("痛点切入 → 卖点承接 → 信任建立 → 行动号召", "Pain point → Selling point → Build trust → Call to action"),
    platforms: t("小红书、公众号、微博、抖音图文", "Xiaohongshu, WeChat Official Accounts, Weibo, Douyin image posts"),
    tone: t("真诚自然、利益明确、轻转化导向", "Authentic and natural, clear benefits, gentle conversion focus"),
    labels: [t("痛点切入", "Pain point"), t("卖点突出", "Key selling points"), t("效果对比", "Results comparison"), t("信任背书", "Trust signals"), t("行动号召", "Call to action"), t("记忆强化", "Reinforce recall")],
  },
  script: {
    format: t("视频方案", "Video plan"),
    core: t("开场钩子 → 分镜推进 → 字幕文案 → 产品露出 → 行动号召", "Opening hook → Storyboard → Captions → Product placement → Call to action"),
    platforms: t("抖音、小红书、视频号、快手", "Douyin, Xiaohongshu, WeChat Channels, Kuaishou"),
    tone: t("节奏清晰、画面感强、口语化转化", "Clear pacing, vivid imagery, conversational conversion"),
    labels: [t("开场钩子", "Opening hook"), t("分镜内容", "Storyboard"), t("字幕文案", "Caption copy"), t("卖点突出", "Key selling points"), t("信任背书", "Trust signals"), t("行动号召", "Call to action")],
  },
  copy: {
    format: t("图文方案", "Image post plan"),
    core: t("用户场景 → 问题放大 → 方案说明 → 体验证明 → 转化提示", "User scenario → Highlight the problem → Explain the solution → Show results → Conversion prompt"),
    platforms: t("小红书、公众号、微博", "Xiaohongshu, WeChat Official Accounts, Weibo"),
    tone: t("专业可信、细节充分、适合阅读停留", "Professional and credible, detailed, designed for engaged reading"),
    labels: [t("场景铺垫", "Set the scene"), t("痛点切入", "Pain point"), t("成分安心", "Ingredient reassurance"), t("效果对比", "Results comparison"), t("信任背书", "Trust signals"), t("行动号召", "Call to action")],
  },
  hashtags: {
    format: t("话题组合", "Hashtag set"),
    core: t("核心品类词 → 场景需求词 → 功效卖点词 → 人群转化词", "Core category → Scenario needs → Benefits → Audience conversion"),
    platforms: t("小红书、微博、抖音图文", "Xiaohongshu, Weibo, Douyin image posts"),
    tone: t("搜索友好、分类明确、兼顾曝光与转化", "Search-friendly, clearly categorized, balancing reach and conversion"),
    labels: [t("核心话题", "Core hashtags"), t("场景标签", "Scenario tags"), t("功效标签", "Benefit tags"), t("人群标签", "Audience tags"), t("平台适配", "Platform fit"), t("推荐理由", "Why we recommend it")],
  },
  visual: {
    format: t("封面视觉方案", "Cover visual plan"),
    core: t("第一视觉锚点 → 信息主标题 → 产品/场景证明 → 点击理由", "Visual focal point → Main headline → Product/scenario evidence → Reason to click"),
    platforms: t("小红书、抖音图文、公众号封面、微博", "Xiaohongshu, Douyin image posts, WeChat covers, Weibo"),
    tone: t("清爽正式、重点突出、便于快速识别", "Clean and professional, focused, easy to recognize"),
    labels: [t("视觉焦点", "Visual focus"), t("标题层级", "Title hierarchy"), t("卖点突出", "Key selling points"), t("效果对比", "Results comparison"), t("信任背书", "Trust signals"), t("行动号召", "Call to action")],
  },
});

function get_content_preview_items(card: ContentCard, t: Translate) {
  const CARD_DETAIL_PROFILE = get_card_detail_profile(t);
  const profile = CARD_DETAIL_PROFILE[card.card_type] || CARD_DETAIL_PROFILE.copy;
  const normalized = card.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^(\d+[\.\)、:：]|[-*•]\s*)\s*/, "").trim())
    .filter(Boolean);

  const lines = normalized.length > 1
    ? normalized
    : card.content
        .split(/(?<=[。！？!?])\s*/)
        .map((line) => line.trim())
        .filter(Boolean);

  const fallback_items = [card.preview, ...card.tips].filter(Boolean);
  const items = (lines.length > 0 ? lines : fallback_items).slice(0, 6);

  return items.map((text, index) => ({
    text,
    label: profile.labels[index % profile.labels.length],
  }));
}

function SelectedPlanDetailPanel({
  card,
  disabled,
  on_modify,
  on_copy,
  on_publish,
  on_save,
}: {
  card: ContentCard;
  disabled: boolean;
  on_modify: () => void;
  on_copy: () => void;
  on_publish: () => void;
  on_save: () => void;
}) {
  const { t } = useI18n();
  const CARD_META = get_card_meta(t);
  const CARD_DETAIL_PROFILE = get_card_detail_profile(t);
  const meta = CARD_META[card.card_type] || CARD_META.script;
  const profile = CARD_DETAIL_PROFILE[card.card_type] || CARD_DETAIL_PROFILE.copy;
  const preview_items = get_content_preview_items(card, t);
  const overview_rows = [
    { label: t("方案名称", "Plan name"), value: card.title },
    { label: t("内容形式", "Content format"), value: profile.format },
    { label: t("核心结构", "Core structure"), value: profile.core },
    { label: t("适用平台", "Recommended platforms"), value: profile.platforms },
    { label: t("推荐语气 / 风格", "Recommended tone / style"), value: profile.tone },
  ];

  return (
    <section
      aria-label={t("选中方案详情预览面板", "Selected plan preview")}
      className="rounded-2xl border border-zinc-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.07)]"
    >
      <div className="grid gap-0 lg:grid-cols-[0.92fr_1.55fr]">
        <div className="border-b border-zinc-200 p-5 lg:border-b-0 lg:border-r lg:p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700">
              {meta.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-500">{t("选中方案详情预览面板", "Selected plan preview")}</p>
              <h4 className="mt-1 truncate text-lg font-semibold text-zinc-950">{card.title}</h4>
            </div>
          </div>

          <div>
            <h5 className="mb-3 text-sm font-semibold text-zinc-900">{t("方案概况", "Plan overview")}</h5>
            <dl className="space-y-4">
              {overview_rows.map((row) => (
                <div key={row.label}>
                  <dt className="text-xs font-medium text-zinc-500">{row.label}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-zinc-800">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="p-5 lg:p-6">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-zinc-500">{t("当前卡片联动内容", "Content from the selected card")}</p>
              <h5 className="mt-1 text-sm font-semibold text-zinc-900">{t("详细内容预览", "Detailed preview")}</h5>
            </div>
            <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600">
              {meta.label}
            </span>
          </div>

          <ol className="space-y-2.5">
            {preview_items.map((item, index) => (
              <li
                key={`${index}-${item.text}`}
                className="grid grid-cols-[2.5rem_1fr_auto] items-start gap-3 rounded-xl border border-zinc-100 bg-zinc-50/70 px-3.5 py-3"
              >
                <span className="text-sm font-semibold tabular-nums text-amber-700">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="min-w-0 text-sm leading-relaxed text-zinc-800">{item.text}</p>
                <span className="ml-2 shrink-0 rounded-md bg-white px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-100">
                  {item.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50/80 px-5 py-4 lg:px-6">
        <button
          onClick={on_modify}
          disabled={disabled}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 0 0-3.09 3.091Z" />
          </svg>
          {t("AI 修改", "Edit with AI")}
        </button>
        <button
          onClick={on_copy}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v1.875A2.625 2.625 0 0 1 13.125 21.75h-7.5A2.625 2.625 0 0 1 3 19.125v-7.5A2.625 2.625 0 0 1 5.625 9H7.5m3.75-6.75h7.125A2.625 2.625 0 0 1 21 4.875v7.125a2.625 2.625 0 0 1-2.625 2.625H11.25A2.625 2.625 0 0 1 8.625 12V4.875A2.625 2.625 0 0 1 11.25 2.25Z" />
          </svg>
          {t("复制内容", "Copy content")}
        </button>
        <button
          onClick={on_publish}
          className="inline-flex min-h-10 items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700"
        >
          {t("选择版本并发布", "Select versions and publish")}
        </button>
        <button
          onClick={on_save}
          className="inline-flex min-h-10 items-center rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
        >
          {t("保存到内容项目库", "Save to Content Projects")}
        </button>
      </div>
    </section>
  );
}

// ── Flip Card (3D, for carousel) ──

function FlipCard3D({ card, is_active, flipped, on_flip }: { card: ContentCard; is_active: boolean; flipped: boolean; on_flip: () => void }) {
  const { t } = useI18n();
  const CARD_META = get_card_meta(t);
  const meta = CARD_META[card.card_type] || CARD_META.script;
  return (
    <div
      style={{
        width: 260,
        height: 350,
        perspective: "1000px",
      }}
    >
      <div
        onClick={() => is_active && on_flip()}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          transformStyle: "preserve-3d",
          transition: "transform 0.6s",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          cursor: is_active ? "pointer" : "default",
        }}
      >
        {/* Front face */}
        <div
          className={`rounded-xl ${meta.tone} text-white overflow-hidden shadow-lg shadow-slate-900/15 ring-1 ring-white/20 dark:ring-white/10`}
          style={{
            position: "absolute",
            inset: 0,
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
        >
          <div className="absolute top-0 right-0 w-28 h-28 bg-white/10 rounded-full -translate-y-12 translate-x-12 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-16 h-16 bg-white/10 rounded-full translate-y-6 -translate-x-4 pointer-events-none" />
          <div className="relative flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              {meta.icon}
            </div>
            <span className="text-xs font-medium bg-white/20 px-2.5 py-1 rounded-full">
              {meta.label}
            </span>
          </div>
          <div className="relative flex-1 flex flex-col justify-center">
            <h3 className="text-lg font-bold mb-2 font-heading line-clamp-2">{card.title}</h3>
            <p className="text-sm text-white/80 line-clamp-3 leading-relaxed">{card.preview}</p>
          </div>
          <div className="relative text-xs text-white/50 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            {is_active ? t("点击翻转查看要点", "Click to flip and view key points") : ""}
          </div>
        </div>

        {/* Back face — tips as bullet points */}
        <div
          className="rounded-2xl bg-white/90 dark:bg-zinc-900/90 overflow-hidden shadow-2xl shadow-slate-900/10 ring-1 ring-white/40 dark:ring-white/10 backdrop-blur-xl"
          style={{
            position: "absolute",
            inset: 0,
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <div className="flex items-center gap-2 mb-4 shrink-0">
            <div className={`w-8 h-8 rounded-lg ${meta.tone} flex items-center justify-center text-white`}>
              {meta.icon}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 block truncate">{card.title}</span>
              <span className="text-[10px] text-zinc-400">{t("{type} · 要点", "{type} · Key points", { type: meta.label })}</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2.5">
            {card.tips.length > 0 ? card.tips.map((t, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className={`shrink-0 w-5 h-5 rounded-full ${meta.tone} flex items-center justify-center mt-0.5`}>
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <span className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{t}</span>
              </div>
            )) : (
              <p className="text-sm text-zinc-400 text-center py-8">{t("暂无要点", "No key points yet")}</p>
            )}
          </div>
          <div className="text-[10px] text-zinc-400 text-center mt-3 shrink-0">
            {t("点击翻转回正面", "Click to flip back")}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Quick Chips ──

const CHIP_CATEGORIES = [
  {
    key: "format",
    label: "营销形式", label_en: "Content format",
    chips: [
      { key: "short_video", label: "短视频", label_en: "Short video" },
      { key: "image_text", label: "图文", label_en: "Image post" },
    ],
  },
  {
    key: "channel",
    label: "营销渠道", label_en: "Marketing channel",
    chips: [
      { key: "douyin", label: "抖音", label_en: "Douyin" },
      { key: "xiaohongshu", label: "小红书", label_en: "Xiaohongshu" },
      { key: "kuaishou", label: "快手", label_en: "Kuaishou" },
      { key: "weibo", label: "微博", label_en: "Weibo" },
      { key: "bilibili", label: "B站", label_en: "Bilibili" },
      { key: "wechat_mp", label: "公众号", label_en: "WeChat Official Accounts" },
      { key: "shipinhao", label: "视频号", label_en: "WeChat Channels" },
    ],
  },
  {
    key: "content",
    label: "营销内容", label_en: "Marketing content",
    chips: [
      { key: "marketing_copy", label: "营销文案", label_en: "Marketing copy" },
      { key: "product_intro", label: "产品介绍", label_en: "Product introduction" },
      { key: "brand_story", label: "品牌故事", label_en: "Brand story" },
    ],
  },
];

// ── Empty State ──

function EmptyState() {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex items-center justify-center bg-zinc-50/30 p-8 dark:bg-zinc-950/30">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 mx-auto mb-6 rounded-xl bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
          <svg className="w-10 h-10 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-2 font-heading">{t("开始智能创作", "Start creating in Content Studio")}</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {t("在左侧对话框中描述你的产品和内容需求，AI 将为你生成脚本、标题、文案、话题和视觉方案五组创意卡片。", "Describe your product and content needs in the chat on the left. AI will create five sets of creative cards: scripts, titles, copy, hashtags, and visual plans.")}
        </p>
      </div>
    </div>
  );
}

// ── Generating Skeleton ──

function GeneratingSkeleton() {
  const skeleton_tones = [
    "bg-slate-300/70",
    "bg-stone-300/70",
    "bg-blue-300/60",
    "bg-cyan-300/60",
    "bg-slate-300/70",
  ];
  return (
    <div className="flex-1 flex flex-col items-center bg-zinc-50/30 pt-8 lg:pt-12 px-2 lg:px-4 overflow-hidden dark:bg-zinc-950/30">
      {/* Header skeleton */}
      <div className="w-full max-w-3xl mb-3 px-2">
        <div className="h-6 w-40 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mb-2" />
        <div className="h-4 w-64 bg-zinc-100 dark:bg-zinc-800/50 rounded animate-pulse" />
      </div>

      {/* Card ring skeleton */}
      <div className="relative w-full max-w-3xl h-[28rem] flex items-center justify-center overflow-visible">
        {/* Left nav placeholder */}
        <div className="absolute left-0 z-40 w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />

        {/* 5 card skeletons in fan layout */}
        {skeleton_tones.map((tone, i) => {
          const raw_offset = ((i - 2) + 5) % 5;
          const offset = raw_offset > 2 ? raw_offset - 5 : raw_offset;
          const abs_offset = Math.abs(offset);
          const sign = Math.sign(offset) || 0;
          const scale = 1 - abs_offset * 0.18;
          const x = sign * (120 + abs_offset * 80);
          const rotateY = sign * (5 + abs_offset * 7);
          const z = 30 - abs_offset * 10;
          const opacity = 1 - abs_offset * 0.25;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 260,
                height: 350,
                transform: `translate(calc(-50% + ${x}px), -50%) scale(${scale}) rotateY(${rotateY}deg)`,
                zIndex: z,
                opacity,
              }}
            >
              <div
                className={`w-full h-full rounded-xl ${tone} animate-pulse relative overflow-hidden shadow-lg shadow-slate-900/10 ring-1 ring-white/30 dark:ring-white/10`}
              >
                <div className="absolute top-0 right-0 w-28 h-28 bg-white/5 rounded-full -translate-y-12 translate-x-12" />
                <div className="absolute bottom-0 left-0 w-16 h-16 bg-white/5 rounded-full translate-y-6 -translate-x-4" />
                <div className="p-6 h-full flex flex-col justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-white/10" />
                    <div className="w-14 h-5 rounded-full bg-white/10" />
                  </div>
                  <div className="flex-1 flex flex-col justify-center space-y-3">
                    <div className="h-5 w-3/4 rounded bg-white/10" />
                    <div className="h-3 w-full rounded bg-white/10" />
                    <div className="h-3 w-5/6 rounded bg-white/10" />
                    <div className="h-3 w-2/3 rounded bg-white/10" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 h-3.5 rounded bg-white/10" />
                    <div className="w-20 h-3 rounded bg-white/10" />
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Right nav placeholder */}
        <div className="absolute right-0 z-40 w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
      </div>

      {/* Dot indicators */}
      <div className="flex items-center gap-1.5 mt-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`rounded-full transition-all ${
              i === 2 ? "w-4 h-2.5 bg-amber-200 dark:bg-amber-700/70" : "w-2 h-2 bg-zinc-200 dark:bg-zinc-700"
            } animate-pulse`}
          />
        ))}
      </div>

      {/* Detail skeleton */}
      <div className="w-full max-w-2xl mt-4 px-4 space-y-2">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
          <div>
            <div className="h-4 w-32 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mb-1" />
            <div className="h-3 w-16 bg-zinc-100 dark:bg-zinc-800/50 rounded animate-pulse" />
          </div>
        </div>
        <div className="h-32 rounded-xl bg-zinc-50 dark:bg-zinc-900 animate-pulse" />
      </div>
    </div>
  );
}

// ── Main Page ──

export default function ContentGeneratorPage() {
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const CARD_META = get_card_meta(t);
  const { user, loading: auth_loading } = useAuth();
  const router = useRouter();

  const [sessions, set_sessions] = useState<SessionRecord[]>([]);
  const [session, set_session] = useState<SessionRecord | null>(null);
  const [messages, set_messages] = useState<ChatMessage[]>([]);
  const [input, set_input] = useState("");
  const [sending, set_sending] = useState(false);
  const [error, set_error] = useState<Feedback | null>(null);
  const [toast, set_toast] = useState<Feedback | null>(null);
  const [view, set_view] = useState<"chat" | "history">("chat");
  const [filter_text, set_filter_text] = useState("");
  const [sort_order, set_sort_order] = useState<"newest" | "oldest">("newest");
  const [session_loading, set_session_loading] = useState(true);
  const [poll_interval, set_poll_interval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [insight_ids, set_insight_ids] = useState<string[]>([]);
  const [case_ids, set_case_ids] = useState<string[]>([]);
  const [insight_labels, set_insight_labels] = useState<RefLabel[]>([]);
  const [case_labels, set_case_labels] = useState<RefLabel[]>([]);
  const [show_ref_panel, set_show_ref_panel] = useState(false);
  const [active_card_index, set_active_card_index] = useState(0);
  const [flipped_ids, set_flipped_ids] = useState<Set<string>>(new Set());
  const [modify_input, set_modify_input] = useState("");
  const [modifying, set_modifying] = useState(false);
  const [show_modify_modal, set_show_modify_modal] = useState(false);
  const [modify_target_index, set_modify_target_index] = useState(0);
  const [generating_doc, set_generating_doc] = useState(false);
  const [selected_chips, set_selected_chips] = useState<string[]>([]);
  const [show_chip_popover, set_show_chip_popover] = useState(false);
  const [show_version_panel, set_show_version_panel] = useState(false);
  const [version_refresh_key, set_version_refresh_key] = useState(0);
  const [delete_target, set_delete_target] = useState<SessionRecord | null>(null);
  const [publish_target_card, set_publish_target_card] = useState<ContentCard | null>(null);
  const [show_publish_modal, set_show_publish_modal] = useState(false);
  const [publish_platform, set_publish_platform] = useState<"xiaohongshu" | "douyin">("xiaohongshu");
  const [publish_content_type, set_publish_content_type] = useState<"image_text" | "video">("image_text");
  const [publish_selected_versions, set_publish_selected_versions] = useState<Record<string, string>>({});

  const chat_end_ref = useRef<HTMLDivElement>(null);
  const modify_abort_ref = useRef<AbortController | null>(null);
  const restored_session_ref = useRef(false);

  // Auth guard
  useEffect(() => {
    if (!auth_loading && !user) router.push("/");
  }, [user, auth_loading, router]);

  useEffect(() => {
    if (error) showError(typeof error === "string" ? error : t(error.zh, error.en, error.values));
  }, [error, showError, t]);

  // Load sessions on mount
  useEffect(() => {
    if (user) {
      fetch_sessions()
        .then((res) => { if (res.success && res.data) set_sessions(res.data); })
        .catch(() => {})
        .finally(() => set_session_loading(false));
    }
  }, [user]);

  // Reset modify state when switching cards
  useEffect(() => {
    set_modifying(false);
    set_modify_input("");
  }, [active_card_index]);

  // Auto-scroll chat
  useEffect(() => {
    chat_end_ref.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup poll on unmount
  useEffect(() => {
    return () => { if (poll_interval) clearInterval(poll_interval); };
  }, [poll_interval]);

  const show_toast = useCallback((msg: Feedback) => {
    set_toast(msg);
    setTimeout(() => set_toast(null), 3000);
  }, []);

  // ── Session management ──

  const toggle_flip = useCallback((id: string) => {
    set_flipped_ids((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handle_modify_card = useCallback(async () => {
    const instruction = modify_input.trim();
    if (!instruction || !session || modifying) return;
    const card = (session?.cards || [])[modify_target_index];
    if (!card) return;
    set_modifying(true);
    set_modify_input("");

    const controller = new AbortController();
    modify_abort_ref.current = controller;

    try {
      const res = await modify_card(session.id, card.id, instruction, controller.signal);
      if (res.success && res.data) {
        const updated = res.data.card;
        set_session((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            cards: prev.cards.map((c) => c.id === updated.id ? updated : c),
          };
        });
        set_show_modify_modal(false);
        set_version_refresh_key((k) => k + 1);
        show_toast({ zh: "卡片已修改", en: "Card updated" });
      } else {
        show_toast({ zh: "修改失败，请重试", en: "Could not update the card. Please try again." });
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return; // user cancelled, no toast
      show_toast({ zh: "修改失败，请重试", en: "Could not update the card. Please try again." });
    } finally {
      set_modifying(false);
      modify_abort_ref.current = null;
    }
  }, [modify_input, session, modifying, modify_target_index, show_toast]);

  const handle_generate_document = useCallback(async () => {
    if (!session || generating_doc) return;
    add_pending_document_session(session.id);
    set_generating_doc(true);
    try {
      const res = await generate_document(session.id);
      if (res.success) {
        show_toast({ zh: "综合文档正在后台生成，可先切换到作品集等待", en: "Your Marketing Report is being generated in the background. You can open Portfolio while you wait." });
      } else {
        remove_pending_document_session(session.id);
        show_toast({ zh: "文档生成失败", en: "Could not generate the report" });
      }
    } catch {
      remove_pending_document_session(session.id);
      show_toast({ zh: "文档生成失败", en: "Could not generate the report" });
    } finally {
      set_generating_doc(false);
    }
  }, [session, generating_doc, show_toast]);

  const handle_save_project = useCallback(async (card?: ContentCard) => {
    if (!session) return;
    try {
      const res = await save_content_project({
        source_session_id: session.id,
        source_card_id: card?.id,
        title: session.title || card?.title || t("未命名内容项目", "Untitled content project"),
        xhs_account: "",
        content_type: card?.card_type || "mixed",
        platform_hint: "",
      });
      show_toast(res.success ? { zh: "已保存到内容项目库", en: "Saved to Content Projects" } : { zh: "保存失败", en: "Could not save" });
    } catch {
      show_toast({ zh: "保存到内容项目库失败", en: "Could not save to Content Projects" });
    }
  }, [session, show_toast, t]);

  const open_publish_selector = useCallback((card?: ContentCard, platform: "xiaohongshu" | "douyin" = "xiaohongshu") => {
    if (!session) return;
    const cards = session.cards || [];
    const pick = (type: string) => cards.find((item) => item.card_type === type)?.id || "";
    const selected: Record<string, string> = {
      title: pick("title"),
      body: pick("copy"),
      cover: pick("visual"),
      tags: pick("hashtags"),
      script: pick("script"),
    };
    if (card) {
      if (card.card_type === "copy") selected.body = card.id;
      else if (card.card_type === "hashtags") selected.tags = card.id;
      else if (card.card_type === "visual") selected.cover = card.id;
      else if (card.card_type === "script") selected.script = card.id;
      else selected.title = card.id;
    }
    set_publish_target_card(card || null);
    set_publish_platform(platform);
    set_publish_content_type(card?.card_type === "script" || platform === "douyin" ? "video" : "image_text");
    set_publish_selected_versions(selected);
    set_show_publish_modal(true);
  }, [session]);

  const build_publish_snapshot = useCallback((selected: Record<string, string>) => {
    const cards = session?.cards || [];
    const byId = Object.fromEntries(cards.map((card) => [card.id, card]));
    const title = byId[selected.title] || cards.find((card) => card.card_type === "title");
    const body = byId[selected.body] || cards.find((card) => card.card_type === "copy");
    const cover = byId[selected.cover] || cards.find((card) => card.card_type === "visual");
    const tags = byId[selected.tags] || cards.find((card) => card.card_type === "hashtags");
    const script = byId[selected.script] || cards.find((card) => card.card_type === "script");
    return {
      title: title?.title || title?.content || "",
      body: body?.content || body?.preview || "",
      cover_text: cover?.content || cover?.preview || "",
      tags: tags?.content || tags?.preview || "",
      script: script?.content || script?.preview || "",
      selected_card_ids: selected,
    };
  }, [session?.cards]);

  const create_publish_task_from_selection = useCallback(async () => {
    if (!session) return;
    try {
      const project = await save_content_project({
        source_session_id: session.id,
        source_card_id: publish_target_card?.id,
        title: session.title || publish_target_card?.title || t("未命名内容项目", "Untitled content project"),
        content_type: publish_content_type,
        platform_hint: publish_platform,
      });
      const res = await create_publish_task({
        source_session_id: session.id,
        project_id: project.data?.id,
        source_card_id: publish_target_card?.id,
        platform: publish_platform,
        content_type: publish_content_type,
        selected_version_ids: publish_selected_versions,
        final_snapshot: build_publish_snapshot(publish_selected_versions),
      });
      if (res.success) {
        set_show_publish_modal(false);
        show_toast({ zh: "已创建发布任务", en: "Publishing task created" });
        router.push("/publish_management?tab=tasks");
      } else {
        show_toast({ zh: "创建发布任务失败", en: "Could not create the publishing task" });
      }
    } catch {
      show_toast({ zh: "创建发布任务失败", en: "Could not create the publishing task" });
    }
  }, [build_publish_snapshot, publish_content_type, publish_platform, publish_selected_versions, publish_target_card, router, session, show_toast, t]);

  // ── Reset: clear everything ──

  const handle_reset = useCallback(async () => {
    if (poll_interval) clearInterval(poll_interval);
    set_poll_interval(null);
    // Delete truly empty session (no messages and no cards)
    if (session && (!session.cards || session.cards.length === 0) && (!session.messages || session.messages.length === 0)) {
      delete_session(session.id).catch(() => {});
      set_sessions((prev) => prev.filter((s) => s.id !== session.id));
    }
    set_session(null);
    set_messages([]);
    window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    set_input("");
    set_error(null);
    set_view("chat");
    set_insight_ids([]);
    set_case_ids([]);
    set_insight_labels([]);
    set_case_labels([]);
    set_selected_chips([]);
    set_active_card_index(0);
    set_flipped_ids(new Set());
  }, [session, poll_interval]);

  const load_session = useCallback(async (id: string) => {
    try {
      if (poll_interval) { clearInterval(poll_interval); set_poll_interval(null); }
      set_error(null);
      const res = await fetch_session(id);
      if (res.success && res.data) {
        set_session(res.data);
        window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, res.data.id);
        set_messages(res.data.messages || []);
        set_view("chat");
        set_insight_ids(res.data.insight_ids || []);
        set_case_ids(res.data.case_ids || []);
        set_active_card_index(0);
        set_flipped_ids(new Set());
        set_modifying(false);
        set_modify_input("");
        set_sending(false);
        // Historical sessions may end with a user message if a previous AI request failed.
        // Load them as editable conversations instead of polling forever.
        const msgs = res.data.messages || [];
        if (msgs.length > 0 && msgs[msgs.length - 1].role === "user") {
          set_error({ zh: "上一次 AI 回复未完成，可以继续输入补充信息或重新发送。", en: "The previous AI response was not completed. Add more information or send your message again." });
        }
      }
    } catch {
      set_error({ zh: "加载会话失败", en: "Could not load the conversation" });
    }
  }, [poll_interval]);

  useEffect(() => {
    if (!user || session_loading || restored_session_ref.current) return;
    restored_session_ref.current = true;
    const stored_id = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    if (stored_id) load_session(stored_id);
  }, [user, session_loading, load_session]);

  const request_delete_session = useCallback((target: SessionRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    set_delete_target(target);
  }, []);

  const confirm_delete_session = useCallback(async () => {
    if (!delete_target) return;
    const id = delete_target.id;
    try {
      await delete_session(id);
      set_sessions((prev) => prev.filter((s) => s.id !== id));
      if (session?.id === id) {
        set_session(null);
        set_messages([]);
        window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
        if (poll_interval) { clearInterval(poll_interval); set_poll_interval(null); }
      }
      show_toast({ zh: "会话已删除", en: "Conversation deleted" });
    } catch {
      set_error({ zh: "删除失败", en: "Could not delete" });
    } finally {
      set_delete_target(null);
    }
  }, [delete_target, session, show_toast, poll_interval]);

  // ── Chat ──

  const toggle_chip = useCallback((key: string) => {
    set_selected_chips((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      const category = CHIP_CATEGORIES.find((cat) => cat.chips.some((c) => c.key === key));
      if (category && category.key !== "content") {
        const cat_keys = new Set(category.chips.map((c) => c.key));
        return [...prev.filter((k) => !cat_keys.has(k)), key];
      }
      return [...prev, key];
    });
  }, []);

  const build_chip_context = useCallback((): string => {
    if (selected_chips.length === 0) return "";
    const chip_label_map = new Map<string, string>();
    for (const cat of CHIP_CATEGORIES) {
      for (const chip of cat.chips) {
        chip_label_map.set(chip.key, chip.label);
      }
    }
    const labels = selected_chips.map((k) => chip_label_map.get(k) || k);
    return "【已选偏好】" + labels.join("、") + "\n\n";
  }, [selected_chips]);

  const handle_send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const chip_prefix = build_chip_context();
    const full_text = chip_prefix + text;
    set_selected_chips([]);

    if (!session) {
      try {
        const res = await create_session();
        if (res.success && res.data) {
          const s = res.data;
          set_session(s);
          window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, s.id);
          set_sessions((prev) => [s, ...prev]);
          const msg = full_text;
          set_input("");
          set_error(null);
          set_sending(true);
          set_messages([{ role: "user", content: msg }]);

          const chat_res = await send_chat_message(s.id, msg, insight_ids, case_ids);
          if (chat_res.success && chat_res.data) {
            set_messages(chat_res.data.session.messages || []);
            set_session(chat_res.data.session);
            window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, chat_res.data.session.id);
            set_sessions((prev) => prev.map((s) => s.id === chat_res.data.session.id ? chat_res.data.session : s));
          }
        }
      } catch (error) {
        set_error(error instanceof Error ? error.message : { zh: "发送失败，请重试", en: "Could not send. Please try again." });
      } finally {
        set_sending(false);
      }
      return;
    }

    set_input("");
    set_error(null);
    set_sending(true);

    const optimistic: ChatMessage[] = [
      ...messages,
      { role: "user", content: full_text },
    ];
    set_messages(optimistic);

    try {
      const res = await send_chat_message(session.id, full_text, insight_ids, case_ids);
      if (res.success && res.data) {
        set_messages(res.data.session.messages || []);
        set_session(res.data.session);
        window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, res.data.session.id);
        set_sessions((prev) => prev.map((s) => s.id === res.data.session.id ? res.data.session : s));
      }
    } catch (error) {
      set_error(error instanceof Error ? error.message : { zh: "发送失败，请重试", en: "Could not send. Please try again." });
    } finally {
      set_sending(false);
    }
  }, [input, sending, session, messages, insight_ids, case_ids, build_chip_context]);

  const handle_keydown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handle_send();
    }
  }, [handle_send]);

  // ── Generate ──

  const handle_generate = useCallback(async () => {
    if (!session || sending) return;

    set_error(null);
    set_sending(true);
    try {
      const res = await generate_cards(session.id);
      if (res.success) {
        show_toast({ zh: "正在生成内容卡片...", en: "Generating content cards..." });

        const interval = setInterval(async () => {
          try {
            const updated = await fetch_session(session.id);
            if (updated.success && updated.data) {
              set_session(updated.data);
              set_messages(updated.data.messages || []);
              set_sessions((prev) => prev.map((s) => s.id === updated.data.id ? updated.data : s));
              if (updated.data.status === "completed" || updated.data.status === "failed") {
                clearInterval(interval);
                set_poll_interval(null);
                if (updated.data.status === "completed") {
                  set_version_refresh_key((k) => k + 1);
                  set_toast({ zh: "内容生成完成！点击卡片翻转查看详情", en: "Content generated! Click a card to flip it and view details." });
                  setTimeout(() => set_toast(null), 4000);
                } else {
                  set_error({ zh: "内容生成失败，请重试", en: "Could not generate content. Please try again." });
                }
              }
            }
          } catch {
            clearInterval(interval);
            set_poll_interval(null);
          }
        }, 2000);
        set_poll_interval(interval);
      }
    } catch {
      set_error({ zh: "生成失败，请重试", en: "Generation failed. Please try again." });
    } finally {
      set_sending(false);
    }
  }, [session, sending, show_toast]);

  // ── Filtered sessions ──

  const filtered_sessions = useMemo(() => {
    let result = [...sessions];
    if (filter_text.trim()) {
      const kw = filter_text.trim().toLowerCase();
      result = result.filter((s) =>
        s.title.toLowerCase().includes(kw)
      );
    }
    result.sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sort_order === "newest" ? tb - ta : ta - tb;
    });
    return result;
  }, [sessions, filter_text, sort_order]);

  // ── Render ──

  if (auth_loading || !user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const is_generating = session?.status === "generating";
  const has_cards = (session?.cards?.length || 0) > 0;
  const publish_slots = [
    { key: "title", label: t("标题版本", "Title version"), type: "title" },
    { key: "body", label: t("正文版本", "Body version"), type: "copy" },
    { key: "cover", label: t("封面文案版本", "Cover copy version"), type: "visual" },
    { key: "tags", label: t("标签版本", "Hashtag version"), type: "hashtags" },
    { key: "script", label: t("图文排版/短视频脚本版本", "Image post layout / short video script version"), type: "script" },
  ];

  return (
    <div className="amp-redesign amp-workspace-page flex h-full min-h-0 flex-col overflow-hidden">
      <div className="amp-library-layout amp-library-shell amp-workspace-card flex min-h-0 flex-1 overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-xl">
          {typeof toast === "string" ? toast : t(toast.zh, toast.en, toast.values)}
        </div>
      )}

      {/* ── Left Panel ── */}
      <div className="amp-library-sidebar w-56 lg:w-72 xl:w-80 border-r border-zinc-200 dark:border-zinc-800 flex flex-col shrink-0">
        {/* Header */}
        <div className="amp-library-sidebar-header p-3 lg:p-4 border-b border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 font-heading">{t("创作会话", "Conversations")}</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => set_view("chat")}
                disabled={sending || is_generating}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  view === "chat"
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {t("对话", "Chat")}
              </button>
              <button
                onClick={() => {
                  // Clean up truly empty session (no messages and no cards) when leaving chat
                  if (session && (!session.cards || session.cards.length === 0) && (!session.messages || session.messages.length === 0)) {
                    delete_session(session.id).catch(() => {});
                    set_sessions((prev) => prev.filter((s) => s.id !== session.id));
                    set_session(null);
                    set_messages([]);
                    set_input("");
                    if (poll_interval) { clearInterval(poll_interval); set_poll_interval(null); }
                  }
                  set_view("history");
                }}
                disabled={sending || is_generating}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  view === "history"
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {t("历史", "History")}
              </button>
            </div>
            <button
              onClick={() => set_show_ref_panel(true)}
              disabled={sending || is_generating}
              className="ml-1 px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
              {t("引用素材", "Reference materials")}
              {(insight_ids.length > 0 || case_ids.length > 0) && (
                <span className="ml-0.5 bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-semibold">
                  {insight_ids.length + case_ids.length}
                </span>
              )}
            </button>
            {(session || messages.length > 0 || has_cards) && (
              <button
                onClick={handle_reset}
                disabled={sending || is_generating}
                className="ml-1 px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                {t("重置", "Reset")}
              </button>
            )}
          </div>

          {view === "history" && (
            <>
              <div className="relative">
                <svg className="absolute left-2.5 top-2 w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <input
                  value={filter_text}
                  onChange={(e) => set_filter_text(e.target.value)}
                  placeholder={t("搜索会话...", "Search conversations...")}
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => set_sort_order("newest")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    sort_order === "newest"
                      ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {t("最新", "Newest")}
                </button>
                <button
                  onClick={() => set_sort_order("oldest")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    sort_order === "oldest"
                      ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {t("最早", "Oldest")}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Content */}
        {view === "chat" ? (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 lg:p-4 space-y-4">
              {!session || messages.length === 0 ? (
                <div className="text-center text-sm text-zinc-400 dark:text-zinc-500 mt-8">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
                    <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                    </svg>
                  </div>
                  <p className="font-medium text-zinc-600 dark:text-zinc-300 mb-1">{t("描述你的创作需求", "Describe what you want to create")}</p>
                  <p>{t("我会帮你生成脚本、标题、文案、话题和视觉方案", "I can help you create scripts, titles, copy, hashtags, and visual plans.")}</p>
                </div>
              ) : (
                <>
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                          m.role === "user"
                            ? "bg-blue-500 text-white rounded-br-md"
                            : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-bl-md"
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {sending && (
                    <div className="flex justify-start">
                      <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                        <div className="flex gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={chat_end_ref} />
            </div>

            {/* Input area */}
            <div className="p-3 lg:p-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
              {/* Reference chips */}
              {(insight_ids.length > 0 || case_ids.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {insight_labels.length > 0 ? (
                    insight_labels.map((lbl) => (
                      <span key={lbl.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                        <span className="max-w-[120px] truncate">{lbl.label}</span>
                        <button
                          onClick={() => {
                            const new_insight_ids = insight_ids.filter((id) => id !== lbl.id);
                            set_insight_ids(new_insight_ids);
                            set_insight_labels((prev) => prev.filter((l) => l.id !== lbl.id));
                            if (session) set_session_references(session.id, new_insight_ids, case_ids);
                          }}
                          className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors cursor-pointer"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))
                  ) : insight_ids.length > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300">
                      {t("市场洞察 × {count}", "Market Insight × {count}", { count: insight_ids.length.toLocaleString(locale) })}
                      <button
                        onClick={() => {
                          set_insight_ids([]);
                          if (session) set_session_references(session.id, [], case_ids);
                        }}
                        className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors cursor-pointer"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ) : null}
                  {case_labels.length > 0 ? (
                    case_labels.map((lbl) => (
                      <span key={lbl.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                        </svg>
                        <span className="max-w-[120px] truncate">{lbl.label}</span>
                        <button
                          onClick={() => {
                            const new_case_ids = case_ids.filter((id) => id !== lbl.id);
                            set_case_ids(new_case_ids);
                            set_case_labels((prev) => prev.filter((l) => l.id !== lbl.id));
                            if (session) set_session_references(session.id, insight_ids, new_case_ids);
                          }}
                          className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors cursor-pointer"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))
                  ) : case_ids.length > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
                      {t("案例库 × {count}", "Case Library × {count}", { count: case_ids.length.toLocaleString(locale) })}
                      <button
                        onClick={() => {
                          set_case_ids([]);
                          if (session) set_session_references(session.id, insight_ids, []);
                        }}
                        className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors cursor-pointer"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ) : null}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handle_generate}
                  disabled={!session || messages.length < 2 || sending || is_generating}
                  className={`flex-1 min-h-11 rounded-xl border px-5 text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${
                    session && messages.length >= 2
                      ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                      : "border-transparent bg-zinc-300 text-white shadow-none dark:bg-zinc-700 cursor-not-allowed"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                  </svg>
                  {is_generating ? t("生成中...", "Generating...") : t("生成内容卡片", "Generate content cards")}
                </button>
                <div className="relative shrink-0">
                  <button
                    onClick={() => set_show_chip_popover(!show_chip_popover)}
                    disabled={sending || is_generating}
                    className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      show_chip_popover || selected_chips.length > 0
                        ? "border-blue-400 dark:border-blue-600 text-blue-500 bg-blue-50 dark:bg-blue-950"
                        : "border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:text-blue-500 hover:border-blue-300 dark:hover:border-blue-700 bg-white dark:bg-zinc-900"
                    }`}
                    title={t("选择偏好", "Choose preferences")}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                    </svg>
                    {selected_chips.length > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] font-semibold flex items-center justify-center">
                        {selected_chips.length}
                      </span>
                    )}
                  </button>
                  {show_chip_popover && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => set_show_chip_popover(false)} />
                      <div className="absolute bottom-full right-0 mb-2 w-72 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-4 z-50">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t("选择偏好", "Choose preferences")}</p>
                          {selected_chips.length > 0 && (
                            <button
                              onClick={() => set_selected_chips([])}
                              className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                            >
                              {t("清除全部", "Clear all")}
                            </button>
                          )}
                        </div>
                        {CHIP_CATEGORIES.map((cat) => (
                          <div key={cat.key} className="mb-3 last:mb-0">
                            <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 mb-1.5">{t(cat.label, cat.label_en)}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {cat.chips.map((chip) => {
                                const sel = selected_chips.includes(chip.key);
                                return (
                                  <button
                                    key={chip.key}
                                    onClick={() => toggle_chip(chip.key)}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                      sel
                                        ? "bg-blue-500 text-white"
                                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-blue-100 dark:hover:bg-blue-900 hover:text-blue-700 dark:hover:text-blue-300"
                                    }`}
                                  >
                                    {t(chip.label, chip.label_en)}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => set_input(e.target.value)}
                  onKeyDown={handle_keydown}
                  placeholder={session ? t("描述你的产品、目标受众、风格偏好...", "Describe your product, target audience, and preferred style...") : t("点击输入框开始新对话...", "Start a new conversation here...")}
                  rows={2}
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-50"
                  disabled={sending || is_generating}
                />
                <button
                  onClick={handle_send}
                  aria-label={t("发送消息", "Send message")}
                  disabled={sending || is_generating || !input.trim()}
                  className="shrink-0 w-10 h-10 self-end rounded-xl bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          /* History list */
          <div className="flex-1 overflow-y-auto">
            {session_loading ? (
              <div className="p-4 space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-20 rounded-xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                ))}
              </div>
            ) : filtered_sessions.length === 0 ? (
              <div className="text-center text-sm text-zinc-400 dark:text-zinc-500 mt-8 px-4">
                {filter_text ? t("没有匹配的会话", "No matching conversations") : t("暂无历史会话", "No conversation history yet")}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filtered_sessions.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => load_session(s.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") load_session(s.id); }}
                    className={`w-full text-left p-3 rounded-xl transition-colors cursor-pointer ${
                      session?.id === s.id
                        ? "bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-transparent"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                          {s.title || t("新会话", "New conversation")}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {Number.isNaN(new Date(s.created_at).getTime()) ? s.created_at : new Date(s.created_at).toLocaleString(locale)}
                        </p>
                        <p className="text-xs mt-1">
                          {s.status === "completed" ? (
                            <span className="text-emerald-600 dark:text-emerald-400">{t("已完成 · {count} 张卡片", "Completed · {count} cards", { count: s.cards.length.toLocaleString(locale) })}</span>
                          ) : s.status === "generating" ? (
                            <span className="text-amber-600 dark:text-amber-400">{t("生成中...", "Generating...")}</span>
                          ) : s.status === "failed" ? (
                            <span className="text-red-600 dark:text-red-400">{t("生成失败", "Generation failed")}</span>
                          ) : (
                            <span className="text-zinc-400">{t("草稿", "Draft")}</span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={(e) => request_delete_session(s, e)}
                        aria-label={t("删除会话", "Delete conversation")}
                        className="shrink-0 p-1 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right Panel ── */}
      {is_generating && !has_cards ? (
        <GeneratingSkeleton />
      ) : has_cards ? (
        <div className="flex-1 flex flex-col overflow-y-auto bg-zinc-50/30 dark:bg-zinc-950/30">
          {/* Carousel area */}
          <div className="flex flex-col items-center pt-8 lg:pt-12 px-2 lg:px-4 shrink-0">
            {/* Header */}
            <div className="w-full max-w-3xl mb-3 px-2 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-200 font-heading">
                  {session?.title || t("创作结果", "Creative results")}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {t("{count} 张卡片 · 点击中间卡片翻转查看要点", "{count} cards · Click the center card to flip it and view key points", { count: (session?.cards.length || 0).toLocaleString(locale) })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handle_generate_document}
                  disabled={sending || is_generating || generating_doc}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-zinc-900 hover:bg-emerald-50 dark:hover:bg-emerald-950 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {generating_doc ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  )}
                  {t("生成综合文档", "Generate Marketing Report")}
                </button>
                <button
                  onClick={() => set_show_version_panel(true)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {t("版本历史", "Version history")}
                </button>
              </div>
            </div>

            {/* 3D Ring + Nav arrows */}
            <div className="relative w-full max-w-3xl h-[28rem] flex items-center justify-center overflow-visible">
              {/* Left nav */}
              <button
                onClick={() => set_active_card_index((prev) => (prev - 1 + 5) % 5)}
                className="absolute -left-6 z-40 group transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                aria-label={t("上一张", "Previous card")}
              >
                <svg className="h-10 w-10 text-slate-300 transition-colors group-hover:text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path
                    d="m15 18-6-6 6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {/* Ring */}
              <div className="relative w-full h-full" style={{ perspective: "1200px" }}>
                {(session?.cards || []).map((card, i) => {
                  const raw_offset = ((i - active_card_index) + 5) % 5;
                  const offset = raw_offset > 2 ? raw_offset - 5 : raw_offset;
                  const abs_offset = Math.abs(offset);
                  const sign = Math.sign(offset) || 0;

                  const scale = 1 - abs_offset * 0.18;
                  const x = sign * (120 + abs_offset * 80);
                  const rotateY = sign * (5 + abs_offset * 7);
                  const z = 30 - abs_offset * 10;
                  const opacity = 1 - abs_offset * 0.25;
                  const is_active = offset === 0;
                  const flipped = flipped_ids.has(card.id);

                  return (
                    <div
                      key={card.id}
                      onClick={() => { if (is_active) set_active_card_index(i); }}
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: "50%",
                        transform: `translate(calc(-50% + ${x}px), -50%) scale(${scale}) rotateY(${rotateY}deg)`,
                        zIndex: z,
                        opacity,
                        transition: "all 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)",
                      }}
                    >
                      <FlipCard3D
                        card={card}
                        is_active={is_active}
                        flipped={flipped}
                        on_flip={() => { if (is_active) toggle_flip(card.id); }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Right nav */}
              <button
                onClick={() => set_active_card_index((prev) => (prev + 1) % 5)}
                className="absolute -right-6 z-40 group transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                aria-label={t("下一张", "Next card")}
              >
                <svg className="h-10 w-10 text-slate-300 transition-colors group-hover:text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path
                    d="m9 18 6-6-6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            {/* Dot indicators */}
            <div className="flex items-center gap-1.5 mt-1">
              {(session?.cards || []).slice(0, 5).map((_, i) => (
                <button
                  key={i}
                  onClick={() => set_active_card_index(i)}
                  className={`w-2 h-2 rounded-full transition-all cursor-pointer ${
                    i === active_card_index
                      ? "bg-amber-200 dark:bg-amber-700/80 w-4"
                      : "bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Detail panel — always bound to active card */}
          {(() => {
            const card = (session?.cards || [])[active_card_index];
            if (!card) return null;
            return (
              <div className="px-4 py-4 lg:px-6 lg:py-5">
                <div className="mx-auto w-full max-w-5xl">
                  <SelectedPlanDetailPanel
                    card={card}
                    disabled={sending || is_generating}
                    on_modify={() => {
                      set_modify_target_index(active_card_index);
                      set_modify_input("");
                      set_show_modify_modal(true);
                    }}
                    on_copy={() => {
                      navigator.clipboard.writeText(card.content);
                      show_toast({ zh: "已复制当前方案内容", en: "Selected plan copied" });
                    }}
                    on_publish={() => open_publish_selector(card)}
                    on_save={() => handle_save_project(card)}
                  />
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <EmptyState />
      )}

      {show_publish_modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t("选择版本并发布", "Select versions and publish")}</h3>
                <p className="mt-1 text-sm text-zinc-500">{t("先从智能创作结果中选择最终标题、正文、封面、标签和脚本，再创建发布任务。", "Choose the final title, body, cover, hashtags, and script from your Content Studio results, then create a publishing task.")}</p>
              </div>
              <button type="button" onClick={() => set_show_publish_modal(false)} className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                {t("关闭", "Close")}
              </button>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-zinc-500">
                {t("平台", "Platform")}
                <select
                  value={publish_platform}
                  onChange={(event) => set_publish_platform(event.target.value as "xiaohongshu" | "douyin")}
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="xiaohongshu">{t("小红书", "Xiaohongshu")}</option>
                  <option value="douyin">{t("抖音", "Douyin")}</option>
                </select>
              </label>
              <label className="text-xs text-zinc-500">
                {t("发布类型", "Post type")}
                <select
                  value={publish_content_type}
                  onChange={(event) => set_publish_content_type(event.target.value as "image_text" | "video")}
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="image_text">{t("图文发布", "Image post")}</option>
                  <option value="video">{t("视频发布", "Video post")}</option>
                </select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {publish_slots.map((slot) => {
                const cards = (session?.cards || []).filter((item) => item.card_type === slot.type);
                const options = cards.length > 0 ? cards : (session?.cards || []);
                return (
                  <label key={slot.key} className="text-xs text-zinc-500">
                    {slot.label}
                    <select
                      value={publish_selected_versions[slot.key] || ""}
                      onChange={(event) => set_publish_selected_versions((prev) => ({ ...prev, [slot.key]: event.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="">{t("不选择", "None")}</option>
                      {options.map((item) => (
                        <option key={item.id} value={item.id}>{item.title}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => set_show_publish_modal(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                {t("取消", "Cancel")}
              </button>
              <button type="button" onClick={create_publish_task_from_selection} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
                {t("创建发布任务", "Create publishing task")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reference Panel */}
      <ReferencePanel
        open={show_ref_panel}
        selected_insight_ids={insight_ids}
        selected_case_ids={case_ids}
        onConfirm={(iids, cids, ilabels, clabels) => {
          set_insight_ids(iids);
          set_case_ids(cids);
          set_insight_labels(ilabels);
          set_case_labels(clabels);
          if (session) set_session_references(session.id, iids, cids);
        }}
        onClose={() => set_show_ref_panel(false)}
      />

      {/* Version History Panel */}
      <VersionPanel
        open={show_version_panel}
        session_id={session?.id || ""}
        current_cards={session?.cards || []}
        refresh_key={version_refresh_key}
        onRestore={(cards, version_label) => {
          set_session((prev) => prev ? { ...prev, cards } : prev);
          set_version_refresh_key((k) => k + 1);
          show_toast({ zh: "已恢复到 {version}", en: "Restored to {version}", values: { version: version_label } });
        }}
        onClose={() => set_show_version_panel(false)}
      />

      {/* AI Modify Modal */}
      {show_modify_modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4 font-heading">{t("AI 修改卡片", "Edit card with AI")}</h3>

            {/* Card selector */}
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{t("选择要修改的卡片", "Choose a card to edit")}</label>
            <div className="grid grid-cols-5 gap-1.5 mb-4">
              {(session?.cards || []).map((card, i) => {
                const meta = CARD_META[card.card_type] || CARD_META.script;
                return (
                  <button
                    key={card.id}
                    onClick={() => set_modify_target_index(i)}
                    className={`p-2 rounded-xl text-center transition-all cursor-pointer ${
                      i === modify_target_index
                        ? `${meta.tone} text-white ring-2 ring-offset-1 ring-blue-200 dark:ring-blue-700/80`
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                  >
                    <div className="flex justify-center mb-1">{meta.icon}</div>
                    <span className="text-[10px] font-medium block truncate">{meta.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Instruction input */}
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{t("修改要求", "Editing instructions")}</label>
            <input
              value={modify_input}
              onChange={(e) => set_modify_input(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handle_modify_card(); }}
              placeholder={t("如：缩短到100字、语气更活泼、增加emoji...", "For example: shorten to 100 characters, use a livelier tone, add emoji...")}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 mb-4"
              autoFocus
            />

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  if (modifying) {
                    modify_abort_ref.current?.abort();
                    show_toast({ zh: "用户中止操作", en: "Operation cancelled" });
                  } else {
                    set_show_modify_modal(false);
                  }
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                {modifying ? t("中止", "Stop") : t("取消", "Cancel")}
              </button>
              <button
                onClick={handle_modify_card}
                disabled={modifying || !modify_input.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {modifying ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t("修改中...", "Updating...")}
                  </>
                ) : (
                  t("确认修改", "Confirm changes")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {delete_target && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t("确认删除历史会话？", "Delete this conversation?")}</h3>
                <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  {t("删除后将无法恢复「{title}」。", "“{title}” cannot be recovered after deletion.", { title: delete_target.title || t("新会话", "New conversation") })}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => set_delete_target(null)}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {t("取消", "Cancel")}
              </button>
              <button
                type="button"
                onClick={confirm_delete_session}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600"
              >
                {t("确认删除", "Confirm deletion")}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
