"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { isLocale } from "@/i18n/locale";
import { localizeErrorMessage } from "@/i18n/errors";
import InlineIcon from "@/components/redesign/InlineIcon";

export default function SettingsPage() {
  const { user, loading, updateUser } = useAuth();
  const { locale, setLocale, t, persistenceError } = useI18n();
  const { showError } = useToast();
  const router = useRouter();

  const [nickname, set_nickname] = useState("");
  const [avatar_url, set_avatar_url] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [saving_profile, set_saving_profile] = useState(false);
  const [profile_msg, set_profile_msg] = useState<string | null>(null);

  const feedbackText = (message: string) => {
    const messages: Record<string, string> = {
      "保存成功": "Saved successfully",
      "保存失败": "Could not save your profile",
    };
    return messages[message] ? t(message, messages[message]) : localizeErrorMessage(message, locale);
  };

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user) {
      set_nickname(user.nickname || "");
      set_avatar_url(user.avatar_url || "");
    }
  }, [user]);

  useEffect(() => {
    if (persistenceError) {
      showError(t(
        "当前语言已切换，但浏览器未能保存偏好。请允许本地存储；刷新后可能恢复默认语言。",
        "The language changed, but the browser could not save the preference. Allow local storage to keep it after refreshing.",
      ));
    }
  }, [persistenceError, showError, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" role="status" aria-label={t("加载中", "Loading")}>
        <svg className="w-8 h-8 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!user) return null;

  const save_profile = async (e: React.FormEvent) => {
    e.preventDefault();
    set_profile_msg(null);
    set_saving_profile(true);
    try {
      await updateUser({ nickname: nickname.trim(), avatar_url: avatar_url.trim() });
      set_profile_msg("保存成功");
      setTimeout(() => set_profile_msg(null), 3000);
    } catch (err) {
      showError(feedbackText(err instanceof Error ? err.message : "保存失败"));
    } finally {
      set_saving_profile(false);
    }
  };

  const select_avatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showError(t("请选择图片文件", "Choose an image file."));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showError(t("头像图片不能超过 2 MB", "The profile image must be 2 MB or smaller."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showError(t("头像图片读取失败", "Could not read the profile image."));
    reader.onload = () => {
      if (typeof reader.result === "string") set_avatar_url(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const colors = ["bg-indigo-700", "bg-emerald-600", "bg-violet-600", "bg-amber-600", "bg-rose-600"];
  const color_index = user.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
  const initial = (user.nickname || user.username).charAt(0).toUpperCase();

  return (
    <div className="amp-redesign amp-workspace-page max-w-3xl">
      <section className="amp-workspace-card p-6 mb-5" aria-labelledby="interface-language-heading">
        <h2 id="interface-language-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 font-heading">{t("界面语言", "Interface language")}</h2>
        <select id="interface-language" value={locale} onChange={(event) => {
          if (isLocale(event.target.value)) setLocale(event.target.value);
        }} aria-label={t("选择语言", "Choose a language")} className="amp-workspace-control mt-3 w-full">
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
      </section>

      {/* Profile card */}
      <div className="amp-workspace-card p-6 mb-5">
        <form onSubmit={save_profile} className="space-y-4">
          <div className="flex items-center gap-3 mb-1">
            <span className="w-1 h-4 rounded-full bg-indigo-600" />
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 font-heading">{t("个人信息", "Profile")}</h2>
          </div>
          <div className="flex items-end gap-4 py-2">
            <button type="button" className="group relative shrink-0 rounded-full"
              aria-label={t("上传头像", "Upload profile picture")} onClick={() => avatarInputRef.current?.click()}>
              {avatar_url ? (
                <img src={avatar_url} alt="" className="h-16 w-16 rounded-full border border-slate-200 object-cover" />
              ) : (
                <span className={`flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-white ${colors[color_index]}`}>
                  {initial}
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/0 text-white opacity-0 transition group-hover:bg-slate-950/45 group-hover:opacity-100">
                <InlineIcon name="upload" className="h-5 w-5" />
              </span>
            </button>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={select_avatar} />
            <div className="min-w-0 flex-1">
              <label htmlFor="profile-nickname" className="text-xs font-semibold text-zinc-500 block mb-1.5">{t("昵称", "Display name")}</label>
              <input
                id="profile-nickname"
                type="text" value={nickname} onChange={e => set_nickname(e.target.value)}
                className="amp-workspace-control w-full"
              />
            </div>
            <button type="submit" disabled={saving_profile} className="amp-button amp-button-primary shrink-0">
              {saving_profile ? t("保存中...", "Saving...") : t("保存", "Save")}
            </button>
          </div>
          {profile_msg && (
            <div className="p-3 rounded-xl text-sm bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200/50 dark:border-emerald-800/50">
              {feedbackText(profile_msg)}
            </div>
          )}
        </form>
      </div>

    </div>
  );
}
