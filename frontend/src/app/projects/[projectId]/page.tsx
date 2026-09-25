"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import {
  fetch_content_project,
  fetch_content_projects,
  fetch_history,
  fetch_my_cases,
  fetch_project_channel_accounts,
  fetch_project_members,
  fetch_scripts,
  fetch_sessions,
  delete_project_channel_account,
  invite_project_member,
  poll_xiaohongshu_channel_authorization,
  remove_project_member,
  start_project_channel_authorization,
  update_project_member_role,
} from "@/services/api_client";
import type { ContentProject, ProjectChannelAccount, ProjectMember } from "@/types/publishing";
import type { HistoryRecord } from "@/types/market_insight";
import type { CaseItem } from "@/types/case_library";
import type { SessionRecord } from "@/types/content_generator";
import InlineIcon, { type InlineIconName } from "@/components/redesign/InlineIcon";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import ProjectQuickSidebar from "@/components/projects/ProjectQuickSidebar";
import { userAvatarColor as memberAvatarColor, userAvatarInitial } from "@/utils/user_avatar";

type AssetType = "all" | "insight" | "case" | "content" | "portfolio";
type ChannelPlatformFilter = "all" | "xiaohongshu" | "douyin";
type ChannelSortOrder = "desc" | "asc";
type DeviceAuthorization = {
  state: string;
  authorizationUrl: string;
  expiresIn: number;
  interval: number;
  userCode: string;
};

type ProjectAsset = {
  id: string;
  type: Exclude<AssetType, "all">;
  title: string;
  detail: string;
  icon: InlineIconName;
  insight?: HistoryRecord;
  href?: string;
};

const MARKETING_CHANNELS = [
  {
    key: "xiaohongshu",
    zh: "小红书",
    en: "Xiaohongshu",
    detailZh: "图文与短视频内容",
    detailEn: "Image posts and short video",
    logo: "/images/channels/xiaohongshu.jpg",
  },
  {
    key: "douyin",
    zh: "抖音",
    en: "Douyin",
    detailZh: "短视频内容",
    detailEn: "Short-video content",
    logo: "/images/channels/douyin.jpg",
  },
] as const;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8765";

function mediaUrl(url: string) {
  if (!url) return "";
  return url.startsWith("http") ? url : `${API_BASE}${url}`;
}

