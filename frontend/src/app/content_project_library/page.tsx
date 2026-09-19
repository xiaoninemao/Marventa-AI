"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { delete_project_media, fetch_content_projects, upload_project_media } from "@/services/api_client";
import type { ContentProject } from "@/types/publishing";

type PendingAsset = {
  id: string;
  file: File;
  kind: "image" | "video";
  url: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8765";

function mediaUrl(url: string) {
  if (!url) return "";
  return url.startsWith("http") ? url : `${API_BASE}${url}`;
}

export default function ContentProjectLibraryPage() {
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [activeProject, setActiveProject] = useState<ContentProject | null>(null);
  const [pendingAssets, setPendingAssets] = useState<PendingAsset[]>([]);
  const pendingAssetsRef = useRef<PendingAsset[]>([]);
  const [accountFilter, setAccountFilter] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/");
  }, [loading, router, user]);

  const loadProjects = async () => {
    const res = await fetch_content_projects(accountFilter);
    setProjects(res.data || []);
  };

  const loadProjectData = useEffectEvent(() => {
    if (user) loadProjects().catch(() => showError(t("内容项目库读取失败", "Failed to load Content Projects")));
  });

  useEffect(() => {
    loadProjectData();
  }, [accountFilter, user]);

  useEffect(() => {
    pendingAssetsRef.current = pendingAssets;
  }, [pendingAssets]);

  useEffect(() => {
    return () => pendingAssetsRef.current.forEach((asset) => URL.revokeObjectURL(asset.url));
  }, []);

  const accounts = useMemo(() => {
    const names = new Set(projects.map((item) => item.xhs_account).filter(Boolean));
    return Array.from(names);
  }, [projects]);

  const chooseFiles = (files: FileList | null) => {
    if (!files) return;
    const savedImages = activeProject?.media_assets.filter((asset) => asset.kind === "image").length || 0;
    const savedVideos = activeProject?.media_assets.filter((asset) => asset.kind === "video").length || 0;
    let imageCount = savedImages + pendingAssets.filter((asset) => asset.kind === "image").length;
    let videoCount = savedVideos + pendingAssets.filter((asset) => asset.kind === "video").length;
    const next: PendingAsset[] = [];

    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) {
        if (imageCount >= 18) return;
        imageCount += 1;
        next.push({ id: crypto.randomUUID(), file, kind: "image", url: URL.createObjectURL(file) });
      } else if (file.type.startsWith("video/")) {
        if (videoCount >= 1) return;
        videoCount += 1;
        next.push({ id: crypto.randomUUID(), file, kind: "video", url: URL.createObjectURL(file) });
      }
    });

    setPendingAssets((items) => [...items, ...next]);
    if (imageCount >= 18 || videoCount >= 1) setMessage(t("已按限制保留：图片最多 18 张，视频最多 1 个", "Selection limited to 18 images and 1 video"));
  };

  const removePending = (id: string) => {
    setPendingAssets((items) => {
      const target = items.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return items.filter((item) => item.id !== id);
    });
  };

  const savePending = async () => {
    if (!activeProject || pendingAssets.length === 0) return;
    setSaving(true);
    try {
      const images = pendingAssets.filter((asset) => asset.kind === "image").map((asset) => asset.file);
      const video = pendingAssets.find((asset) => asset.kind === "video")?.file || null;
      const res = await upload_project_media(activeProject.id, images, video);
      if (res.success) {
        pendingAssets.forEach((asset) => URL.revokeObjectURL(asset.url));
        setPendingAssets([]);
        setActiveProject(res.data);
        setProjects((items) => items.map((item) => item.id === res.data.id ? res.data : item));
        setMessage(t("素材已保存", "Assets saved"));
      }
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("素材保存失败", "Failed to save assets"), locale));
    } finally {
      setSaving(false);
    }
  };

  const removeSaved = async (project: ContentProject, mediaId: string) => {
    setSaving(true);
    try {
      const res = await delete_project_media(project.id, mediaId);
      if (res.success) {
        setActiveProject(res.data);
        setProjects((items) => items.map((item) => item.id === res.data.id ? res.data : item));
        setMessage(t("素材已删除", "Asset deleted"));
      }
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("删除失败", "Deletion failed"), locale));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="amp-redesign amp-workspace-page">
      <div className="amp-workspace-header amp-workspace-header-actions-only">
        <label className="text-sm text-slate-500 dark:text-slate-300">
          {t("小红书账号筛选", "Filter by Xiaohongshu account")}
          <input
            list="xhs-accounts"
            value={accountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
            placeholder={t("输入账号名称", "Enter an account name")}
            className="amp-workspace-control ml-2"
          />
          <datalist id="xhs-accounts">
            {accounts.map((account) => <option key={account} value={account} />)}
          </datalist>
        </label>
      </div>

      {message && <div className="mb-4 rounded-lg bg-cyan-50 px-4 py-3 text-sm text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">{message}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => {
          const cover = project.media_assets.find((asset) => asset.kind === "image") || project.media_assets[0];
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => {
                setActiveProject(project);
                setPendingAssets([]);
              }}
              className="amp-workspace-card p-5 text-left transition hover:border-blue-300"
            >
              <div className="mb-3 flex gap-3">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                  {cover?.url ? (
                    cover.kind === "image" ? <img src={mediaUrl(cover.url)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">{t("视频", "Video")}</div>
                  ) : <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">{t("无素材", "No assets")}</div>}
                </div>
                <div className="min-w-0">
                  <h2 className="line-clamp-2 text-lg font-semibold">{project.title}</h2>
                  <p className="mt-1 text-xs text-slate-500">{t("{assets} 个素材 · {cards} 张创作卡片", "{assets} assets · {cards} content cards", { assets: project.media_assets.length, cards: project.cards_snapshot.length })}</p>
                </div>
              </div>
              <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{t("标题：", "Title: ")}{String(project.final_snapshot.title || t("未选择", "Not selected"))}</p>
            </button>
          );
        })}
      </div>

      {activeProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="amp-workspace-dialog max-h-[88vh] w-full max-w-6xl overflow-y-auto bg-white p-6 dark:bg-slate-950">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">{activeProject.title}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{t("视频只能保存 1 个，图片最多保存 18 张，第一张图片作为封面。", "Save up to 1 video and 18 images. The first image is used as the cover.")}</p>
              </div>
              <button type="button" onClick={() => setActiveProject(null)} className="amp-button amp-button-ghost">{t("关闭", "Close")}</button>
            </div>

            <section className="mb-5 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold">{t("上传图片/视频", "Upload images / video")}</h3>
                <div className="flex gap-2">
                  <label className="amp-button amp-button-secondary cursor-pointer">
                    {t("图片工厂", "Image Factory")}
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => chooseFiles(event.target.files)} />
                  </label>
                  <label className="amp-button amp-button-secondary cursor-pointer">
                    {t("添加素材", "Add assets")}
                    <input type="file" accept="image/*,video/mp4" multiple className="hidden" onChange={(event) => chooseFiles(event.target.files)} />
                  </label>
                  <button type="button" onClick={savePending} disabled={saving || pendingAssets.length === 0} className="amp-button amp-button-primary">
                    {t("保存", "Save")}
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {activeProject.media_assets.map((asset, index) => (
                  <div key={asset.id} className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                    <div className="aspect-square bg-slate-100 dark:bg-slate-800">
                      {asset.kind === "image" ? <img src={mediaUrl(asset.url)} alt={asset.name} className="h-full w-full object-cover" /> : <video src={mediaUrl(asset.url)} className="h-full w-full object-cover" controls />}
                    </div>
                    <div className="truncate px-2 py-1 text-xs text-slate-500">{index === 0 && asset.kind === "image" ? t("封面 · ", "Cover · ") : ""}{asset.name}</div>
                    <button type="button" onClick={() => removeSaved(activeProject, asset.id)} className="absolute right-1 top-1 rounded bg-black/60 px-2 py-1 text-xs text-white">{t("删除", "Delete")}</button>
                  </div>
                ))}
                {pendingAssets.map((asset) => (
                  <div key={asset.id} className="relative overflow-hidden rounded-lg border border-dashed border-cyan-300 bg-cyan-50 dark:bg-cyan-950">
                    <div className="aspect-square">
                      {asset.kind === "image" ? <img src={asset.url} alt={asset.file.name} className="h-full w-full object-cover" /> : <video src={asset.url} className="h-full w-full object-cover" controls />}
                    </div>
                    <div className="truncate px-2 py-1 text-xs text-cyan-700 dark:text-cyan-200">{t("待保存 ·", "Unsaved · ")} {asset.file.name}</div>
                    <button type="button" onClick={() => removePending(asset.id)} className="absolute right-1 top-1 rounded bg-black/60 px-2 py-1 text-xs text-white">{t("删除", "Delete")}</button>
                  </div>
                ))}
                <label aria-label={t("添加素材", "Add assets")} className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 text-4xl text-slate-400 transition hover:border-cyan-300 hover:text-cyan-600 dark:border-slate-700">
                  +
                  <input type="file" aria-label={t("添加素材", "Add assets")} accept="image/*,video/mp4" multiple className="hidden" onChange={(event) => chooseFiles(event.target.files)} />
                </label>
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <h3 className="mb-3 font-semibold">{t("最终发布快照", "Final publishing snapshot")}</h3>
                <div className="space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  <p>{t("标题：", "Title: ")}{String(activeProject.final_snapshot.title || "")}</p>
                  <p className="whitespace-pre-wrap">{t("正文：", "Body: ")}{String(activeProject.final_snapshot.body || "")}</p>
                  <p>{t("标签：", "Tags: ")}{String(activeProject.final_snapshot.tags || "")}</p>
                </div>
              </section>
              <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <h3 className="mb-3 font-semibold">{t("智能创作卡片", "Content Studio cards")}</h3>
                <div className="space-y-3">
                  {activeProject.cards_snapshot.map((card) => (
                    <details key={card.id} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                      <summary className="cursor-pointer text-sm font-semibold">{card.title}</summary>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{card.content}</p>
                    </details>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
