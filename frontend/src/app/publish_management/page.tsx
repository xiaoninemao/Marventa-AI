"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import type { Locale, Translate } from "@/i18n/locale";
import {
  create_manual_content_project,
  create_publish_task,
  create_publish_task_from_project,
  execute_publish_task,
  fetch_content_projects,
  fetch_publish_metric,
  fetch_publish_review_result,
  fetch_publish_tasks,
  fetch_sessions,
  fetch_social_accounts,
  generate_publish_review,
  save_content_project,
  save_publish_metric,
  update_publish_task,
} from "@/services/api_client";
import type { ContentCard, SessionRecord } from "@/types/content_generator";
import type { ContentProject, PublishMetric, PublishReview, PublishStatus, PublishTask, SocialAccount } from "@/types/publishing";

type MainTab = "tasks" | "review";
type DetailTab = "content" | "config" | "result" | "review";
type CreateSource = "smart" | "project" | "manual";

const getStatusColumns = (t: Translate): Array<{ key: PublishStatus; label: string }> => [
  { key: "pending_publish", label: t("待发布", "Ready to publish") },
  { key: "scheduled", label: t("已排期", "Scheduled") },
  { key: "publishing", label: t("发布中", "Publishing") },
  { key: "published_pending_data", label: t("已发布待复盘", "Published · Awaiting review") },
  { key: "reviewed", label: t("已复盘", "Reviewed") },
  { key: "archived", label: t("已归档", "Archived") },
];

const getSlotConfig = (t: Translate) => [
  { key: "title", label: t("标题版本", "Title version"), type: "title" },
  { key: "body", label: t("正文版本", "Body version"), type: "copy" },
  { key: "cover", label: t("封面文案", "Cover copy"), type: "visual" },
  { key: "tags", label: t("标签版本", "Tag version"), type: "hashtags" },
  { key: "script", label: t("图文排版/分镜", "Image post layout / Storyboard"), type: "script" },
];

const getDetailTabs = (t: Translate): Array<{ key: DetailTab; label: string }> => [
  { key: "content", label: t("内容与版本", "Content & versions") },
  { key: "config", label: t("发布配置", "Publishing settings") },
  { key: "result", label: t("发布结果", "Publishing results") },
  { key: "review", label: t("效果复盘", "Performance review") },
];

const getMetricLabels = (t: Translate): Array<{ key: keyof MetricDraft; label: string; suffix?: string }> => [
  { key: "views", label: t("浏览量/播放量", "Views / Plays") },
  { key: "likes", label: t("点赞", "Likes") },
  { key: "collects", label: t("收藏", "Saves") },
  { key: "comments", label: t("评论", "Comments") },
  { key: "shares", label: t("转发", "Shares") },
  { key: "followers", label: t("涨粉", "New followers") },
  { key: "leads", label: t("线索", "Leads") },
  { key: "completion_rate", label: t("完播率", "Completion rate"), suffix: "%" },
];

type MetricDraft = {
  views: number;
  likes: number;
  collects: number;
  comments: number;
  shares: number;
  followers: number;
  leads: number;
  completion_rate: number;
};

const emptyMetric: MetricDraft = {
  views: 0,
  likes: 0,
  collects: 0,
  comments: 0,
  shares: 0,
  followers: 0,
  leads: 0,
  completion_rate: 0,
};

const emptyManualDraft = {
  title: "",
  body: "",
  tags: "",
  platform: "xiaohongshu",
  content_type: "image_text",
  account_name: "",
};