function formatDate(value: string, locale: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale === "en" ? "en-US" : "zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const [project, setProject] = useState<ContentProject | null>(null);
  const [quickProjects, setQuickProjects] = useState<ContentProject[]>([]);
  const [projectInsights, setProjectInsights] = useState<HistoryRecord[]>([]);
  const [projectCases, setProjectCases] = useState<CaseItem[]>([]);
  const [projectSessions, setProjectSessions] = useState<SessionRecord[]>([]);
  const [projectScripts, setProjectScripts] = useState<Array<{
    id: string; title: string; content: string; updated_at: string;
  }>>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [channelAccounts, setChannelAccounts] = useState<ProjectChannelAccount[]>([]);
  const [channelPlatformFilter, setChannelPlatformFilter] = useState<ChannelPlatformFilter>("all");
  const [channelSortOrder, setChannelSortOrder] = useState<ChannelSortOrder>("desc");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"assets" | "channels" | "members">("assets");
  const [assetType, setAssetType] = useState<AssetType>("all");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [choosingPlatform, setChoosingPlatform] = useState(true);
  const [bindingPlatform, setBindingPlatform] = useState<"xiaohongshu" | "douyin">("xiaohongshu");
  const [deviceAuthorization, setDeviceAuthorization] = useState<DeviceAuthorization | null>(null);
  const [deviceAuthorizationStatus, setDeviceAuthorizationStatus] = useState<"pending" | "scanned">("pending");
  const [deviceQrCode, setDeviceQrCode] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<ProjectMember | null>(null);
  const [memberMenuUserId, setMemberMenuUserId] = useState<string | null>(null);
  const [channelMenuAccountId, setChannelMenuAccountId] = useState<string | null>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const memberMenuRef = useRef<HTMLDivElement>(null);
  const channelMenuRef = useRef<HTMLDivElement>(null);
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const accountDialogRef = useRef<HTMLDialogElement>(null);
  const inviteDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);

  useEffect(() => {
    setChannelPlatformFilter("all");
    setChannelSortOrder("desc");
  }, [projectId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("channel_authorization");
    if (!status) return;
    setTab("channels");
    if (status === "success") {
      showSuccess(t("抖音账号授权成功", "Douyin account authorized"));
    } else if (status === "cancelled") {
      showError(t("已取消抖音账号授权", "Douyin authorization was cancelled"));
    } else {
      showError(t("抖音账号授权失败，请重试", "Douyin authorization failed. Try again."));
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [showError, showSuccess, t]);

  useEffect(() => {
    if (!user || !projectId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch_content_project(projectId),
      fetch_project_channel_accounts(projectId),
      fetch_project_members(projectId),
      fetch_content_projects(),
      fetch_history("", projectId),
      fetch_my_cases(100, 0, "", projectId),
      fetch_sessions(projectId),
      fetch_scripts(projectId),
    ])
      .then(([
        projectResponse, accountsResponse, membersResponse, projectsResponse, insightsResponse,
        casesResponse, sessionsResponse, scriptsResponse,
      ]) => {
        if (cancelled) return;
        setProject(projectResponse.data);
        setChannelAccounts(accountsResponse.data || []);
        setMembers(membersResponse.data || []);
        setQuickProjects(projectsResponse.data || []);
        setProjectInsights(insightsResponse.data || []);
        const caseData = casesResponse.data;
        setProjectCases(Array.isArray(caseData) ? caseData : caseData.cases || []);
        setProjectSessions(sessionsResponse.data || []);
        setProjectScripts(scriptsResponse.data || []);
      })
      .catch((error) => {
        if (!cancelled) {
          showError(localizeErrorMessage(error instanceof Error ? error.message : "Fetch project failed", locale));
          router.replace("/projects");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, projectId, router, showError, user]);

  useEffect(() => {
    if (!createMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !createMenuRef.current?.contains(event.target)) {
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [createMenuOpen]);

  useEffect(() => {
    if (!memberMenuUserId) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !memberMenuRef.current?.contains(event.target)) {
        setMemberMenuUserId(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [memberMenuUserId]);

  useEffect(() => {
    if (!channelMenuAccountId) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !channelMenuRef.current?.contains(event.target)) {
        setChannelMenuAccountId(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [channelMenuAccountId]);

  useEffect(() => {
    if (!deviceAuthorization || !project) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let interval = deviceAuthorization.interval;
    const poll = async () => {
      try {
        const response = await poll_xiaohongshu_channel_authorization(
          project.id,
          deviceAuthorization.state,
        );
        if (cancelled) return;
        if (response.data.status === "authorized" && response.data.account) {
          setChannelAccounts((current) => [
            ...current.filter((item) => item.id !== response.data.account?.id),
            response.data.account!,
          ]);
          setDeviceAuthorization(null);
          setDeviceQrCode("");
          accountDialogRef.current?.close();
          showSuccess(t("小红书账号授权成功", "Xiaohongshu account authorized"));
          return;
        }
        setDeviceAuthorizationStatus(
          response.data.status === "scanned" ? "scanned" : "pending",
        );
        interval = response.data.interval || interval;
        timeoutId = setTimeout(poll, interval * 1000);
      } catch (error) {
        if (cancelled) return;
        setDeviceAuthorization(null);
        setDeviceQrCode("");
        showError(localizeErrorMessage(
          error instanceof Error ? error.message : "Could not check channel authorization",
          locale,
        ));
      }
    };
    timeoutId = setTimeout(poll, interval * 1000);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [deviceAuthorization, locale, project, showError, showSuccess, t]);

  const assets = useMemo<ProjectAsset[]>(() => {
    if (!project) return [];
    const items: ProjectAsset[] = projectInsights.map((insight) => ({
      id: `insight-${insight.id}`,
      type: "insight",
      title: insight.title || insight.filename,
      detail: insight.ai_analysis?.product_summary || insight.ai_analysis?.product_description || t("市场洞察", "Market insight"),
      icon: "insight",
      insight,
      href: `/market_insight/${encodeURIComponent(insight.id)}`,
    }));
    items.push(...projectCases.map<ProjectAsset>((item) => ({
      id: `case-${item.id}`,
      type: "case",
      title: item.title,
      detail: item.description || t("案例", "Case"),
      icon: "case",
      href: `/case_library/${encodeURIComponent(item.id)}?project=${encodeURIComponent(project.id)}`,
    })));
    items.push(...projectSessions.map<ProjectAsset>((session) => ({
      id: `content-${session.id}`,
      type: "content",
      title: session.title || t("未命名创作", "Untitled creation"),
      detail: session.cards[0]?.preview || t("智能创作", "Content Studio"),
      icon: "edit",
      href: `/content_generator/${encodeURIComponent(session.id)}`,
    })));
    items.push(...projectScripts.map<ProjectAsset>((script) => ({
      id: `portfolio-${script.id}`,
      type: "portfolio",
      title: script.title,
      detail: script.content.slice(0, 120) || t("作品", "Portfolio"),
      icon: "briefcase",
      href: `/portfolio?project=${encodeURIComponent(project.id)}`,
    })));
    return items;
  }, [project, projectCases, projectInsights, projectScripts, projectSessions, t]);

  const visibleAssets = useMemo(() => {
    return assets.filter((asset) => assetType === "all" || asset.type === assetType);
  }, [assetType, assets]);

  const visibleChannelAccounts = useMemo(() => {
    const filtered = channelAccounts.filter((account) =>
      channelPlatformFilter === "all" || account.platform === channelPlatformFilter);
    return [...filtered].sort((left, right) => {
      const difference = Date.parse(left.created_at) - Date.parse(right.created_at);
      return channelSortOrder === "asc" ? difference : -difference;
    });
  }, [channelAccounts, channelPlatformFilter, channelSortOrder]);

  const typeCount = (type: Exclude<AssetType, "all">) =>
    assets.filter((asset) => asset.type === type).length;

  const openAccountDialog = () => {
    setChoosingPlatform(true);
    setDeviceAuthorization(null);
    setDeviceQrCode("");
    setDeviceAuthorizationStatus("pending");
    accountDialogRef.current?.showModal();
  };

  const authorizeChannelAccount = async () => {
    if (!project) return;
    setAccountSaving(true);
    try {
      const response = await start_project_channel_authorization(project.id, bindingPlatform);
      if (response.data.mode === "redirect") {
        window.location.assign(response.data.authorization_url);
        return;
      }
      const qrCode = await QRCode.toDataURL(response.data.authorization_url, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 224,
        color: { dark: "#101828", light: "#ffffff" },
      });
      setDeviceAuthorization({
        state: response.data.state,
        authorizationUrl: response.data.authorization_url,
        expiresIn: response.data.expires_in,
        interval: response.data.interval,
        userCode: response.data.user_code,
      });
      setDeviceAuthorizationStatus("pending");
      setDeviceQrCode(qrCode);
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not start channel authorization",
        locale,
      ));
    } finally {
      setAccountSaving(false);
    }
  };

  const unbindChannelAccount = async (account: ProjectChannelAccount) => {
    if (
      !project
      || (!canManageMembers && account.created_by_user_id !== user?.id)
    ) return;
    setAccountSaving(true);
    try {
      await delete_project_channel_account(project.id, account.id);
      setChannelAccounts((current) => current.filter((item) => item.id !== account.id));
      showSuccess(t("账号授权已取消", "Account authorization revoked"));
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not remove channel account",
        locale,
      ));
    } finally {
      setAccountSaving(false);
    }
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) {
      showError(t("请输入邮箱", "Email is required"));
      return;
    }
    setInviting(true);
    try {
      const response = await invite_project_member(projectId, email, inviteRole);
      setMembers((current) => [...current, response.data]);
      setInviteEmail("");
      setInviteRole("member");
      inviteDialogRef.current?.close();
      showSuccess(t("成员已加入项目。", "The member was added to the project."));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not add project member", locale));
    } finally {
      setInviting(false);
    }
  };

  const changeMemberRole = async (member: ProjectMember, role: "member" | "admin") => {
    if (member.role === role) return;
    setInviting(true);
    try {
      const response = await update_project_member_role(projectId, member.user_id, role);
      setMembers((current) => current.map((item) => item.user_id === member.user_id ? response.data : item));
      showSuccess(t("项目成员权限已更新。", "Project member permissions updated."));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not update project member", locale));
    } finally {
      setInviting(false);
    }
  };

  const removeMember = async (member: ProjectMember) => {
    setInviting(true);
    try {
      await remove_project_member(projectId, member.user_id);
      setMembers((current) => current.filter((item) => item.user_id !== member.user_id));
      removeDialogRef.current?.close();
      setMemberToRemove(null);
      showSuccess(t("成员已移出项目。", "The member was removed from the project."));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not remove project member", locale));
    } finally {
      setInviting(false);
    }
  };

  if (authLoading || loading || !project) {
    return <div className="p-8 text-sm text-slate-500" role="status">{t("正在加载项目...", "Loading project...")}</div>;
  }

  const categories: Array<{ type: Exclude<AssetType, "all">; label: string; icon: InlineIconName }> = [
    { type: "insight", label: t("市场洞察", "Market insights"), icon: "insight" },
    { type: "case", label: t("案例", "Cases"), icon: "case" },
    { type: "content", label: t("智能创作", "Content Studio"), icon: "edit" },
    { type: "portfolio", label: t("作品", "Portfolio"), icon: "briefcase" },
  ];
  const canManageMembers = project.role === "owner" || project.role === "admin";
  const canManageAdmins = project.role === "owner";
  const roleOptions = [
    { value: "member" as const, label: t("成员", "Member") },
    { value: "admin" as const, label: t("管理员", "Administrator") },
  ];
  return (
    <div className="amp-project-detail-layout">
      <ProjectQuickSidebar projects={quickProjects} currentProjectId={project.id} />
      <main className="amp-project-detail-main">
        <header className="amp-project-detail-header">
          <div className="amp-project-detail-title">
            <Link href="/projects" className="amp-project-detail-back" aria-label={t("返回项目列表", "Back to projects")}>
              <InlineIcon name="arrowLeft" />
            </Link>
            <span className="amp-project-avatar amp-project-custom-avatar"
              style={{ backgroundColor: project.avatar_color || "#bfdbfe" }}>
              <span className="amp-project-avatar-emoji">{project.avatar_icon || "💡"}</span>
            </span>
            <div>
              <h1>{project.title}</h1>
              {project.notes && <p>{project.notes}</p>}
            </div>
          </div>
          {tab === "assets" ? <div ref={createMenuRef} className="amp-project-create-menu">
            <button type="button" className="amp-button amp-button-primary" aria-haspopup="menu" aria-expanded={createMenuOpen}
              onClick={() => setCreateMenuOpen((open) => !open)}>
              {t("添加资产", "Add asset")}
              <InlineIcon name="chevronRight" className="amp-project-create-chevron" />
            </button>
            {createMenuOpen && (
              <div role="menu" className="amp-project-create-popover">
                <Link role="menuitem" href={`/market_insight?project=${encodeURIComponent(project.id)}`}><InlineIcon name="insight" />{t("市场洞察", "Market insight")}</Link>
                <Link role="menuitem" href={`/case_library?project=${encodeURIComponent(project.id)}`}><InlineIcon name="case" />{t("案例", "Case")}</Link>
                <Link role="menuitem" href={`/content_generator?project=${encodeURIComponent(project.id)}`}><InlineIcon name="edit" />{t("智能创作", "Content Studio")}</Link>
                <Link role="menuitem" href={`/portfolio?project=${encodeURIComponent(project.id)}`}><InlineIcon name="briefcase" />{t("作品", "Portfolio")}</Link>
              </div>
            )}
          </div> : tab === "members" && canManageMembers ? (
            <button type="button" className="amp-button amp-button-primary"
              onClick={() => {
                setInviteEmail("");
                setInviteRole("member");
                inviteDialogRef.current?.showModal();
              }}>
              {t("邀请成员", "Invite member")}
            </button>
          ) : tab === "channels" ? (
            <button type="button" className="amp-button amp-button-primary"
              onClick={openAccountDialog}>
              {t("添加渠道", "Add channel")}
            </button>
          ) : null}
        </header>

        <div className="amp-project-detail-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "assets"} onClick={() => setTab("assets")}>{t("资产", "Assets")}</button>
          <button type="button" role="tab" aria-selected={tab === "members"} onClick={() => setTab("members")}>{t("成员", "Members")}</button>
          <button type="button" role="tab" aria-selected={tab === "channels"} onClick={() => setTab("channels")}>{t("集成", "Integrations")}</button>
        </div>

        {tab === "assets" ? (
          <>
            <div className="amp-project-category-grid">
              <button type="button" onClick={() => setAssetType("all")}
                className={assetType === "all" ? "amp-project-category-active" : ""}>
                <InlineIcon name="folder" />
                <span>{t("全部", "All")}</span>
                <strong>{assets.length}</strong>
              </button>
              {categories.map((category) => (
                <button key={category.type} type="button"
                  onClick={() => setAssetType((current) => current === category.type ? "all" : category.type)}
                  className={assetType === category.type ? "amp-project-category-active" : ""}>
                  <InlineIcon name={category.icon} />
                  <span>{category.label}</span>
                  <strong>{typeCount(category.type)}</strong>
                </button>
              ))}
            </div>

            <div className="amp-project-asset-list">
              {visibleAssets.length === 0 ? (
                <div className="amp-project-assets-empty">
                  <InlineIcon name="folder" />
                  <strong>{assetType !== "all" ? t("没有此类资产", "No assets of this type") : t("项目中还没有资产", "No assets in this project yet")}</strong>
                  <p>{t("市场洞察、案例、智能创作和作品都可以归入这个项目。", "Market insights, cases, generated content, and portfolio work can all live in this project.")}</p>
                </div>
              ) : visibleAssets.map((asset) => (
                <article key={asset.id} className={`amp-project-asset-row amp-project-asset-${asset.type}`}>
                  <div className="amp-project-asset-icon">
                    <InlineIcon name={asset.icon} />
                  </div>
                  <div className="amp-project-asset-copy">
                    {asset.href ? (
                      <Link href={asset.href}><strong>{asset.title}</strong></Link>
                    ) : <strong>{asset.title}</strong>}
                    <span>{asset.detail}</span>
                  </div>
                  <span className="amp-project-asset-type">
                    {asset.type === "content" ? t("智能创作", "Content Studio")
                      : asset.type === "portfolio" ? t("作品", "Portfolio")
                        : asset.type === "insight" ? t("市场洞察", "Market insight") : t("案例", "Case")}
                  </span>
                  <time>{formatDate(asset.insight?.upload_time || project.updated_at, locale)}</time>
                  {asset.href ? (
                    <Link href={asset.href}
                      className="amp-project-asset-more" aria-label={t("打开 {name}", "Open {name}", { name: asset.title })}>
                      <InlineIcon name="chevronRight" />
                    </Link>
                  ) : <InlineIcon name="more" className="amp-project-asset-more" />}
                </article>
              ))}
            </div>
          </>
        ) : tab === "channels" ? (
          <section className="amp-project-channels" aria-label={t("渠道集成", "Channel integrations")}>
            <div className="amp-project-channel-toolbar">
              <EnterpriseSelect
                value={channelPlatformFilter}
                options={[
                  { value: "all", label: t("全部应用", "All applications") },
                  ...MARKETING_CHANNELS.map((channel) => ({
                    value: channel.key,
                    label: t(channel.zh, channel.en),
                  })),
                ]}
                onChange={setChannelPlatformFilter}
                ariaLabel={t("筛选应用", "Filter applications")}
                className="w-36"
              />
              <EnterpriseSelect
                value={channelSortOrder}
                options={[
                  { value: "desc", label: t("最近创建", "Newest") },
                  { value: "asc", label: t("最早创建", "Oldest") },
                ]}
                onChange={setChannelSortOrder}
                ariaLabel={t("账号创建时间排序", "Sort by account creation time")}
                className="w-40"
              />
            </div>
            <div className="amp-project-integration-list has-toolbar">
              {channelAccounts.length === 0 ? (
                <div className="amp-project-assets-empty">
                  <InlineIcon name="share" />
                  <strong>{t("尚未添加渠道", "No channels added")}</strong>
                  <p>{t("点击右上角“添加渠道”绑定发布账号。", "Use Add channel to bind a publishing account.")}</p>
                </div>
              ) : visibleChannelAccounts.length === 0 ? (
                <div className="amp-project-channel-filter-empty">
                  {t("该应用暂无授权账号", "No authorized accounts for this application")}
                </div>
              ) : visibleChannelAccounts.map((account) => {
                const channel = MARKETING_CHANNELS.find((item) => item.key === account.platform)!;
                const canRevokeAccount = canManageMembers || account.created_by_user_id === user?.id;
                return (
                  <article key={account.id} className="amp-project-integration-row">
                    <div className="amp-project-integration-main">
                      <div className="amp-project-integration-app">
                        <span className="amp-project-integration-icon" aria-hidden="true">
                          <Image src={channel.logo} alt="" width={42} height={42} />
                        </span>
                        <strong>{t(channel.zh, channel.en)}</strong>
                      </div>
                      <div className="amp-project-integration-account">
                        <strong>{account.account_name}</strong>
                        <span>{account.platform_user_id || t("未提供平台账号 ID", "No platform account ID")}</span>
                      </div>
                      <div className="amp-project-integration-creator">
                        <span className="amp-project-integration-avatar"
                          style={{ backgroundColor: memberAvatarColor(account.created_by_user_id || account.creator_name) }}>
                          {account.creator_avatar_url ? (
                            <Image src={mediaUrl(account.creator_avatar_url)} alt="" width={34} height={34}
                              unoptimized className="h-full w-full object-cover" />
                          ) : (
                            userAvatarInitial(account.creator_name || t("项目成员", "Project member"))
                          )}
                        </span>
                        <strong>{account.creator_name || t("项目成员", "Project member")}</strong>
                      </div>
                      <time className="amp-project-integration-created">
                        {formatDate(account.created_at, locale)}
                      </time>
                      {(account.profile_url || canRevokeAccount) && (
                      <div ref={channelMenuAccountId === account.id ? channelMenuRef : undefined}
                        className="amp-project-integration-actions">
                        <button type="button" className="amp-member-action-more"
                          aria-haspopup="menu"
                          aria-expanded={channelMenuAccountId === account.id}
                          aria-label={t("{name} 的账号操作", "Account actions for {name}", { name: account.account_name })}
                          onClick={() => setChannelMenuAccountId((current) =>
                            current === account.id ? null : account.id)}>
                          <InlineIcon name="more" className="h-5 w-5" strokeWidth={3} />
                        </button>
                        {channelMenuAccountId === account.id && (
                          <div role="menu" className="amp-member-action-menu amp-channel-action-menu"
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setChannelMenuAccountId(null);
                              }
                            }}>
                            {account.profile_url && (
                              <a role="menuitem" href={account.profile_url} target="_blank" rel="noreferrer"
                                onClick={() => setChannelMenuAccountId(null)}>
                                <InlineIcon name="eye" />
                                {t("查看主页", "Open profile")}
                              </a>
                            )}
                            {canRevokeAccount && (
                              <button type="button" role="menuitem" className="amp-channel-revoke"
                                disabled={accountSaving}
                                onClick={() => {
                                  setChannelMenuAccountId(null);
                                  void unbindChannelAccount(account);
                                }}>
                                <InlineIcon name="close" />
                                {t("取消授权", "Revoke access")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="amp-project-members">
            <div className="amp-workspace-card p-5">
              <div className="divide-y divide-slate-100">
              {members.map((member) => {
                const canEditMember = canManageMembers
                  && member.role !== "owner"
                  && member.user_id !== user?.id
                  && (canManageAdmins || member.role === "member");
                const displayName = member.nickname || member.username;
                return (
                <div key={member.user_id} className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[minmax(0,1.1fr)_minmax(220px,1fr)_72px] sm:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white ${memberAvatarColor(member.user_id)}`}>
                      {member.avatar_url ? (
                        <Image
                          src={mediaUrl(member.avatar_url)}
                          alt=""
                          fill
                          sizes="36px"
                          unoptimized
                          className="object-cover"
                        />
                      ) : (
                        userAvatarInitial(displayName)
                      )}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-sm font-semibold text-slate-900">{displayName}</strong>
                      <small className="mt-1 block truncate text-xs text-slate-500">{member.email || `@${member.username}`}</small>
                    </span>
                  </div>
                  <div className="flex items-center text-sm text-slate-600 sm:justify-self-start">
                    {canEditMember ? (
                      <EnterpriseSelect
                        value={member.role as "member" | "admin"}
                        options={roleOptions}
                        onChange={(role) => void changeMemberRole(member, role)}
                        ariaLabel={t("设置 {name} 的项目权限", "Set project permissions for {name}", { name: displayName })}
                        disabled={inviting}
                        variant="inline"
                        className="w-auto"
                      />
                    ) : (
                      <span className="text-sm font-[550] leading-5 text-[#344054]">
                        {member.role === "owner" ? t("所有者", "Owner") : member.role === "admin" ? t("管理员", "Administrator") : t("成员", "Member")}
                      </span>
                    )}
                  </div>
                  <div className="sm:justify-self-end">
                    {canEditMember && (
                      <div ref={memberMenuUserId === member.user_id ? memberMenuRef : undefined}
                        className="relative inline-flex">
                        <button type="button" disabled={inviting}
                          className="amp-member-action-more"
                          aria-haspopup="menu"
                          aria-expanded={memberMenuUserId === member.user_id}
                          aria-label={t("{name} 的成员操作", "Member actions for {name}", { name: displayName })}
                          onClick={() => setMemberMenuUserId((current) =>
                            current === member.user_id ? null : member.user_id)}>
                          <InlineIcon name="more" className="h-5 w-5" strokeWidth={3} />
                        </button>
                        {memberMenuUserId === member.user_id && (
                          <div role="menu" className="amp-member-action-menu"
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setMemberMenuUserId(null);
                              }
                            }}>
                            <button type="button" role="menuitem"
                              className="amp-member-action-danger" disabled={inviting}
                              onClick={() => {
                                setMemberMenuUserId(null);
                                setMemberToRemove(member);
                                removeDialogRef.current?.showModal();
                              }}>
                              <InlineIcon name="trash" />
                              {t("移出成员", "Remove member")}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
              </div>
            </div>
          </section>
        )}

        <dialog ref={inviteDialogRef} aria-labelledby="invite-project-member-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onCancel={(event) => { if (inviting) event.preventDefault(); }}>
          <h2 id="invite-project-member-title" className="text-lg font-semibold">{t("邀请成员", "Invite member")}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {t(
              "只有项目成员可以访问项目。被邀请人必须是当前组织成员。",
              "Only project members can access this project. Invitees must be members of the current organization.",
            )}
          </p>
          <form onSubmit={inviteMember} className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              {t("邮箱", "Email")}
              <input autoFocus type="email" value={inviteEmail} disabled={inviting}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder={t("请输入邮箱", "Enter email")}
                className="amp-workspace-control mt-2 w-full font-normal" />
            </label>
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">{t("权限", "Permission")}</legend>
              <EnterpriseSelect
                value={inviteRole}
                options={roleOptions}
                onChange={setInviteRole}
                ariaLabel={t("邀请成员权限", "Invited member permission")}
                disabled={inviting}
                className="mt-2 w-full"
              />
            </fieldset>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="amp-button amp-button-secondary" disabled={inviting}
                onClick={() => inviteDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
              <button type="submit" className="amp-button amp-button-primary" disabled={inviting || !inviteEmail.trim()}>
                {inviting ? t("邀请中...", "Inviting...") : t("邀请", "Invite")}
              </button>
            </div>
          </form>
        </dialog>

        <dialog ref={accountDialogRef} aria-labelledby="bind-channel-account-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-lg bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onClose={() => {
            if (!accountSaving) {
              setChoosingPlatform(true);
              setDeviceAuthorization(null);
              setDeviceQrCode("");
              setDeviceAuthorizationStatus("pending");
            }
          }}>
          <h2 id="bind-channel-account-title" className="text-lg font-semibold">
            {choosingPlatform
              ? t("选择渠道", "Choose a channel")
              : t("授权{channel}账号", "Authorize {channel} account", {
                channel: t(
                  MARKETING_CHANNELS.find((channel) => channel.key === bindingPlatform)!.zh,
                  MARKETING_CHANNELS.find((channel) => channel.key === bindingPlatform)!.en,
                ),
              })}
          </h2>
          {choosingPlatform ? (
            <>
              <div className="amp-project-channel-picker">
                {MARKETING_CHANNELS.map((channel) => (
                  <button key={channel.key} type="button" className="amp-project-channel-option"
                    onClick={() => {
                      setBindingPlatform(channel.key);
                      setChoosingPlatform(false);
                    }}>
                    <Image src={channel.logo} alt="" width={52} height={52} />
                    <span>
                      <strong>{t(channel.zh, channel.en)}</strong>
                      <small>{t(channel.detailZh, channel.detailEn)}</small>
                    </span>
                    <InlineIcon name="chevronRight" aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div className="amp-project-channel-account-actions">
                <button type="button" className="amp-button amp-button-secondary"
                  onClick={() => accountDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
              </div>
            </>
          ) : (
          <div className="amp-project-channel-authorization">
            <div className="amp-project-channel-selected">
              {(() => {
                const channel = MARKETING_CHANNELS.find((item) => item.key === bindingPlatform)!;
                return (
                  <>
                    <Image src={channel.logo} alt="" width={52} height={52} />
                    <div className="amp-project-channel-selected-copy">
                      {deviceAuthorization ? (
                        <strong>{t(channel.zh, channel.en)}</strong>
                      ) : (
                        <>
                          <strong>{t("通过平台完成安全授权", "Authorize securely through the platform")}</strong>
                          <p>{t(
                            bindingPlatform === "xiaohongshu"
                              ? "使用小红书扫码并确认授权，完成后账号会自动连接到当前项目。"
                              : "你将前往抖音完成身份验证，完成后自动返回当前项目。",
                            bindingPlatform === "xiaohongshu"
                              ? "Scan with Xiaohongshu and confirm. The account will then be connected to this project."
                              : "You will verify your identity on Douyin and return to this project automatically.",
                          )}</p>
                        </>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
            {deviceAuthorization ? (
              <>
                <div className="amp-project-channel-device">
                  {deviceQrCode && (
                    <Image src={deviceQrCode} alt={t("小红书授权二维码", "Xiaohongshu authorization QR code")}
                      width={224} height={224} unoptimized />
                  )}
                  <strong>
                    {deviceAuthorizationStatus === "scanned"
                      ? t("已扫码，请在小红书中确认授权", "Scanned. Confirm authorization in Xiaohongshu.")
                      : t("请使用小红书扫码授权", "Scan with Xiaohongshu to authorize")}
                  </strong>
                  {deviceAuthorization.userCode && (
                    <small>{t("授权码：{code}", "Authorization code: {code}", {
                      code: deviceAuthorization.userCode,
                    })}</small>
                  )}
                  <a href={deviceAuthorization.authorizationUrl} target="_blank" rel="noreferrer"
                    className="amp-project-channel-device-link">
                    {t("在小红书中打开", "Open in Xiaohongshu")}
                  </a>
                </div>
                <div className="amp-project-channel-account-actions">
                  <button type="button" className="amp-button amp-button-secondary"
                    onClick={() => {
                      setDeviceAuthorization(null);
                      setDeviceQrCode("");
                    }}>{t("返回", "Back")}</button>
                </div>
              </>
            ) : (
            <>
            <div className="amp-project-channel-permissions">
              <strong>{t("Marventa AI 将申请", "Marventa AI will request")}</strong>
              <ul>
                <li><InlineIcon name="check" />{t("识别已授权账号的公开身份", "Read the authorized account identity")}</li>
                <li><InlineIcon name="check" />{t(
                  "账号授权将在当前项目成员之间共享",
                  "Share the account authorization with members of this project",
                )}</li>
              </ul>
            </div>
            <div className="amp-project-channel-account-actions">
              <button type="button" className="amp-button amp-button-secondary" disabled={accountSaving}
                onClick={() => setChoosingPlatform(true)}>{t("返回", "Back")}</button>
              <button type="button" className="amp-button amp-button-primary"
                disabled={accountSaving} onClick={() => void authorizeChannelAccount()}>
                {accountSaving
                  ? t("正在打开授权页...", "Opening authorization...")
                  : t("前往平台授权", "Continue to platform")}
              </button>
            </div>
            </>
            )}
          </div>
          )}
        </dialog>

        <dialog ref={removeDialogRef} aria-labelledby="remove-project-member-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onCancel={(event) => { if (inviting) event.preventDefault(); }}
          onClose={() => { if (!inviting) setMemberToRemove(null); }}>
          <h2 id="remove-project-member-title" className="text-lg font-semibold">{t("移出项目成员", "Remove project member")}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {t(
              "确定将「{name}」移出项目吗？该成员将失去此项目的访问权限。",
              "Remove {name} from the project? They will lose access to this project.",
              { name: memberToRemove?.nickname || memberToRemove?.username || "" },
            )}
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="amp-button amp-button-secondary" disabled={inviting}
              onClick={() => removeDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
            <button type="button" className="amp-button bg-red-600 text-white hover:bg-red-700" disabled={inviting || !memberToRemove}
              onClick={() => memberToRemove && void removeMember(memberToRemove)}>
              <InlineIcon name="trash" className="h-4 w-4" />
              {inviting ? t("移出中...", "Removing...") : t("确认移出", "Remove")}
            </button>
          </div>
        </dialog>
      </main>
    </div>
  );
}
