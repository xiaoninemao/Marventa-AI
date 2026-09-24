import type { TranslationValues } from "@/i18n/locale";

export type Feedback = string | { zh: string; en: string; values?: TranslationValues };

export const ACTIVE_SESSION_STORAGE_KEY = "amp-content-generator-active-session-v1";
const PENDING_DOCUMENTS_STORAGE_KEY = "amp-content-generator-pending-documents-v1";

export function add_pending_document_session(session_id: string) {
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

export function remove_pending_document_session(session_id: string) {
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

export const CHIP_CATEGORIES = [
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
];
