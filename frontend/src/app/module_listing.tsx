"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import type { Locale, Translate } from "@/i18n/locale";
import {
  fetch_content_projects,
  fetch_publish_metric,
  fetch_publish_tasks,
  fetch_sessions,
  fetch_social_accounts,
} from "@/services/api_client";
import type { ContentProject } from "@/types/publishing";
import InlineIcon, { type InlineIconName } from "@/components/redesign/InlineIcon";
import RedesignBadge from "@/components/redesign/RedesignBadge";
import RedesignCard from "@/components/redesign/RedesignCard";
import RedesignGradientBanner from "@/components/redesign/RedesignGradientBanner";
import RedesignIconBox from "@/components/redesign/RedesignIconBox";
import RedesignMetricCard from "@/components/redesign/RedesignMetricCard";

const metricCards = [
  { key: "activeProjects", label: "进行中的项目", labelEn: "Active projects", icon: "folder" as InlineIconName },
  { key: "generatedContent", label: "已生成内容", labelEn: "Generated content", icon: "file" as InlineIconName },
  { key: "distributionChannels", label: "分发渠道", labelEn: "Publishing channels", icon: "share" as InlineIconName },
  { key: "averageConversionRate", label: "平均转化率", labelEn: "Average conversion rate", icon: "trending" as InlineIconName },
];

const zeroDashboardMetrics = {
  activeProjects: "0",
  generatedContent: "0",
  distributionChannels: "0",
  averageConversionRate: "0",
  pendingPublishTasks: "0",
  pendingReviews: "0",
};

type DashboardMetricKey = keyof typeof zeroDashboardMetrics;

function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const percent = value * 100;
  return `${percent >= 10 ? percent.toFixed(1) : percent.toFixed(2)}%`;
}

type RecentProjectItem = {
  id: string;
  title: string;
  tag: string;
  time: string;
  icon: InlineIconName;
};