function normalizeStatus(status: string): PublishStatus {
  if (status === "pending_version_selection") return "pending_publish";
  if (status === "reusable") return "archived";
  if (["pending_publish", "scheduled", "publishing", "published_pending_data", "reviewed", "archived"].includes(status)) return status as PublishStatus;
  return "pending_publish";
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function cardsByType(cards: ContentCard[], type: string) {
  const matched = cards.filter((card) => card.card_type === type);
  return matched.length > 0 ? matched : cards;
}

function cardText(card?: ContentCard) {
  return card?.content || card?.preview || card?.title || "";
}

function buildSnapshot(task: PublishTask, selected: Record<string, string>) {
  const byId = Object.fromEntries(task.original_cards.map((card) => [card.id, card]));
  const title = byId[selected.title] || task.original_cards.find((card) => card.card_type === "title");
  const body = byId[selected.body] || task.original_cards.find((card) => card.card_type === "copy");
  const cover = byId[selected.cover] || task.original_cards.find((card) => card.card_type === "visual");
  const tags = byId[selected.tags] || task.original_cards.find((card) => card.card_type === "hashtags");
  const script = byId[selected.script] || task.original_cards.find((card) => card.card_type === "script");
  return {
    ...task.final_snapshot,
    title: title?.title || title?.content || "",
    body: cardText(body),
    cover_text: cardText(cover),
    tags: cardText(tags),
    script: cardText(script),
    selected_card_ids: selected,
  };
}

function buildSnapshotFromCards(cards: ContentCard[], selected: Record<string, string> = {}, sourceTitle = "") {
  const byId = Object.fromEntries(cards.map((card) => [card.id, card]));
  const pick = (slot: string, type: string) => byId[selected[slot]] || cards.find((card) => card.card_type === type);
  const title = pick("title", "title");
  const body = pick("body", "copy");
  const cover = pick("cover", "visual");
  const tags = pick("tags", "hashtags");
  const script = pick("script", "script");
  return {
    source_title: sourceTitle,
    title: title?.title || title?.content || sourceTitle || "",
    body: cardText(body),
    cover_text: cardText(cover),
    tags: cardText(tags),
    script: cardText(script),
    selected_card_ids: selected,
  };
}

function defaultSelection(cards: ContentCard[]) {
  const pick = (type: string) => cards.find((card) => card.card_type === type)?.id || "";
  return {
    title: pick("title"),
    body: pick("copy"),
    cover: pick("visual"),
    tags: pick("hashtags"),
    script: pick("script"),
  };
}

function metricFromResponse(metric: PublishMetric | null | undefined): MetricDraft {
  if (!metric) return emptyMetric;
  return {
    views: metric.views || 0,
    likes: metric.likes || 0,
    collects: metric.collects || 0,
    comments: metric.comments || 0,
    shares: metric.shares || 0,
    followers: metric.followers || 0,
    leads: metric.leads || 0,
    completion_rate: metric.completion_rate || 0,
  };
}

function metricSummary(t: Translate, metric?: PublishMetric | null) {
  if (!metric) return t("待录入数据", "Awaiting metrics");
  return t("{views} 播放 / {likes} 赞 / {collects} 收藏", "{views} views / {likes} likes / {collects} saves", {
    views: metric.views || 0, likes: metric.likes || 0, collects: metric.collects || 0,
  });
}

function platformLabel(platform: string, t: Translate) {
  if (platform === "douyin") return t("抖音", "Douyin");
  if (platform === "xiaohongshu") return t("小红书", "Xiaohongshu");
  return platform;
}

function contentTypeLabel(contentType: string, t: Translate) {
  if (contentType === "image_text") return t("图文", "Image post");
  if (contentType === "video") return t("视频", "Video");
  return contentType || t("图文/视频", "Image post / Video");
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale === "en" ? "en-US" : "zh-CN");
}

