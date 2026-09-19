"use client";

import Image from "next/image";
import type { CaseItem } from "@/types/case_library";
import { useI18n } from "@/contexts/i18n_context";
import type { Locale, Translate } from "@/i18n/locale";

function formatNumber(value: number | null | undefined, locale: Locale, t: Translate): string {
  if (value === undefined || value === null) return t("未公开", "Not disclosed");
  if (locale === "en") return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}w`;
  return String(value);
}

function contentTypeLabel(type: CaseItem["content_type"], t: Translate): string {
  if (type === "video") return t("短视频", "Short video");
  if (type === "image_text") return t("图文", "Image post");
  return t("待确认", "Unconfirmed");
}

export function casePlatformLabel(value: string | undefined, t: Translate): string {
  const labels: Record<string, string> = {
    "抖音": t("抖音", "Douyin"),
    "小红书": t("小红书", "Xiaohongshu"),
    "视频号": t("视频号", "WeChat Channels"),
    "微信": t("微信", "WeChat"),
    "B站": t("B站", "Bilibili"),
    "微博": t("微博", "Weibo"),
    "快手": t("快手", "Kuaishou"),
    "其他": t("其他", "Other"),
    "待确认": t("待确认", "Unconfirmed"),
  };
  return value ? labels[value] || value : t("待确认", "Unconfirmed");
}

export default function CaseCard({
  item,
  is_favorited = false,
  onFavorite,
  onOpen,
}: {
  item: CaseItem;
  is_favorited?: boolean;
  onFavorite?: (id: string, currently_fav: boolean) => void;
  onOpen?: (item: CaseItem) => void;
}) {
  const { t, locale } = useI18n();
  const tags = (item.tags || []).slice(0, 3);

  return (
    <article className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-950">
      <button type="button" onClick={() => onOpen?.(item)} className="block w-full text-left" aria-label={t("查看案例：{title}", "View case: {title}", { title: item.title })}>
        <div className="relative aspect-[4/3] overflow-hidden bg-slate-100 dark:bg-slate-900">
          {item.cover_url ? (
            <Image
              src={item.cover_url}
              alt={item.title}
              fill
              unoptimized
              sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            />
          ) : item.video_url ? (
            <video src={item.video_url} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" muted playsInline preload="metadata" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm text-slate-500 dark:bg-slate-900">
              {t("待补充封面", "No cover image yet")}
            </div>
          )}
          <div className="absolute left-3 top-3 flex gap-2">
            <span className="rounded bg-white/90 px-2 py-1 text-xs font-medium text-slate-700 shadow-sm dark:bg-slate-950/85 dark:text-slate-200">
              {casePlatformLabel(item.platform || item.source, t)}
            </span>
            <span className="rounded bg-slate-950/80 px-2 py-1 text-xs font-medium text-white">
              {contentTypeLabel(item.content_type, t)}
            </span>
          </div>
        </div>
      </button>

      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <button type="button" onClick={() => onOpen?.(item)} className="min-w-0 flex-1 text-left">
            <h3 className="line-clamp-2 text-base font-semibold leading-snug text-slate-950 dark:text-white">{item.title}</h3>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onFavorite?.(item.id, is_favorited);
            }}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition ${
              is_favorited
                ? "border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-700 dark:bg-amber-950/40"
                : "border-slate-200 text-slate-400 hover:border-amber-300 hover:text-amber-600 dark:border-slate-800"
            }`}
            aria-label={is_favorited ? t("取消收藏", "Remove from favorites") : t("收藏案例", "Add to favorites")}
            title={is_favorited ? t("取消收藏", "Remove from favorites") : t("收藏案例", "Add to favorites")}
          >
            <svg className="h-5 w-5" fill={is_favorited ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.5a.58.58 0 0 1 1.04 0l2.24 4.54a.58.58 0 0 0 .44.32l5.01.73a.58.58 0 0 1 .32.99l-3.63 3.53a.58.58 0 0 0-.17.51l.86 4.99a.58.58 0 0 1-.84.61l-4.48-2.36a.58.58 0 0 0-.54 0l-4.48 2.36a.58.58 0 0 1-.84-.61l.86-4.99a.58.58 0 0 0-.17-.51L3.47 10.08a.58.58 0 0 1 .32-.99l5.01-.73a.58.58 0 0 0 .44-.32L11.48 3.5Z" />
            </svg>
          </button>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span>{item.industry || t("待确认行业", "Industry unconfirmed")}</span>
          <span className="flex items-center gap-3">
            <span>{t("赞", "Likes")} {formatNumber(item.likes, locale, t)}</span>
            <span>{t("藏", "Saves")} {formatNumber(item.favorites_count, locale, t)}</span>
            <span>{t("评", "Comments")} {formatNumber(item.comments, locale, t)}</span>
          </span>
        </div>
      </div>
    </article>
  );
}