function formatProjectTime(value: string, locale: Locale, t: Translate) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("更新时间未知", "Update time unavailable");
  if (locale === "en") return `Updated ${date.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}`;
  const pad = (num: number) => String(num).padStart(2, "0");
  return `更新于 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function projectTag(project: ContentProject, t: Translate) {
  const platform = project.platform_hint?.trim();
  if (platform === "小红书" || platform === "xiaohongshu") return t("小红书", "Xiaohongshu");
  if (platform === "抖音" || platform === "douyin") return t("抖音", "Douyin");
  if (platform) return platform;
  const typeLabels: Record<string, string> = {
    image_text: t("图文内容", "Image post"),
    video: t("视频内容", "Video content"),
    mixed: t("混合内容", "Mixed content"),
  };
  return typeLabels[project.content_type] || t("内容项目", "Content project");
}

function projectIcon(project: ContentProject): InlineIconName {
  if (project.media_assets?.some((asset) => asset.kind === "image")) return "gallery";
  if (project.source_session_id) return "sparkle";
  if (project.content_type === "image_text") return "edit";
  return "portfolio";
}

function toRecentProject(project: ContentProject, locale: Locale, t: Translate): RecentProjectItem {
  return {
    id: project.id,
    title: project.title || t("未命名项目", "Untitled project"),
    tag: projectTag(project, t),
    time: formatProjectTime(project.updated_at || project.created_at, locale, t),
    icon: projectIcon(project),
  };
}

const quickActions = [
  { label: "市场洞察", labelEn: "Market Insight", path: "/market_insight", icon: "search" as InlineIconName },
  { label: "智能创作", labelEn: "Content Studio", path: "/content_generator", icon: "edit" as InlineIconName },
  { label: "案例库", labelEn: "Case Library", path: "/case_library", icon: "file" as InlineIconName },
  { label: "作品集", labelEn: "Portfolio", path: "/portfolio", icon: "portfolio" as InlineIconName },
];

export default function ModuleListing() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const displayName = user?.nickname || user?.username || t("用户", "User");
  const [dashboardMetrics, setDashboardMetrics] = useState(zeroDashboardMetrics);
  const [recentProjectData, setRecentProjects] = useState<ContentProject[]>([]);
  const recentProjects = recentProjectData.map((project) => toRecentProject(project, locale, t));

  useEffect(() => {
    if (!user) {
      setDashboardMetrics(zeroDashboardMetrics);
      setRecentProjects([]);
      return;
    }

    let cancelled = false;

    async function loadDashboardMetrics() {
      try {
        const [sessionsRes, projectsRes, accountsRes, tasksRes] = await Promise.all([
          fetch_sessions().catch(() => null),
          fetch_content_projects().catch(() => null),
          fetch_social_accounts().catch(() => null),
          fetch_publish_tasks().catch(() => null),
        ]);

        const sessions = sessionsRes?.success ? sessionsRes.data : [];
        const projects = projectsRes?.success ? projectsRes.data : [];
        const accounts = accountsRes?.success ? accountsRes.data : [];
        const tasks = tasksRes?.success ? tasksRes.data : [];
        const generatedContent = sessions.reduce((sum, session) => sum + (session.cards?.length || 0), 0);
        const activeProjects = projects.filter((project) => project.status !== "archived").length;
        const pendingPublishTasks = tasks.filter((task) => task.status === "pending_publish" || task.status === "scheduled").length;
        const pendingReviews = tasks.filter((task) => task.status === "published_pending_data").length;

        const metricResults = await Promise.all(
          tasks.map((task) => fetch_publish_metric(task.id).catch(() => null)),
        );
        const conversionRates = metricResults
          .map((res) => res?.data)
          .filter((metric) => metric && metric.views > 0 && metric.leads > 0)
          .map((metric) => (metric?.leads || 0) / (metric?.views || 1));
        const averageConversionRate = conversionRates.length > 0
          ? conversionRates.reduce((sum, rate) => sum + rate, 0) / conversionRates.length
          : 0;

        if (!cancelled) {
          setDashboardMetrics({
            activeProjects: String(activeProjects),
            generatedContent: String(generatedContent),
            distributionChannels: String(accounts.length),
            averageConversionRate: formatPercent(averageConversionRate),
            pendingPublishTasks: String(pendingPublishTasks),
            pendingReviews: String(pendingReviews),
          });
          setRecentProjects(projects.slice(0, 5));
        }
      } catch {
        if (!cancelled) {
          setDashboardMetrics(zeroDashboardMetrics);
          setRecentProjects([]);
        }
      }
    }

    loadDashboardMetrics();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="amp-redesign">
          <div className="amp-dashboard-content">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="amp-workspace-title">{t("欢迎回来，{name}", "Welcome back, {name}", { name: displayName })}</h1>
              </div>
              <Link href="/content_generator" className="amp-button amp-button-primary">
                <InlineIcon name="sparkle" className="h-4 w-4" />
                {t("新建项目", "New project")}
              </Link>
            </div>

            <section className="amp-dashboard-grid">
              {metricCards.map((metric) => (
                <RedesignMetricCard
                  key={metric.label}
                  label={t(metric.label, metric.labelEn)}
                  value={dashboardMetrics[metric.key as DashboardMetricKey]}
                  icon={
                    <RedesignIconBox>
                      <InlineIcon name={metric.icon} className="h-[22px] w-[22px]" />
                    </RedesignIconBox>
                  }
                />
              ))}
            </section>

            <RedesignGradientBanner className="amp-dashboard-banner my-5">
              <div className="amp-dashboard-banner-inner">
                <div className="amp-dashboard-banner-copy">
                  <h2 className="text-3xl font-bold">{t("用 AI 激发营销创意，加速品牌增长", "Turn ideas into content. Build your brand with AI.")}</h2>
                  <p className="mt-3 text-white/85">{t("智能洞察 · 内容生成 · 全渠道分发 · 效果优化", "Market insight · Content creation · Publishing · Performance review")}</p>
                </div>
              </div>
            </RedesignGradientBanner>

            <section className="amp-dashboard-two-col">
              <RedesignCard className="amp-dashboard-panel flex min-h-[356px] flex-col">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-950">{t("最近项目", "Recent projects")}</h2>
                  <Link href="/content_project_library" className="text-sm font-bold text-blue-600">
                    {t("查看全部", "View all")}
                  </Link>
                </div>
                <div className={`grid flex-1 gap-2 ${recentProjects.length > 0 ? "content-start" : ""}`}>
                  {recentProjects.length > 0 ? (
                    recentProjects.map((project) => (
                      <div key={project.id} className="flex items-center gap-4 border-b border-slate-100 py-3 last:border-b-0">
                        <RedesignIconBox>
                          <InlineIcon name={project.icon} className="h-5 w-5" />
                        </RedesignIconBox>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">{project.title}</p>
                          <RedesignBadge tone="cyan" className="mt-1">
                            {project.tag}
                          </RedesignBadge>
                        </div>
                        <span className="hidden text-xs font-semibold text-slate-400 md:block">{project.time}</span>
                        <InlineIcon name="more" className="h-5 w-5 text-slate-300" />
                      </div>
                    ))
                  ) : (
                    <div className="flex min-h-[230px] flex-col items-center justify-center rounded-lg bg-slate-50 px-6 text-center">
                      <RedesignIconBox>
                        <InlineIcon name="folder" className="h-5 w-5" />
                      </RedesignIconBox>
                      <p className="mt-3 text-sm font-semibold text-slate-900">{t("暂无项目", "No projects yet")}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{t("保存内容项目后会显示在这里", "Your saved content projects will appear here.")}</p>
                    </div>
                  )}
                </div>
              </RedesignCard>

              <div className="grid gap-5">
                <RedesignCard className="amp-dashboard-panel">
                  <h2 className="mb-5 text-base font-semibold text-slate-950">{t("快速入口", "Quick access")}</h2>
                  <div className="grid grid-cols-4 gap-3">
                    {quickActions.map((item) => (
                      <Link key={item.path} href={item.path} className="text-center">
                        <RedesignIconBox className="mx-auto">
                          <InlineIcon name={item.icon} className="h-5 w-5" />
                        </RedesignIconBox>
                        <span className="mt-2 block text-xs font-bold text-slate-600">{t(item.label, item.labelEn)}</span>
                      </Link>
                    ))}
                  </div>
                </RedesignCard>

                <RedesignCard className="amp-dashboard-panel">
                  <div className="mb-3">
                    <h2 className="text-base font-semibold text-slate-950">{t("待办事项", "Tasks")}</h2>
                  </div>
                  <div className="divide-y divide-slate-100">
                    <Link href="/publish_management" className="amp-dashboard-task-row">
                      <span className="amp-dashboard-task-indicator bg-blue-500" />
                      <span className="flex-1">{t("待发布任务", "Ready to publish")}</span>
                      <strong>{dashboardMetrics.pendingPublishTasks}</strong>
                      <span className="amp-dashboard-task-link-icon"><InlineIcon name="chevronRight" /></span>
                    </Link>
                    <Link href="/publish_management?tab=review" className="amp-dashboard-task-row">
                      <span className="amp-dashboard-task-indicator bg-amber-500" />
                      <span className="flex-1">{t("待复盘内容", "Awaiting review")}</span>
                      <strong>{dashboardMetrics.pendingReviews}</strong>
                      <span className="amp-dashboard-task-link-icon"><InlineIcon name="chevronRight" /></span>
                    </Link>
                  </div>
                </RedesignCard>
              </div>
            </section>

          </div>
    </div>
  );
}
