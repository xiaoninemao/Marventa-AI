"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import {
  fetch_organization,
  invite_organization_member,
  update_organization_member_role,
} from "@/services/api_client";
import type { OrganizationDetail, OrganizationMember } from "@/types/auth";
import { organizationName, organizationRole } from "@/utils/organizations";
import InlineIcon from "@/components/redesign/InlineIcon";

type EditableRole = "admin" | "member";

export default function OrganizationDetailPage() {
  const params = useParams<{ organizationId: string }>();
  const organizationId = params.organizationId;
  const router = useRouter();
  const { user, loading: authLoading, renameOrganization, reloadOrganizations } = useAuth();
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const inviteDialogRef = useRef<HTMLDialogElement>(null);
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<EditableRole>("member");

  const loadOrganization = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch_organization(organizationId);
      if (!response.success || !response.data) throw new Error(response.message || "Could not load organization");
      setOrganization(response.data);
      setName(organizationName(response.data, t));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load organization");
    } finally {
      setLoading(false);
    }
  }, [organizationId, t]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user) void loadOrganization();
  }, [user, loadOrganization]);

  useEffect(() => {
    const message = formError || error;
    if (message) showError(localizeErrorMessage(message, locale));
  }, [formError, error, locale, showError]);

  const saveName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { showError(t("组织名称不能为空", "Organization name is required")); return; }
    if (trimmed.length > 80) { showError(t("组织名称不能超过 80 个字符", "Organization name must be at most 80 characters")); return; }
    setActionBusy(true);
    setFormError(null);
    setSuccess(null);
    try {
      await renameOrganization(organizationId, trimmed);
      setOrganization((current) => current ? { ...current, name: trimmed } : current);
      renameDialogRef.current?.close();
      setSuccess(t("组织名称已更新。", "Organization name updated."));
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : "Could not rename organization");
    } finally {
      setActionBusy(false);
    }
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) { showError(t("请输入邮箱", "Email is required")); return; }
    setActionBusy(true);
    setFormError(null);
    setSuccess(null);
    try {
      const response = await invite_organization_member(organizationId, email, inviteRole);
      if (!response.success || !response.data) throw new Error(response.message || "Could not add organization member");
      setOrganization((current) => current ? {
        ...current,
        member_count: current.member_count + 1,
        members: [...current.members, response.data],
      } : current);
      setInviteEmail("");
      setInviteRole("member");
      reloadOrganizations();
      inviteDialogRef.current?.close();
      setSuccess(t("成员已加入组织。", "The member was added to the organization."));
    } catch (inviteError) {
      setFormError(inviteError instanceof Error ? inviteError.message : "Could not add organization member");
    } finally {
      setActionBusy(false);
    }
  };

  const changeRole = async (member: OrganizationMember, role: EditableRole) => {
    if (member.role === role) return;
    setActionBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await update_organization_member_role(organizationId, member.user_id, role);
      if (!response.success || !response.data) throw new Error(response.message || "Could not update member permissions");
      setOrganization((current) => current ? {
        ...current,
        members: current.members.map((item) => item.user_id === member.user_id ? response.data : item),
      } : current);
      setSuccess(t("成员权限已更新。", "Member permissions updated."));
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "Could not update member permissions");
    } finally {
      setActionBusy(false);
    }
  };

  if (authLoading || (loading && !organization)) {
    return <div className="p-8 text-sm text-slate-500" role="status">{t("加载中...", "Loading...")}</div>;
  }

  if (!organization) {
    return (
      <div className="amp-redesign amp-workspace-page max-w-5xl">
        <Link href="/organizations" className="amp-workspace-back-link">
          <InlineIcon name="arrowLeft" className="h-4 w-4" />
          {t("返回组织管理", "Back to organizations")}
        </Link>
      </div>
    );
  }

  const canManage = organization.role === "owner";

  return (
    <div className="amp-redesign amp-workspace-page max-w-5xl">
      <Link href="/organizations" className="amp-workspace-back-link mb-5">
        <InlineIcon name="arrowLeft" className="h-4 w-4" />
        {t("返回组织管理", "Back to organizations")}
      </Link>

      <div className="amp-workspace-header">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="amp-workspace-title break-words">{organizationName(organization, t)}</h1>
            {canManage && (
              <button type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                aria-label={t("编辑组织名称", "Edit organization name")}
                title={t("编辑组织名称", "Edit organization name")}
                onClick={() => {
                  setName(organizationName(organization, t));
                  setFormError(null);
                  renameDialogRef.current?.showModal();
                }}>
                <InlineIcon name="edit" className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canManage && (
            <button type="button"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              onClick={() => {
                setInviteEmail("");
                setInviteRole("member");
                setFormError(null);
                inviteDialogRef.current?.showModal();
              }}>
              {t("邀请成员", "Invite member")}
            </button>
          )}
        </div>
      </div>

      {success && <p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}

      <section className="amp-workspace-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-950">{t("组织成员", "Organization members")}</h2>
          <span className="text-sm text-slate-500">{organization.member_count}</span>
        </div>
        <div className="mt-4 divide-y divide-slate-100">
          {organization.members.map((member) => (
            <div key={member.user_id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{member.nickname || member.username}</p>
                <p className="mt-1 truncate text-xs text-slate-500">@{member.username}</p>
              </div>
              {canManage && member.role !== "owner" ? (
                <div className="flex items-center gap-3 text-sm text-slate-600">
                  <span>{t("权限", "Permission")}</span>
                  <div role="radiogroup"
                    aria-label={t("设置 {name} 的权限", "Set permissions for {name}", { name: member.nickname || member.username })}
                    className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                    {(["member", "admin"] as const).map((role) => (
                      <button key={role} type="button" role="radio" aria-checked={member.role === role}
                        disabled={actionBusy} onClick={() => void changeRole(member, role)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${member.role === role ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                        {role === "member" ? t("成员", "Member") : t("管理员", "Admin")}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <span className="self-start rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 sm:self-auto">
                  {organizationRole(member.role, t)}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <dialog ref={renameDialogRef} aria-labelledby="rename-organization-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (actionBusy) event.preventDefault(); }}>
        <h2 id="rename-organization-title" className="text-lg font-semibold">{t("编辑组织名称", "Edit organization name")}</h2>
        <form onSubmit={saveName} className="mt-5">
          <label className="block text-sm font-medium text-slate-700">
            {t("组织名称", "Organization name")}
            <input autoFocus value={name} maxLength={80} disabled={actionBusy}
              onChange={(event) => setName(event.target.value)}
              className="amp-workspace-control mt-2 w-full font-normal" />
          </label>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="amp-button amp-button-secondary" disabled={actionBusy}
              onClick={() => renameDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
            <button type="submit" className="amp-button amp-button-primary" disabled={actionBusy}>
              {actionBusy ? t("保存中...", "Saving...") : t("保存", "Save")}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={inviteDialogRef} aria-labelledby="invite-member-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (actionBusy) event.preventDefault(); }}>
        <h2 id="invite-member-title" className="text-lg font-semibold">{t("邀请成员", "Invite member")}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {t("输入已注册用户的邮箱，成员将立即加入组织。", "Enter a registered user's email. They will join immediately.")}
        </p>
        <form onSubmit={inviteMember} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            {t("邮箱", "Email")}
            <input autoFocus type="email" value={inviteEmail} disabled={actionBusy}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder={t("请输入邮箱", "Enter email")}
              className="amp-workspace-control mt-2 w-full font-normal" />
          </label>
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">{t("权限", "Permission")}</legend>
            <div role="radiogroup" className="mt-2 grid grid-cols-2 gap-2">
              {(["member", "admin"] as const).map((role) => (
                <button key={role} type="button" role="radio" aria-checked={inviteRole === role}
                  disabled={actionBusy} onClick={() => setInviteRole(role)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${inviteRole === role ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
                  {role === "member" ? t("成员", "Member") : t("管理员", "Admin")}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="amp-button amp-button-secondary" disabled={actionBusy}
              onClick={() => inviteDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
            <button type="submit" className="amp-button amp-button-primary" disabled={actionBusy}>
              {actionBusy ? t("邀请中...", "Inviting...") : t("邀请", "Invite")}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
