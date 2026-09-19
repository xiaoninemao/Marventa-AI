"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { organizationName, organizationRole } from "@/utils/organizations";
import InlineIcon from "@/components/redesign/InlineIcon";

export default function OrganizationsPage() {
  const { user, loading, organizations, organizationsLoading, organizationsError, organizationBusy, reloadOrganizations, createOrganization, switchOrganization } = useAuth();
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<"created" | "switched" | null>(null);
  const current = user?.current_organization ?? user?.default_organization;

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editorOpen && !dialog.open) dialog.showModal();
    else if (!editorOpen && dialog.open) dialog.close();
  }, [editorOpen]);

  useEffect(() => {
    const message = organizationsError || actionError || formError;
    if (message) showError(localizeErrorMessage(message, locale));
  }, [organizationsError, actionError, formError, locale, showError]);

  const openEditor = () => {
    setName("");
    setFormError(null);
    setActionError(null);
    setSuccess(null);
    setEditorOpen(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { showError(t("组织名称不能为空", "Organization name is required")); return; }
    if (trimmed.length > 80) { showError(t("组织名称不能超过 80 个字符", "Organization name must be at most 80 characters")); return; }
    setFormError(null);
    try {
      await createOrganization(trimmed);
      setSuccess("created");
      setEditorOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create organization");
    }
  };

  const activate = async (id: string) => {
    setActionError(null);
    setSuccess(null);
    try {
      await switchOrganization(id);
      setSuccess("switched");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not switch organization");
    }
  };

  if (loading || !user) return <div className="p-8 text-sm text-slate-500" role="status">{t("加载中...", "Loading...")}</div>;

  return (
    <div className="amp-redesign amp-workspace-page max-w-5xl">
      <div className="amp-workspace-command-bar">
        <h2 className="amp-workspace-section-title">{t("所属组织", "Your organizations")} {!organizationsLoading && !organizationsError && `(${organizations.length})`}</h2>
        <button type="button" className="amp-button amp-button-primary" disabled={organizationBusy || organizationsLoading}
          onClick={openEditor}><InlineIcon name="organization" className="h-4 w-4 shrink-0" />{t("创建组织", "Create organization")}</button>
      </div>

      {success && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        {success === "created" ? t("组织已创建，可点击“切换到此组织”开始使用。", 'Organization created. Select "Switch to organization" to make it your current organization.')
          : t("已切换当前组织，刷新后仍会保留选择。", "Current organization changed. Your selection will be retained after refreshing.")}
      </p>}

      {organizationsLoading ? <p role="status" className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">{t("正在加载组织...", "Loading organizations...")}</p>
        : organizations.length === 0 && !organizationsError ? <p className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">{t("暂未读取到组织，请尝试刷新。", "No organizations were returned. Try refreshing.")}</p>
          : <div className="grid gap-4">{organizations.map((item) => (
            <article key={item.id} data-organization-id={item.id} className="amp-workspace-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <Link href={`/organizations/${encodeURIComponent(item.id)}`}
                  className="min-w-0 flex-1 rounded-lg outline-none transition hover:opacity-75 focus-visible:ring-2 focus-visible:ring-blue-500">
                  <h3 className="break-words text-base font-semibold text-slate-950">{organizationName(item, t)}</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{organizationRole(item.role, t)}</span>
                    {current?.id === item.id && <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">{t("当前组织", "Current organization")}</span>}
                    <span className="text-slate-500">{t("成员数：{count}", "Members: {count}", { count: item.member_count })}</span>
                  </div>
                  <p className="mt-3 break-all text-xs text-slate-400">ID: {item.id}</p>
                </Link>
                <div className="flex flex-wrap gap-2">
                  {current?.id !== item.id && <button type="button" className="amp-button amp-button-secondary" disabled={organizationBusy}
                    onClick={() => void activate(item.id)}>{t("切换到此组织", "Switch to organization")}</button>}
                </div>
              </div>
            </article>
          ))}</div>}

      <dialog ref={dialogRef} aria-labelledby="organization-dialog-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { event.preventDefault(); if (!organizationBusy) setEditorOpen(false); }}
        onClose={() => setEditorOpen(false)}>
        <h2 id="organization-dialog-title" className="mb-5 text-lg font-semibold">{t("创建组织", "Create organization")}</h2>
        <form onSubmit={save} noValidate>
          <label htmlFor="organization-name" className="mb-2 block text-sm font-medium">{t("组织名称", "Organization name")}</label>
          <input id="organization-name" autoFocus value={name} maxLength={80} disabled={organizationBusy}
            onChange={(event) => setName(event.target.value)} placeholder={t("例如：产品团队", "For example: Product Team")}
            className="amp-workspace-control w-full" />
          <p className="mt-2 text-xs leading-5 text-slate-500">{t("最多 80 个字符。自定义名称按原文保存，不会自动翻译。", "Up to 80 characters. Custom names are saved as entered and are not translated.")}</p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="amp-button amp-button-secondary" disabled={organizationBusy} onClick={() => setEditorOpen(false)}>{t("取消", "Cancel")}</button>
            <button type="submit" className="amp-button amp-button-primary" disabled={organizationBusy}>
              {organizationBusy ? t("保存中...", "Saving...") : t("创建", "Create")}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