export default function PublishManagementPage() {
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const statusColumns = getStatusColumns(t);
  const router = useRouter();
  const { user, loading } = useAuth();
  const [mainTab, setMainTab] = useState<MainTab>("tasks");
  const [statusFilter, setStatusFilter] = useState<PublishStatus | "all">("all");
  const [detailTab, setDetailTab] = useState<DetailTab>("content");
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [metrics, setMetrics] = useState<Record<string, PublishMetric | null>>({});
  const [reviews, setReviews] = useState<Record<string, PublishReview | null>>({});
  const [metricDraft, setMetricDraft] = useState<MetricDraft>(emptyMetric);
  const [activeTaskId, setActiveTaskId] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createSource, setCreateSource] = useState<CreateSource>("project");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [createPlatform, setCreatePlatform] = useState("xiaohongshu");
  const [createContentType, setCreateContentType] = useState("image_text");
  const [createAccountName, setCreateAccountName] = useState("");
  const [manualDraft, setManualDraft] = useState({ ...emptyManualDraft });

  useEffect(() => {
    if (!loading && !user) router.push("/");
  }, [loading, router, user]);

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "review") setMainTab("review");
  }, []);

  const loadTasks = async () => {
    const res = await fetch_publish_tasks();
    if (res.success) {
      const normalized = res.data.map((item) => ({ ...item, status: normalizeStatus(item.status) }));
      setTasks(normalized);
      setActiveTaskId((current) => current || normalized[0]?.id || "");
    }
  };

  const loadAccounts = async (platform = "") => {
    const res = await fetch_social_accounts(platform);
    if (res.success) setAccounts(res.data);
  };

  const loadCreateSources = async () => {
    const [sessionRes, projectRes] = await Promise.all([
      fetch_sessions().catch(() => null),
      fetch_content_projects().catch(() => null),
    ]);
    if (sessionRes?.success) {
      const ready = sessionRes.data.filter((session) => session.cards.length > 0);
      setSessions(ready);
      setSelectedSessionId((current) => current || ready[0]?.id || "");
    }
    if (projectRes?.success) {
      setProjects(projectRes.data);
      setSelectedProjectId((current) => current || projectRes.data[0]?.id || "");
    }
  };

  const loadMetricAndReview = async (taskId: string) => {
    const [metricRes, reviewRes] = await Promise.all([
      fetch_publish_metric(taskId).catch(() => null),
      fetch_publish_review_result(taskId).catch(() => null),
    ]);
    if (metricRes?.success) {
      setMetrics((items) => ({ ...items, [taskId]: metricRes.data }));
      setMetricDraft(metricFromResponse(metricRes.data));
    } else {
      setMetricDraft(emptyMetric);
    }
    if (reviewRes?.success) setReviews((items) => ({ ...items, [taskId]: reviewRes.data }));
  };

  const loadPublishingData = useEffectEvent(() => {
    if (!user) return;
    loadTasks().catch(() => showError(t("发布任务读取失败", "Failed to load publishing tasks")));
    loadAccounts().catch(() => showError(t("账号读取失败", "Failed to load accounts")));
  });

  useEffect(() => {
    loadPublishingData();
  }, [user]);

  const filteredTasks = useMemo(
    () => statusFilter === "all" ? tasks : tasks.filter((task) => task.status === statusFilter),
    [statusFilter, tasks],
  );
  const reviewTasks = useMemo(
    () => tasks.filter((task) => ["published_pending_data", "reviewed", "archived"].includes(task.status)),
    [tasks],
  );
  const activeTask = useMemo(() => {
    const pool = mainTab === "tasks" ? filteredTasks : reviewTasks;
    return pool.find((task) => task.id === activeTaskId) || pool[0];
  }, [activeTaskId, filteredTasks, mainTab, reviewTasks]);

  const selectStatus = (status: PublishStatus | "all") => {
    setStatusFilter(status);
    const first = status === "all" ? tasks[0] : tasks.find((task) => task.status === status);
    if (first) setActiveTaskId(first.id);
  };

  useEffect(() => {
    if (!activeTask) return;
    loadAccounts(activeTask.platform).catch(() => {});
    loadMetricAndReview(activeTask.id).catch(() => {});
    setDetailTab(mainTab === "review" ? "review" : "content");
  }, [activeTask?.id, activeTask?.platform, mainTab]);

  const updateTask = async (id: string, payload: Parameters<typeof update_publish_task>[1]) => {
    setSaving(true);
    try {
      const res = await update_publish_task(id, payload);
      if (res.success) {
        setTasks((items) => items.map((item) => item.id === id ? { ...res.data, status: normalizeStatus(res.data.status) } : item));
        setToast(t("已保存", "Saved"));
      }
    } finally {
      setSaving(false);
      window.setTimeout(() => setToast(""), 1800);
    }
  };

  const updateSnapshotField = async (task: PublishTask, field: string, value: string) => {
    await updateTask(task.id, { final_snapshot: { ...task.final_snapshot, [field]: value } });
  };

  const applySelection = async (task: PublishTask, selected: Record<string, string>) => {
    await updateTask(task.id, {
      selected_version_ids: selected,
      final_snapshot: buildSnapshot(task, selected),
      status: normalizeStatus(task.status),
    });
  };

  const publish = async (task: PublishTask, dryRun = false) => {
    setSaving(true);
    try {
      await execute_publish_task(task.id, dryRun);
      await loadTasks();
      setDetailTab("result");
      setToast(dryRun ? t("发布窗口已打开，请在平台页面检查，关闭窗口后状态会更新", "The publishing window is open. Check the platform page; the status will update when you close the window.") : t("发布窗口已打开，请在平台页面完成确认", "The publishing window is open. Complete confirmation on the platform page."));
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("发布失败", "Publishing failed"), locale));
    } finally {
      setSaving(false);
      window.setTimeout(() => setToast(""), 2400);
    }
  };

  const saveMetric = async (task: PublishTask) => {
    setSaving(true);
    try {
      const res = await save_publish_metric(task.id, metricDraft);
      if (res.success) {
        setMetrics((items) => ({ ...items, [task.id]: res.data }));
        await updateTask(task.id, { status: "published_pending_data" });
        setToast(t("数据已保存，可进行 AI 复盘", "Metrics saved. You can now run an AI review."));
      }
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("数据保存失败", "Failed to save metrics"), locale));
    } finally {
      setSaving(false);
    }
  };

  const runReview = async (task: PublishTask) => {
    setSaving(true);
    try {
      const res = await generate_publish_review(task.id, true);
      if (res.success) {
        await loadMetricAndReview(task.id);
        await loadTasks();
        setToast(t("AI 复盘已生成，并可写入账号记忆库", "AI review generated and ready to add to Account Memory"));
      }
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("AI 复盘失败", "AI review failed"), locale));
    } finally {
      setSaving(false);
      window.setTimeout(() => setToast(""), 2400);
    }
  };

  const selectTask = (id: string, tab: MainTab = mainTab) => {
    setActiveTaskId(id);
    setMainTab(tab);
  };

  const openCreateTask = async () => {
    setShowCreate(true);
    setToast("");
    await loadCreateSources();
  };

  const createTaskDraft = async () => {
    setSaving(true);
    setToast("");
    try {
      let task: PublishTask | null = null;
      if (createSource === "smart") {
        const sourceSession = sessions.find((session) => session.id === selectedSessionId);
        if (!sourceSession) throw new Error(t("请选择智能创作结果", "Select a Content Studio result"));
        const selected = defaultSelection(sourceSession.cards);
        const project = await save_content_project({
          source_session_id: sourceSession.id,
          title: sourceSession.title || "智能创作发布草稿",
          content_type: createContentType,
          platform_hint: createPlatform,
        });
        const res = await create_publish_task({
          source_session_id: sourceSession.id,
          project_id: project.data.id,
          platform: createPlatform,
          account_name: createAccountName,
          content_type: createContentType,
          selected_version_ids: selected,
          final_snapshot: buildSnapshotFromCards(sourceSession.cards, selected, sourceSession.title),
        });
        task = res.data;
      } else if (createSource === "project") {
        if (!selectedProjectId) throw new Error(t("请选择内容项目", "Select a content project"));
        const res = await create_publish_task_from_project({
          project_id: selectedProjectId,
          platform: createPlatform,
          account_name: createAccountName,
          content_type: createContentType,
        });
        task = res.data;
      } else {
        const finalSnapshot = {
          title: manualDraft.title,
          body: manualDraft.body,
          tags: manualDraft.tags,
        };
        const project = await create_manual_content_project({
          title: manualDraft.title || "手动创作发布草稿",
          platform_hint: manualDraft.platform,
          content_type: manualDraft.content_type,
          final_snapshot: finalSnapshot,
          notes: "发布管理手动创建",
        });
        const res = await create_publish_task_from_project({
          project_id: project.data.id,
          platform: manualDraft.platform,
          account_name: manualDraft.account_name,
          content_type: manualDraft.content_type,
        });
        task = res.data;
      }
      await loadTasks();
      if (task) setActiveTaskId(task.id);
      setShowCreate(false);
      setMainTab("tasks");
      setDetailTab("config");
      setToast(t("发布草稿已创建", "Publishing draft created"));
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("创建发布任务失败", "Failed to create publishing task"), locale));
    } finally {
      setSaving(false);
    }
  };

  const activeMetric = activeTask ? metrics[activeTask.id] : null;
  const activeReview = activeTask ? reviews[activeTask.id] : null;

  return (
    <div className="amp-redesign amp-workspace-page">
      <div className="amp-workspace-command-bar">
        <div className="amp-workspace-tabs" role="tablist">
          {[
            { key: "tasks" as MainTab, label: t("发布任务", "Publishing tasks") },
            { key: "review" as MainTab, label: t("效果复盘", "Performance review") },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              onClick={() => setMainTab(tab.key)}
              aria-selected={mainTab === tab.key}
              className={`amp-workspace-tab ${mainTab === tab.key ? "amp-workspace-tab-active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="amp-workspace-actions">
          <div className="text-sm text-emerald-600">{toast || (saving ? t("处理中...", "Processing...") : "")}</div>
          <button type="button" onClick={openCreateTask} className="amp-button amp-button-primary">
            {t("新建发布任务", "New publishing task")}
          </button>
          <button type="button" onClick={() => router.push("/account_memory")} className="amp-button amp-button-secondary">
            {t("账号记忆库绑定账号", "Link accounts in Account Memory")}
          </button>
        </div>
      </div>

      {mainTab === "tasks" ? (
        <div>
          <div className="amp-publish-status-bar" role="group" aria-label={t("按状态筛选", "Filter by status")}>
            <button type="button" onClick={() => selectStatus("all")}
              className={`amp-publish-status-filter ${statusFilter === "all" ? "amp-publish-status-filter-active" : ""}`}>
              <span>{t("全部", "All")}</span><strong>{tasks.length}</strong>
            </button>
            {statusColumns.map((column) => (
              <button key={column.key} type="button" onClick={() => selectStatus(column.key)}
                className={`amp-publish-status-filter ${statusFilter === column.key ? "amp-publish-status-filter-active" : ""}`}>
                <span>{column.label}</span>
                <strong>{tasks.filter((task) => task.status === column.key).length}</strong>
              </button>
            ))}
          </div>

          <div className="amp-publish-main-grid grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
            <section className="amp-workspace-card flex min-h-0 flex-col p-3">
              <div className="amp-workspace-section-header px-1 pt-1">
                <h2 className="amp-workspace-section-title">{t("任务列表", "Task list")}</h2>
                <span className="text-xs text-slate-400">{filteredTasks.length}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {filteredTasks.map((task) => (
                  <button key={task.id} type="button" onClick={() => selectTask(task.id, "tasks")}
                    className={`amp-publish-task-item ${activeTask?.id === task.id ? "amp-publish-task-item-active" : ""}`}>
                    <div className="line-clamp-2 text-sm font-semibold text-slate-900">{text(task.final_snapshot.title) || t("未命名发布任务", "Untitled publishing task")}</div>
                    <div className="mt-2 text-xs text-slate-500">{platformLabel(task.platform, t)} · {contentTypeLabel(task.content_type, t)}</div>
                    <div className="mt-1 truncate text-xs text-slate-400">
                      {task.account_name || t("未选择账号", "No account selected")}
                      <span className="mx-1.5">·</span>
                      {task.planned_publish_at ? formatDate(task.planned_publish_at, locale) : t("未排期", "Not scheduled")}
                    </div>
                  </button>
                ))}
                {filteredTasks.length === 0 && (
                  <div className="flex h-full min-h-60 items-center justify-center px-6 text-center text-sm text-slate-400">
                    {t("当前状态下暂无发布任务", "No publishing tasks in this status")}
                  </div>
                )}
              </div>
            </section>
            <TaskDetail
              task={activeTask}
              accounts={accounts}
              detailTab={detailTab}
              setDetailTab={setDetailTab}
              updateTask={updateTask}
              updateSnapshotField={updateSnapshotField}
              applySelection={applySelection}
              publish={publish}
            />
          </div>
        </div>
      ) : (
        <div className="amp-publish-main-grid grid gap-4 xl:grid-cols-[minmax(360px,0.75fr)_minmax(560px,1.25fr)]">
          <section className="amp-workspace-card min-h-0 overflow-y-auto p-4">
            <h2 className="mb-3 text-lg font-semibold">{t("待复盘内容", "Content to review")}</h2>
            <div className="space-y-2">
              {reviewTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => selectTask(task.id, "review")}
                  className={`w-full rounded-lg border p-3 text-left transition ${activeTask?.id === task.id ? "border-cyan-400 bg-cyan-50 dark:bg-cyan-950" : "border-slate-200 hover:border-cyan-300 dark:border-slate-800"}`}
                >
                  <div className="font-semibold">{text(task.final_snapshot.title) || t("未命名内容", "Untitled content")}</div>
                  <div className="mt-1 text-xs text-slate-500">{platformLabel(task.platform, t)} · {metricSummary(t, metrics[task.id])}</div>
                </button>
              ))}
            </div>
          </section>
          <ReviewPanel
            task={activeTask}
            metricDraft={metricDraft}
            setMetricDraft={setMetricDraft}
            metric={activeMetric}
            review={activeReview}
            saveMetric={saveMetric}
            runReview={runReview}
          />
        </div>
      )}

      {showCreate && (
        <CreateTaskModal
          source={createSource}
          setSource={setCreateSource}
          sessions={sessions}
          projects={projects}
          selectedSessionId={selectedSessionId}
          setSelectedSessionId={setSelectedSessionId}
          selectedProjectId={selectedProjectId}
          setSelectedProjectId={setSelectedProjectId}
          platform={createPlatform}
          setPlatform={(value) => {
            setCreatePlatform(value);
            loadAccounts(value).catch(() => {});
          }}
          contentType={createContentType}
          setContentType={setCreateContentType}
          accountName={createAccountName}
          setAccountName={setCreateAccountName}
          accounts={accounts}
          manualDraft={manualDraft}
          setManualDraft={setManualDraft}
          saving={saving}
          onCreate={createTaskDraft}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

function CreateTaskModal(props: {
  source: CreateSource;
  setSource: (source: CreateSource) => void;
  sessions: SessionRecord[];
  projects: ContentProject[];
  selectedSessionId: string;
  setSelectedSessionId: (id: string) => void;
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  platform: string;
  setPlatform: (platform: string) => void;
  contentType: string;
  setContentType: (type: string) => void;
  accountName: string;
  setAccountName: (name: string) => void;
  accounts: SocialAccount[];
  manualDraft: typeof emptyManualDraft;
  setManualDraft: (draft: typeof emptyManualDraft) => void;
  saving: boolean;
  onCreate: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const {
    source,
    setSource,
    sessions,
    projects,
    selectedSessionId,
    setSelectedSessionId,
    selectedProjectId,
    setSelectedProjectId,
    platform,
    setPlatform,
    contentType,
    setContentType,
    accountName,
    setAccountName,
    accounts,
    manualDraft,
    setManualDraft,
    saving,
    onCreate,
    onClose,
  } = props;
  const platformAccounts = accounts.filter((account) => account.platform === (source === "manual" ? manualDraft.platform : platform));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl dark:bg-slate-900">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("新建发布任务", "New publishing task")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("选择内容来源后创建草稿，可继续保存草稿、生成发布包或直接发布。", "Choose a content source to create a draft, then save it, generate a publishing package, or publish directly.")}</p>
          </div>
          <button type="button" onClick={onClose} className="amp-button amp-button-ghost">{t("关闭", "Close")}</button>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-3">
          {[
            { key: "smart" as CreateSource, title: t("从智能创作导入", "Import from Content Studio"), desc: t("选择最近生成的内容卡片", "Select recently generated content cards") },
            { key: "project" as CreateSource, title: t("从内容项目库导入", "Import from Content Projects"), desc: t("复用项目快照和素材", "Reuse project snapshots and assets") },
            { key: "manual" as CreateSource, title: t("自己创作", "Create manually"), desc: t("先保存到项目库再生成草稿", "Save to Content Projects before creating a draft") },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSource(item.key)}
              className={`rounded-lg border p-4 text-left transition ${source === item.key ? "border-cyan-400 bg-cyan-50 text-cyan-800" : "border-slate-200 bg-white hover:border-cyan-300 dark:border-slate-800 dark:bg-slate-950"}`}
            >
              <div className="font-semibold">{item.title}</div>
              <p className="mt-1 text-sm text-slate-500">{item.desc}</p>
            </button>
          ))}
        </div>

        {source !== "manual" ? (
          <div className="grid gap-3 md:grid-cols-2">
            {source === "smart" ? (
              <label className="text-sm text-slate-500">
                {t("智能创作结果", "Content Studio results")}
                <select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <option value="">{t("请选择", "Select an option")}</option>
                  {sessions.map((session) => <option key={session.id} value={session.id}>{t("{title}（{count} 张卡片）", "{title} ({count} cards)", { title: session.title || session.id, count: session.cards.length })}</option>)}
                </select>
              </label>
            ) : (
              <label className="text-sm text-slate-500">
                {t("内容项目", "Content project")}
                <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <option value="">{t("请选择", "Select an option")}</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{t("{title}（{count} 个素材）", "{title} ({count} assets)", { title: project.title, count: project.media_assets.length })}</option>)}
                </select>
              </label>
            )}
            <PublishConfigFields
              platform={platform}
              setPlatform={setPlatform}
              contentType={contentType}
              setContentType={setContentType}
              accountName={accountName}
              setAccountName={setAccountName}
              accounts={platformAccounts}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-500">
                {t("标题", "Title")}
                <input value={manualDraft.title} onChange={(event) => setManualDraft({ ...manualDraft, title: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2" />
              </label>
              <PublishConfigFields
                platform={manualDraft.platform}
                setPlatform={(value) => setManualDraft({ ...manualDraft, platform: value })}
                contentType={manualDraft.content_type}
                setContentType={(value) => setManualDraft({ ...manualDraft, content_type: value })}
                accountName={manualDraft.account_name}
                setAccountName={(value) => setManualDraft({ ...manualDraft, account_name: value })}
                accounts={platformAccounts}
              />
            </div>
            <label className="block text-sm text-slate-500">
              {t("正文", "Body")}
              <textarea value={manualDraft.body} onChange={(event) => setManualDraft({ ...manualDraft, body: event.target.value })} rows={6} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2" />
            </label>
            <label className="block text-sm text-slate-500">
              {t("话题标签", "Hashtags")}
              <input value={manualDraft.tags} onChange={(event) => setManualDraft({ ...manualDraft, tags: event.target.value })} placeholder={t("#新品 #测评", "#NewProduct #Review")} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2" />
            </label>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="amp-button amp-button-secondary">{t("取消", "Cancel")}</button>
          <button type="button" onClick={onCreate} disabled={saving} className="amp-button amp-button-primary">{t("保存为草稿", "Save as draft")}</button>
        </div>
      </div>
    </div>
  );
}

function PublishConfigFields(props: {
  platform: string;
  setPlatform: (platform: string) => void;
  contentType: string;
  setContentType: (type: string) => void;
  accountName: string;
  setAccountName: (name: string) => void;
  accounts: SocialAccount[];
}) {
  const { t } = useI18n();
  return (
    <>
      <label className="text-sm text-slate-500">
        {t("平台", "Platform")}
        <select value={props.platform} onChange={(event) => props.setPlatform(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2">
          <option value="xiaohongshu">{t("小红书", "Xiaohongshu")}</option>
          <option value="douyin">{t("抖音", "Douyin")}</option>
        </select>
      </label>
      <label className="text-sm text-slate-500">
        {t("内容类型", "Content type")}
        <select value={props.contentType} onChange={(event) => props.setContentType(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2">
          <option value="image_text">{t("图文发布", "Image post")}</option>
          <option value="video">{t("视频发布", "Video post")}</option>
        </select>
      </label>
      <label className="text-sm text-slate-500">
        {t("发布账号", "Publishing account")}
        <select value={props.accountName} onChange={(event) => props.setAccountName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2">
          <option value="">{t("稍后选择账号", "Choose an account later")}</option>
          {props.accounts.map((account) => <option key={account.id} value={account.account_name}>{account.nickname || account.remark || account.account_name}</option>)}
        </select>
      </label>
    </>
  );
}

function TaskDetail(props: {
  task?: PublishTask;
  accounts: SocialAccount[];
  detailTab: DetailTab;
  setDetailTab: (tab: DetailTab) => void;
  updateTask: (id: string, payload: Parameters<typeof update_publish_task>[1]) => Promise<void>;
  updateSnapshotField: (task: PublishTask, field: string, value: string) => Promise<void>;
  applySelection: (task: PublishTask, selected: Record<string, string>) => Promise<void>;
  publish: (task: PublishTask, dryRun?: boolean) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const statusColumns = getStatusColumns(t);
  const detailTabs = getDetailTabs(t);
  const slotConfig = getSlotConfig(t);
  const { task, accounts, detailTab, setDetailTab, updateTask, updateSnapshotField, applySelection, publish } = props;
  const router = useRouter();

  if (!task) {
    return (
      <aside className="amp-workspace-card flex min-w-0 items-center justify-center border-dashed p-8 text-center text-sm text-slate-500">
        {t("暂无发布任务，请先在智能创作结果卡片中点击“选择版本并发布”。", "No publishing tasks yet. Click “Select versions and publish” on a Content Studio result card to get started.")}
      </aside>
    );
  }

  return (
    <aside className="amp-workspace-card min-w-0 overflow-y-auto p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("发布任务详情", "Publishing task details")}</h2>
          <p className="mt-1 text-xs text-slate-500">{t("任务 ID：", "Task ID: ")}{task.id}</p>
        </div>
        <select
          value={task.status}
          onChange={(event) => updateTask(task.id, { status: event.target.value as PublishStatus })}
          className="amp-workspace-control !min-h-9 py-1"
        >
          {statusColumns.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {detailTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setDetailTab(tab.key)}
            className={`amp-button ${detailTab === tab.key ? "amp-button-primary" : "amp-button-ghost"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {detailTab === "content" && (
        <section className="space-y-4">
          <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
            <div>{t("内容来源：智能创作", "Source: Content Studio ")} {task.source_session_id}</div>
            <div className="mt-1">{t("所属项目：", "Project: ")}{task.project_id || t("未关联项目", "No linked project")}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {slotConfig.map((slot) => (
              <label key={slot.key} className="block text-xs text-slate-500 dark:text-slate-300">
                {slot.label}
                <select
                  value={task.selected_version_ids?.[slot.key] || ""}
                  onChange={(event) => {
                    const selected = { ...task.selected_version_ids, [slot.key]: event.target.value };
                    applySelection(task, selected);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-cyan-950"
                >
                  <option value="">{t("未选择", "Not selected")}</option>
                  {cardsByType(task.original_cards, slot.type).map((card) => (
                    <option key={card.id} value={card.id}>{card.title}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-sm leading-6 dark:bg-slate-950">
            <div className="font-semibold">{text(task.final_snapshot.title) || t("最终标题待生成", "Final title not generated yet")}</div>
            <p className="mt-2 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{text(task.final_snapshot.body) || t("请选择正文版本", "Select a body version")}</p>
            <p className="mt-2 text-slate-500">{text(task.final_snapshot.tags)}</p>
          </div>
        </section>
      )}

      {detailTab === "config" && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-500 dark:text-slate-300">
              {t("平台", "Platform")}
              <select
                value={task.platform}
                onChange={(event) => updateTask(task.id, { platform: event.target.value, account_name: "" })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-cyan-950"
              >
                <option value="douyin">{t("抖音", "Douyin")}</option>
                <option value="xiaohongshu">{t("小红书", "Xiaohongshu")}</option>
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-300">
              {t("内容类型", "Content type")}
              <select
                value={task.content_type}
                onChange={(event) => updateTask(task.id, { content_type: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-cyan-950"
              >
                <option value="image_text">{t("图文发布", "Image post")}</option>
                <option value="video">{t("视频发布", "Video post")}</option>
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-300">
              {t("发布账号", "Publishing account")}
              <select
                value={task.account_name}
                onChange={(event) => updateTask(task.id, { account_name: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-cyan-950"
              >
                <option value="">{t("选择已绑定账号", "Select a linked account")}</option>
                {accounts.map((account) => <option key={account.id} value={account.account_name}>{account.account_name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-300">
              {t("发布时间", "Publish time")}
              <input
                type="datetime-local"
                lang={locale === "en" ? "en" : "zh-CN"}
                value={task.planned_publish_at}
                onChange={(event) => updateTask(task.id, { planned_publish_at: event.target.value, status: event.target.value ? "scheduled" : "pending_publish" })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-cyan-950"
              />
            </label>
          </div>

          {accounts.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {t("当前平台还没有绑定账号。请先到账号记忆库完成抖音/小红书账号登录保存，再回到这里选择发布账号。", "No account is linked for this platform. Sign in to Douyin or Xiaohongshu and save the account in Account Memory, then return here to select it.")}
              <button type="button" onClick={() => router.push("/account_memory")} className="ml-3 font-semibold underline">{t("去绑定", "Link account")}</button>
            </div>
          )}

          <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <h3 className="text-sm font-semibold">{t("发布内容", "Post content")}</h3>
            <label className="block text-xs text-slate-500 dark:text-slate-300">
              {t("标题", "Title")}
              <input
                value={text(task.final_snapshot.title)}
                maxLength={task.platform === "xiaohongshu" ? 100 : 55}
                onChange={(event) => updateSnapshotField(task, "title", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="block text-xs text-slate-500 dark:text-slate-300">
              {t("正文", "Body")}
              <textarea
                value={text(task.final_snapshot.body)}
                rows={6}
                onChange={(event) => updateSnapshotField(task, "body", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                {t("话题标签", "Hashtags")}
                <input
                  value={text(task.final_snapshot.tags)}
                  onChange={(event) => updateSnapshotField(task, "tags", event.target.value)}
                  placeholder={t("#新品 #测评 #生活方式", "#NewProduct #Review #Lifestyle")}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                {t("@谁", "Mentions")}
                <input
                  value={text(task.final_snapshot.mention)}
                  onChange={(event) => updateSnapshotField(task, "mention", event.target.value)}
                  placeholder={t("@品牌号 或 @达人", "@Brand or @Creator")}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>
          </div>

          {task.platform === "xiaohongshu" ? (
            <div className="grid gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-2">
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                {t("图片顺序", "Image order")}
                <input
                  value={text(task.final_snapshot.image_order)}
                  onChange={(event) => updateSnapshotField(task, "image_order", event.target.value)}
                  placeholder={t("默认使用内容项目库素材顺序", "Uses the asset order in Content Projects by default")}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                {t("发布时间建议", "Suggested publish time")}
                <input
                  value={text(task.final_snapshot.publish_suggestion)}
                  onChange={(event) => updateSnapshotField(task, "publish_suggestion", event.target.value)}
                  placeholder={t("例如 20:30-22:00", "e.g. 20:30–22:00")}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <button type="button" onClick={() => navigator.clipboard?.writeText(`${text(task.final_snapshot.title)}\n\n${text(task.final_snapshot.body)}\n${text(task.final_snapshot.tags)}`)} className="amp-button amp-button-secondary">
                {t("复制小红书正文", "Copy Xiaohongshu post text")}
              </button>
              <button type="button" onClick={() => publish(task, true)} className="amp-button amp-button-secondary">
                {t("生成发布包", "Generate publishing package")}
              </button>
            </div>
          ) : (
            <div className="grid gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-2">
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                {t("视频文件", "Video file")}
                <input
                  value={text(task.final_snapshot.video_file)}
                  onChange={(event) => updateSnapshotField(task, "video_file", event.target.value)}
                  placeholder={t("从内容项目库素材中选择或填写素材路径", "Select an asset from Content Projects or enter its path")}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                {t("封面图", "Cover image")}
                <input
                  value={text(task.final_snapshot.cover_image)}
                  onChange={(event) => updateSnapshotField(task, "cover_image", event.target.value)}
                  placeholder={t("默认使用第一张图或视频封面", "Uses the first image or video cover by default")}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                {t("审核状态", "Moderation status")}
                <input
                  value={text(task.final_snapshot.audit_status)}
                  onChange={(event) => updateSnapshotField(task, "audit_status", event.target.value)}
                  placeholder={t("待提交 / 审核中 / 已通过", "Not submitted / Under review / Approved")}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                {t("定时发布", "Scheduled publishing")}
                <input
                  value={text(task.final_snapshot.schedule_mode)}
                  onChange={(event) => updateSnapshotField(task, "schedule_mode", event.target.value)}
                  placeholder={t("立即发布或定时发布", "Publish now or schedule")}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => publish(task, true)} className="amp-button amp-button-secondary">
              {t("生成发布包", "Generate publishing package")}
            </button>
            <button type="button" onClick={() => publish(task)} className="amp-button amp-button-primary">
              {t("发布", "Publish")}
            </button>
          </div>
        </section>
      )}

      {detailTab === "result" && (
        <section className="space-y-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
          <InfoRow label={t("发布时间", "Publish time")} value={task.published_at ? formatDate(task.published_at, locale) : t("未发布", "Not published")} />
          <InfoRow label={t("发布链接", "Post URL")} value={task.publish_link || t("发布成功后自动保存，也可手动补录", "Saved automatically after publishing, or enter it manually")} />
          <InfoRow label={t("平台作品 ID", "Platform post ID")} value={task.platform_work_id || t("待回传", "Awaiting response")} />
          <InfoRow label={t("审核状态", "Moderation status")} value={text(task.final_snapshot.audit_status) || t("待提交", "Not submitted")} />
          <InfoRow label={t("失败原因", "Failure reason")} value={text(task.review?.publish_error) || t("无", "None")} />
          <InfoRow label={t("重试记录", "Retry history")} value={text(task.review?.retry_log) || t("暂无", "None yet")} />
        </section>
      )}

      {detailTab === "review" && (
        <ReviewPanel
          task={task}
          metricDraft={emptyMetric}
          setMetricDraft={() => {}}
          metric={null}
          review={null}
          saveMetric={async () => {}}
          runReview={async () => {}}
          compact
        />
      )}
    </aside>
  );
}

function ReviewPanel(props: {
  task?: PublishTask;
  metricDraft: MetricDraft;
  setMetricDraft: (draft: MetricDraft) => void;
  metric?: PublishMetric | null;
  review?: PublishReview | null;
  saveMetric: (task: PublishTask) => Promise<void>;
  runReview: (task: PublishTask) => Promise<void>;
  compact?: boolean;
}) {
  const { t, locale } = useI18n();
  const metricLabels = getMetricLabels(t);
  const { task, metricDraft, setMetricDraft, metric, review, saveMetric, runReview, compact } = props;
  if (!task) {
    return <section className="amp-workspace-card flex items-center justify-center border-dashed p-8 text-center text-sm text-slate-500">{t("请选择一条已发布内容进行复盘。", "Select a published post to review.")}</section>;
  }
  if (compact) {
    return (
      <section className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
        {t("发布后的数据录入和 AI 复盘请在顶部“效果复盘”主 Tab 中处理，避免和发布前字段混在一起。", "Use the “Performance review” tab at the top for post-publishing metrics and AI reviews, separate from pre-publishing settings.")}
      </section>
    );
  }
  return (
    <section className="amp-workspace-card overflow-y-auto p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{text(task.final_snapshot.title) || t("效果复盘", "Performance review")}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{t("这里仅处理发布后的数据表现和 AI 分析，不包含发布前字段。", "This section covers post-publishing performance and AI analysis only, not pre-publishing settings.")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metricLabels.map((field) => (
          <label key={field.key} className="text-xs text-slate-500 dark:text-slate-300">
            {field.label}
            <div className="mt-1 flex rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
              <input
                type="number"
                value={metricDraft[field.key]}
                onChange={(event) => setMetricDraft({ ...metricDraft, [field.key]: Number(event.target.value) || 0 })}
                className="w-full rounded-lg bg-transparent px-3 py-2 text-sm outline-none"
              />
              {field.suffix && <span className="px-3 py-2 text-sm text-slate-400">{field.suffix}</span>}
            </div>
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => saveMetric(task)} className="amp-button amp-button-secondary">
          {t("保存发布数据", "Save post metrics")}
        </button>
        <button type="button" onClick={() => runReview(task)} disabled={!metric} className="amp-button amp-button-primary">
          {t("AI 复盘并写入账号记忆库", "Run AI review and save to Account Memory")}
        </button>
      </div>
      <div className="mt-5 rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
        <h3 className="text-sm font-semibold">{t("AI 复盘结论", "AI review findings")}</h3>
        {review ? (
          <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <p>{review.summary}</p>
            <InfoRow label={t("可复用结构", "Reusable structures")} value={review.reusable_structures.join(locale === "en" ? ", " : "、") || t("待生成", "Not generated yet")} />
            <InfoRow label={t("问题原因", "Causes of issues")} value={review.problem_reasons.join(locale === "en" ? ", " : "、") || t("待生成", "Not generated yet")} />
            <InfoRow label={t("下一轮方向", "Next steps")} value={review.next_directions.join(locale === "en" ? ", " : "、") || t("待生成", "Not generated yet")} />
            <InfoRow label={t("系列潜力", "Series potential")} value={review.series_potential || t("待判断", "Not assessed yet")} />
            <InfoRow label={t("账号记忆建议", "Account Memory suggestions")} value={review.memory_update_suggestion || t("待生成", "Not generated yet")} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">{t("录入数据后可生成复盘结论。", "Enter metrics to generate review findings.")}</p>
        )}
      </div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 py-2 last:border-0 dark:border-slate-800 sm:grid-cols-[120px_1fr]">
      <span className="text-slate-500 dark:text-slate-300">{label}</span>
      <span className="break-words text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  );
}
