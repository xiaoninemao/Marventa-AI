"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
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
  fetch_project_members,
  fetch_scripts,
  fetch_sessions,
  invite_project_member,
  remove_project_member,
  update_project_member_role,
} from "@/services/api_client";
import type { ContentProject, ProjectMember } from "@/types/publishing";
import type { HistoryRecord } from "@/types/market_insight";
import type { CaseItem } from "@/types/case_library";
import type { SessionRecord } from "@/types/content_generator";
import InlineIcon, { type InlineIconName } from "@/components/redesign/InlineIcon";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import ProjectQuickSidebar from "@/components/projects/ProjectQuickSidebar";
import { userAvatarColor as memberAvatarColor, userAvatarInitial } from "@/utils/user_avatar";

type AssetType = "all" | "insight" | "case" | "content" | "portfolio";

type ProjectAsset = {
  id: string;
  type: Exclude<AssetType, "all">;
  title: string;
  detail: string;
  icon: InlineIconName;
  insight?: HistoryRecord;
  href?: string;
};

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
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"assets" | "members">("assets");
  const [assetType, setAssetType] = useState<AssetType>("all");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<ProjectMember | null>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const removeDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user || !projectId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch_content_project(projectId),
      fetch_project_members(projectId),
      fetch_content_projects(),
      fetch_history("", projectId),
      fetch_my_cases(100, 0, "", projectId),
      fetch_sessions(projectId),
      fetch_scripts(projectId),
    ])
      .then(([
        projectResponse, membersResponse, projectsResponse, insightsResponse,
        casesResponse, sessionsResponse, scriptsResponse,
      ]) => {
        if (cancelled) return;
        setProject(projectResponse.data);
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

  const typeCount = (type: Exclude<AssetType, "all">) =>
    assets.filter((asset) => asset.type === type).length;

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
          <div ref={createMenuRef} className="amp-project-create-menu">
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
          </div>
        </header>

        <div className="amp-project-detail-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "assets"} onClick={() => setTab("assets")}>{t("资产", "Assets")}</button>
          <button type="button" role="tab" aria-selected={tab === "members"} onClick={() => setTab("members")}>{t("成员", "Members")}</button>
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
        ) : (
          <section className="amp-project-members">
            <div className="amp-project-members-heading">
              <div>
                <p>{t("只有项目成员可以访问项目。被邀请人必须已经是当前组织成员。", "Only project members can access this project. Invitees must already belong to the current organization.")}</p>
              </div>
            </div>

            {canManageMembers && (
              <form className="amp-project-invite-form" onSubmit={inviteMember}>
                <label>
                  <span>{t("成员邮箱", "Member email")}</span>
                  <input type="email" value={inviteEmail} disabled={inviting}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder={t("输入已注册用户邮箱", "Enter a registered user's email")}
                    className="amp-workspace-control" />
                </label>
                <label>
                  <span>{t("权限", "Permission")}</span>
                  <EnterpriseSelect
                    value={inviteRole}
                    options={roleOptions}
                    onChange={setInviteRole}
                    ariaLabel={t("邀请成员权限", "Invited member permission")}
                    disabled={inviting}
                    className="w-full"
                  />
                </label>
                <button type="submit" className="amp-button amp-button-primary" disabled={inviting}>
                  {inviting ? t("邀请中...", "Inviting...") : t("邀请成员", "Invite member")}
                </button>
              </form>
            )}

            <div className="amp-workspace-card mt-4 p-5">
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
                      <button type="button" disabled={inviting}
                        className="inline-flex min-h-7 items-center gap-1.5 px-0.5 text-sm font-medium text-red-600 hover:text-red-700"
                        onClick={() => {
                          setMemberToRemove(member);
                          removeDialogRef.current?.showModal();
                        }}>
                        <InlineIcon name="trash" className="h-4 w-4" />
                        {t("移出", "Remove")}
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
              </div>
            </div>
          </section>
        )}

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
