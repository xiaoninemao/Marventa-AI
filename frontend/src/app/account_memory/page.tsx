"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import type { Translate } from "@/i18n/locale";
import {
  fetch_account_memories,
  fetch_social_accounts,
  import_social_account_cookie,
  inspect_social_login,
  save_account_memory,
  save_social_login,
  start_social_login,
  update_social_account,
  type LoginPreview,
} from "@/services/api_client";
import type { AccountMemory, SocialAccount } from "@/types/publishing";

type ImportMode = "quick" | "manual";
type PlatformKey = "xiaohongshu" | "douyin";

const emptyImport = {
  platform: "xiaohongshu" as PlatformKey,
  account_type: "ordinary",
  cookie_format: "json",
  account_name: "",
  profile_url: "",
  cookie_content: "",
  remark: "",
  platform_user_id: "",
  followers: "",
  fresh: false,
  account_id: "",
};

const emptyMemoryDraft = {
  brand_positioning: "",
  target_users: "",
  product_selling_points: "",
  content_style: "",
  banned_expressions: "",
  common_tags: "",
  high_performing_content: "",
  low_performing_directions: "",
  ai_operation_lessons: "",
};

const getPlatformTabs = (t: Translate): Array<{ key: PlatformKey; label: string; accountLabel: string }> => [
  { key: "xiaohongshu", label: t("小红书", "Xiaohongshu"), accountLabel: t("小红书号", "Xiaohongshu ID") },
  { key: "douyin", label: t("抖音", "Douyin"), accountLabel: t("抖音号", "Douyin ID") },
];

function platformLabel(platform: string, t: Translate) {
  return platform === "douyin" ? t("抖音", "Douyin") : t("小红书", "Xiaohongshu");
}

function defaultAccountName(platform: string) {
  return platform === "douyin" ? "抖音账号" : "小红书账号";
}

function accountStatusLabel(account?: SocialAccount) {
  if (!account) return "";
  if (account.status === "pending_identification") return "待识别";
  if (account.status === "authorized" || account.cookie_status === "valid") return "在线";
  return account.status || account.cookie_status || "未校验";
}

function statusDisplayLabel(status: string, t: Translate) {
  switch (status) {
    case "待识别":
    case "pending_identification":
      return t("待识别", "Awaiting identification");
    case "在线":
    case "authorized":
      return t("在线", "Online");
    case "未校验":
      return t("未校验", "Not verified");
    case "valid":
      return t("有效", "Valid");
    case "invalid":
      return t("无效", "Invalid");
    case "expired":
      return t("已过期", "Expired");
    case "pending":
      return t("待校验", "Pending verification");
    case "unknown":
      return t("未知", "Unknown");
    default:
      return status;
  }
}

function displayAccountStatus(account: SocialAccount, t: Translate) {
  return statusDisplayLabel(accountStatusLabel(account), t);
}

function cookieTypeLabel(t: Translate, account?: SocialAccount) {
  if (!account) return "";
  if (account.profile?.import_mode === "manual_cookie") return t("手动 Cookie", "Manual cookie");
  if (account.profile?.import_mode === "quick_login" || account.session_dir) return t("浏览器登录态", "Browser session");
  return statusDisplayLabel(account.cookie_status || "", t);
}

function profileText(account: SocialAccount, key: string) {
  const value = account.profile?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function memoryToDraft(memory?: AccountMemory) {
  if (!memory) return { ...emptyMemoryDraft };
  return {
    brand_positioning: memory.brand_positioning || "",
    target_users: memory.target_users || "",
    product_selling_points: memory.product_selling_points || "",
    content_style: memory.content_style || "",
    banned_expressions: memory.banned_expressions.join("\n"),
    common_tags: memory.common_tags.join("\n"),
    high_performing_content: memory.high_performing_content.join("\n"),
    low_performing_directions: memory.low_performing_directions.join("\n"),
    ai_operation_lessons: memory.ai_operation_lessons.join("\n"),
  };
}

export default function AccountMemoryPage() {
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const platformTabs = getPlatformTabs(t);
  const router = useRouter();
  const { user, loading } = useAuth();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [memories, setMemories] = useState<AccountMemory[]>([]);
  const [activeAccountId, setActiveAccountId] = useState("");
  const [activeMemoryId, setActiveMemoryId] = useState("");
  const [memoryDraft, setMemoryDraft] = useState({ ...emptyMemoryDraft });
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("quick");
  const [importDraft, setImportDraft] = useState({ ...emptyImport });
  const [loginPreview, setLoginPreview] = useState<LoginPreview | null>(null);
  const [loginSessionId, setLoginSessionId] = useState("");
  const [activePlatform, setActivePlatform] = useState<PlatformKey>("xiaohongshu");
  const [accountQuery, setAccountQuery] = useState("");
  const [nicknameQuery, setNicknameQuery] = useState("");
  const [statusQuery, setStatusQuery] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/");
  }, [loading, router, user]);

  const loadAll = async () => {
    const [accountRes, memoryRes] = await Promise.all([
      fetch_social_accounts(),
      fetch_account_memories(),
    ]);
    if (accountRes.success) {
      setAccounts(accountRes.data);
      setActiveAccountId((current) => current || accountRes.data[0]?.id || "");
    }
    if (memoryRes.success) setMemories(memoryRes.data);
  };

  const loadAccountData = useEffectEvent(() => {
    if (user) loadAll().catch((err) => showError(localizeErrorMessage(err instanceof Error ? err.message : t("账号信息读取失败", "Failed to load account information"), locale)));
  });

  useEffect(() => {
    loadAccountData();
  }, [user]);

  const activePlatformDef = platformTabs.find((item) => item.key === activePlatform) || platformTabs[0];
  const activeAccount = accounts.find((item) => item.id === activeAccountId);
  const activeMemory = useMemo(() => {
    if (!activeAccount) return undefined;
    return memories.find((item) => item.platform === activeAccount.platform && item.account_name === activeAccount.account_name);
  }, [activeAccount, memories]);

  useEffect(() => {
    setActiveMemoryId(activeMemory?.id || "");
    setMemoryDraft(memoryToDraft(activeMemory));
  }, [activeMemory?.id]);

  const platformAccounts = useMemo(() => {
    const accountNeedle = accountQuery.trim().toLowerCase();
    const nicknameNeedle = nicknameQuery.trim().toLowerCase();
    return accounts
      .filter((account) => account.platform === activePlatform)
      .filter((account) => !accountNeedle || (account.platform_user_id || account.account_name || "").toLowerCase().includes(accountNeedle))
      .filter((account) => !nicknameNeedle || [account.nickname, account.remark, account.account_name].join(" ").toLowerCase().includes(nicknameNeedle))
      .filter((account) => !statusQuery || accountStatusLabel(account) === statusQuery);
  }, [accountQuery, accounts, activePlatform, nicknameQuery, statusQuery]);

  const openImportPanel = (account?: SocialAccount) => {
    setImportDraft({
      ...emptyImport,
      platform: (account?.platform as PlatformKey) || activePlatform,
      account_name: account?.account_name || "",
      account_id: account?.id || "",
      remark: account?.remark || "",
      platform_user_id: account?.platform_user_id || "",
      followers: account ? profileText(account, "followers") : "",
    });
    setLoginPreview(null);
    setLoginSessionId("");
    setImportMode("quick");
    setShowImport(true);
  };

  const startQuickLogin = async () => {
    const accountName = importDraft.account_name.trim() || defaultAccountName(importDraft.platform);
    setSaving(true);
    setToast("");
    try {
      const res = await start_social_login(importDraft.platform, accountName, importDraft.account_id, importDraft.fresh);
      setImportDraft((item) => ({ ...item, account_name: accountName }));
      setLoginSessionId(res.data.login_session_id || "");
      setToast(t("已打开平台登录窗口，扫码后回到这里点击“识别账号”。", "The platform login window is open. Scan the QR code, then return here and click “Identify account”."));
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("打开登录失败", "Failed to open login window"), locale));
    } finally {
      setSaving(false);
    }
  };

  const inspectQuickLogin = async () => {
    if (!loginSessionId) {
      showError(t("请先打开登录窗口并完成扫码登录。", "Open the login window and sign in by scanning the QR code first."));
      return;
    }
    setSaving(true);
    setToast("");
    try {
      const res = await inspect_social_login(loginSessionId);
      setLoginPreview(res.data);
      setImportDraft((item) => ({
        ...item,
        account_name: res.data.nickname || item.account_name,
        profile_url: res.data.profile_url || item.profile_url,
        platform_user_id: res.data.platform_user_id || item.platform_user_id,
        followers: res.data.followers || item.followers,
      }));
      setToast(res.data.nickname || res.data.platform_user_id ? t("账号已识别，请确认后保存。", "Account identified. Confirm the details and save.") : t("未完全识别，可手动补充后保存。", "Some details could not be identified. Add them manually before saving."));
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("识别失败，可手动补充后保存", "Identification failed. Add the details manually before saving."), locale));
    } finally {
      setSaving(false);
    }
  };

  const saveQuickLogin = async () => {
    if (!loginSessionId) {
      showError(t("请先打开登录窗口并完成扫码登录。", "Open the login window and sign in by scanning the QR code first."));
      return;
    }
    const accountName = importDraft.account_name.trim() || loginPreview?.nickname || defaultAccountName(importDraft.platform);
    setSaving(true);
    setToast("");
    try {
      const res = await save_social_login(importDraft.platform, accountName, loginSessionId, {
        account_id: importDraft.account_id,
        nickname: loginPreview?.nickname || "",
        avatar_url: loginPreview?.avatar_url || "",
        profile_url: importDraft.profile_url || loginPreview?.profile_url || "",
        platform_user_id: importDraft.platform_user_id || loginPreview?.platform_user_id || "",
        followers: importDraft.followers || loginPreview?.followers || "",
        remark: importDraft.remark,
      });
      await loadAll();
      setActiveAccountId(res.data.id);
      setActivePlatform(res.data.platform as PlatformKey);
      setShowImport(false);
      setToast(t("账号登录态已保存。", "Account session saved."));
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("保存登录态失败", "Failed to save account session"), locale));
    } finally {
      setSaving(false);
    }
  };

  const importCookie = async () => {
    if (!importDraft.cookie_content.trim()) {
      showError(t("请粘贴 Cookie 内容", "Paste the cookie contents"));
      return;
    }
    setSaving(true);
    setToast("");
    try {
      const res = await import_social_account_cookie(importDraft);
      await loadAll();
      setActiveAccountId(res.data.id);
      setActivePlatform(res.data.platform as PlatformKey);
      setShowImport(false);
      setToast(t("账号已校验并导入。", "Account verified and imported."));
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("导入失败", "Import failed"), locale));
    } finally {
      setSaving(false);
    }
  };

  const saveAccountBasics = async (account: SocialAccount, fields: { remark?: string; platform_user_id?: string; followers?: string }) => {
    setSaving(true);
    try {
      const res = await update_social_account(account.id, fields);
      setAccounts((items) => items.map((item) => item.id === account.id ? res.data : item));
      setToast(t("账号资料已保存", "Account details saved"));
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("保存账号资料失败", "Failed to save account details"), locale));
    } finally {
      setSaving(false);
      window.setTimeout(() => setToast(""), 1800);
    }
  };

  const saveMemory = async () => {
    if (!activeAccount) return;
    setSaving(true);
    try {
      const res = await save_account_memory({
        id: activeMemoryId || undefined,
        platform: activeAccount.platform,
        account_name: activeAccount.account_name,
        brand_positioning: memoryDraft.brand_positioning,
        target_users: memoryDraft.target_users,
        product_selling_points: memoryDraft.product_selling_points,
        content_style: memoryDraft.content_style,
        banned_expressions: lines(memoryDraft.banned_expressions),
        common_tags: lines(memoryDraft.common_tags),
        high_performing_content: lines(memoryDraft.high_performing_content),
        low_performing_directions: lines(memoryDraft.low_performing_directions),
        ai_operation_lessons: lines(memoryDraft.ai_operation_lessons),
      });
      setActiveMemoryId(res.data.id);
      setMemories((items) => [res.data, ...items.filter((item) => item.id !== res.data.id)]);
      setToast(t("账号记忆已保存", "Account Memory saved"));
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("保存账号记忆失败", "Failed to save Account Memory"), locale));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="amp-redesign amp-workspace-page">
      <div className="amp-workspace-header amp-workspace-header-actions-only">
        <div className="amp-workspace-actions">
          <span className="text-sm text-emerald-600">{toast || (saving ? t("处理中...", "Processing...") : "")}</span>
          <button type="button" onClick={() => openImportPanel()} className="amp-button amp-button-primary">{t("添加账号", "Add account")}</button>
        </div>
      </div>

      <section className="amp-workspace-card p-5">
        <div className="amp-workspace-toolbar grid lg:grid-cols-[auto_1fr_auto_1fr_auto_1fr] lg:items-center">
          <label className="text-sm font-medium text-slate-500">{activePlatformDef.accountLabel}</label>
          <input value={accountQuery} onChange={(event) => setAccountQuery(event.target.value)} placeholder={t("请输入{accountLabel}", "Enter {accountLabel}", { accountLabel: activePlatformDef.accountLabel })} className="amp-workspace-control" />
          <label className="text-sm font-medium text-slate-500">{t("昵称/备注", "Nickname / Notes")}</label>
          <input value={nicknameQuery} onChange={(event) => setNicknameQuery(event.target.value)} placeholder={t("请输入昵称或备注关键词", "Enter a nickname or note keyword")} className="amp-workspace-control" />
          <label className="text-sm font-medium text-slate-500">{t("在线状态", "Online status")}</label>
          <select value={statusQuery} onChange={(event) => setStatusQuery(event.target.value)} className="amp-workspace-control text-slate-500">
            <option value="">{t("全部状态", "All statuses")}</option>
            <option value="在线">{t("在线", "Online")}</option>
            <option value="待识别">{t("待识别", "Awaiting identification")}</option>
            <option value="未校验">{t("未校验", "Not verified")}</option>
          </select>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {platformTabs.map((tab) => {
            const count = accounts.filter((account) => account.platform === tab.key).length;
            return (
              <button key={tab.key} type="button" onClick={() => setActivePlatform(tab.key)} className={`rounded border px-3 py-1 text-sm transition ${activePlatform === tab.key ? "border-blue-200 bg-blue-50 text-blue-600" : "border-slate-200 bg-slate-100 text-slate-500 hover:border-blue-200"}`}>
                {t("全部{platform}（{count}）", "All {platform} ({count})", { platform: tab.label, count })}
              </button>
            );
          })}
        </div>

        <div className="amp-workspace-table-wrap mt-6">
          <table className="amp-workspace-table min-w-[1160px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="border-r border-slate-200 px-4 py-3 font-medium">{t("头像", "Avatar")}</th>
                <th className="border-r border-slate-200 px-4 py-3 font-medium">{t("昵称", "Nickname")}</th>
                <th className="border-r border-slate-200 px-4 py-3 font-medium">{t("备注", "Notes")}</th>
                <th className="border-r border-slate-200 px-4 py-3 font-medium">{activePlatformDef.accountLabel}</th>
                <th className="border-r border-slate-200 px-4 py-3 font-medium">{t("粉丝数", "Followers")}</th>
                <th className="border-r border-slate-200 px-4 py-3 font-medium">{t("在线状态", "Online status")}</th>
                <th className="border-r border-slate-200 px-4 py-3 font-medium">{t("登录态", "Session")}</th>
                <th className="px-4 py-3 font-medium">{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody className="text-slate-600">
              {platformAccounts.length === 0 ? (
                <tr><td colSpan={8} className="h-20 text-center text-slate-400">{t("暂无数据", "No data")}</td></tr>
              ) : (
                platformAccounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    active={activeAccountId === account.id}
                    onSelect={() => setActiveAccountId(account.id)}
                    onRelogin={() => openImportPanel(account)}
                    onSave={saveAccountBasics}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="amp-workspace-card mt-5 p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("编辑账号记忆", "Edit Account Memory")}</h2>
            <p className="mt-1 text-sm text-slate-500">{activeAccount ? `${platformLabel(activeAccount.platform, t)} · ${activeAccount.nickname || activeAccount.account_name}` : t("请选择一个账号", "Select an account")}</p>
          </div>
          <button type="button" onClick={saveMemory} disabled={!activeAccount || saving} className="amp-button amp-button-primary">{t("保存记忆", "Save memory")}</button>
        </div>
        {activeAccount ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <MemoryField label={t("品牌定位", "Brand positioning")} value={memoryDraft.brand_positioning} onChange={(value) => setMemoryDraft((item) => ({ ...item, brand_positioning: value }))} />
            <MemoryField label={t("目标用户", "Target audience")} value={memoryDraft.target_users} onChange={(value) => setMemoryDraft((item) => ({ ...item, target_users: value }))} />
            <MemoryField label={t("产品卖点", "Product selling points")} value={memoryDraft.product_selling_points} onChange={(value) => setMemoryDraft((item) => ({ ...item, product_selling_points: value }))} />
            <MemoryField label={t("内容风格", "Content style")} value={memoryDraft.content_style} onChange={(value) => setMemoryDraft((item) => ({ ...item, content_style: value }))} />
            <MemoryField label={t("禁用表达（一行一个）", "Banned expressions (one per line)")} value={memoryDraft.banned_expressions} onChange={(value) => setMemoryDraft((item) => ({ ...item, banned_expressions: value }))} />
            <MemoryField label={t("常用标签（一行一个）", "Common tags (one per line)")} value={memoryDraft.common_tags} onChange={(value) => setMemoryDraft((item) => ({ ...item, common_tags: value }))} />
            <MemoryField label={t("高表现内容（一行一个）", "High-performing content (one per line)")} value={memoryDraft.high_performing_content} onChange={(value) => setMemoryDraft((item) => ({ ...item, high_performing_content: value }))} />
            <MemoryField label={t("AI 运营经验（一行一个）", "AI operational lessons (one per line)")} value={memoryDraft.ai_operation_lessons} onChange={(value) => setMemoryDraft((item) => ({ ...item, ai_operation_lessons: value }))} />
          </div>
        ) : (
          <div className="rounded border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{t("选择账号后可编辑账号记忆。", "Select an account to edit its memory.")}</div>
        )}
      </section>

      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{importDraft.account_id ? t("续登/重新识别账号", "Renew login / Re-identify account") : t("添加账号", "Add account")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("扫码后先识别账号信息，再确认保存；识别失败也可以手动补充。", "After scanning the QR code, identify the account, then confirm and save. If identification fails, enter the details manually.")}</p>
              </div>
              <button type="button" onClick={() => setShowImport(false)} className="amp-button amp-button-ghost">{t("关闭", "Close")}</button>
            </div>

            <div className="mb-4 flex w-fit rounded-lg border border-slate-200 p-1 dark:border-slate-800">
              {[["quick", t("快速登录", "Quick login")], ["manual", t("手动导入", "Manual import")]].map(([key, label]) => (
                <button key={key} type="button" onClick={() => setImportMode(key as ImportMode)} className={`amp-button ${importMode === key ? "amp-button-primary" : "amp-button-ghost"}`}>{label}</button>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-500">
                {t("平台", "Platform")}
                <select value={importDraft.platform} onChange={(event) => setImportDraft((item) => ({ ...item, platform: event.target.value as PlatformKey, account_id: "" }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <option value="xiaohongshu">{t("小红书", "Xiaohongshu")}</option>
                  <option value="douyin">{t("抖音", "Douyin")}</option>
                </select>
              </label>
              <label className="text-sm text-slate-500">
                {t("账号名称（识别前可为空）", "Account name (optional before identification)")}
                <input value={importDraft.account_name} onChange={(event) => setImportDraft((item) => ({ ...item, account_name: event.target.value }))} placeholder={t("登录识别后会自动带入", "Filled automatically after account identification")} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2" />
              </label>
            </div>

            {importMode === "quick" && (
              <div className="mt-4 space-y-4 rounded-lg border border-slate-200 p-4">
                <label className="flex items-center gap-2 text-sm text-slate-500">
                  <input type="checkbox" checked={importDraft.fresh} onChange={(event) => setImportDraft((item) => ({ ...item, fresh: event.target.checked }))} />
                  {t("新建独立登录态（用于绑定另一个同平台账号）", "Create a separate session (to link another account on this platform)")}
                </label>
                <div className="grid gap-3 md:grid-cols-3">
                  <PreviewField label={t("昵称（只读）", "Nickname (read-only)")} value={loginPreview?.nickname || t("未识别", "Not identified")} readOnly />
                  <PreviewField label={t("{platform}号", "{platform} ID", { platform: platformLabel(importDraft.platform, t) })} value={importDraft.platform_user_id} onChange={(value) => setImportDraft((item) => ({ ...item, platform_user_id: value }))} placeholder={t("未识别时手动补充", "Enter manually if not identified")} />
                  <PreviewField label={t("粉丝数", "Followers")} value={importDraft.followers} onChange={(value) => setImportDraft((item) => ({ ...item, followers: value }))} placeholder={t("例如 1.2万", "e.g. 12,000")} />
                  <PreviewField label={t("备注", "Notes")} value={importDraft.remark} onChange={(value) => setImportDraft((item) => ({ ...item, remark: value }))} placeholder={t("内部备注，可编辑", "Editable internal notes")} />
                  <PreviewField label={t("主页链接", "Profile URL")} value={importDraft.profile_url} onChange={(value) => setImportDraft((item) => ({ ...item, profile_url: value }))} placeholder={t("自动识别或手动粘贴", "Detected automatically or pasted manually")} />
                </div>
                {loginPreview?.avatar_url && (
                  <div className="flex items-center gap-3 rounded bg-slate-50 p-3 text-sm text-slate-500">
                    <img src={loginPreview.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
                    <span>{t("已识别头像", "Avatar identified")}</span>
                  </div>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={startQuickLogin} className="amp-button amp-button-secondary">{t("打开登录窗口", "Open login window")}</button>
                  <button type="button" onClick={inspectQuickLogin} className="amp-button amp-button-secondary">{t("识别账号", "Identify account")}</button>
                  <button type="button" onClick={saveQuickLogin} className="amp-button amp-button-primary">{t("确认保存", "Confirm and save")}</button>
                </div>
              </div>
            )}

            {importMode === "manual" && (
              <div className="mt-4 space-y-3 rounded-lg border border-slate-200 p-4">
                <textarea value={importDraft.cookie_content} onChange={(event) => setImportDraft((item) => ({ ...item, cookie_content: event.target.value }))} rows={8} placeholder={t("粘贴浏览器导出的 Cookie JSON，或 \"a=b; c=d\" 格式", "Paste cookies exported from your browser as JSON or in \"a=b; c=d\" format")} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                <div className="flex justify-end">
                  <button type="button" onClick={importCookie} className="amp-button amp-button-primary">{t("校验并导入账号", "Verify and import account")}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountRow(props: {
  account: SocialAccount;
  active: boolean;
  onSelect: () => void;
  onRelogin: () => void;
  onSave: (account: SocialAccount, fields: { remark?: string; platform_user_id?: string; followers?: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const { account, active, onSelect, onRelogin, onSave } = props;
  const [remark, setRemark] = useState(account.remark || "");
  const [platformUserId, setPlatformUserId] = useState(account.platform_user_id || "");
  const [followers, setFollowers] = useState(profileText(account, "followers"));

  useEffect(() => {
    setRemark(account.remark || "");
    setPlatformUserId(account.platform_user_id || "");
    setFollowers(profileText(account, "followers"));
  }, [account.id, account.remark, account.platform_user_id, account.profile]);

  return (
    <tr className={`border-t border-slate-200 ${active ? "bg-blue-50/60" : ""}`}>
      <td className="border-r border-slate-100 px-4 py-3">
        {account.avatar_url ? <img src={account.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-xs text-slate-500">{t("未识别", "Not identified")}</div>}
      </td>
      <td className="border-r border-slate-100 px-4 py-3 font-medium">{account.nickname || t("未识别", "Not identified")}</td>
      <td className="border-r border-slate-100 px-4 py-3">
        <input value={remark} onChange={(event) => setRemark(event.target.value)} onBlur={() => remark !== account.remark && onSave(account, { remark })} className="h-9 w-40 rounded border border-slate-200 px-2 text-sm" />
      </td>
      <td className="border-r border-slate-100 px-4 py-3">
        <input value={platformUserId} onChange={(event) => setPlatformUserId(event.target.value)} onBlur={() => platformUserId !== account.platform_user_id && onSave(account, { platform_user_id: platformUserId })} placeholder={t("未识别", "Not identified")} className="h-9 w-40 rounded border border-slate-200 px-2 text-sm" />
      </td>
      <td className="border-r border-slate-100 px-4 py-3">
        <input value={followers} onChange={(event) => setFollowers(event.target.value)} onBlur={() => followers !== profileText(account, "followers") && onSave(account, { followers })} placeholder={t("未识别", "Not identified")} className="h-9 w-28 rounded border border-slate-200 px-2 text-sm" />
      </td>
      <td className="border-r border-slate-100 px-4 py-3">{displayAccountStatus(account, t)}</td>
      <td className="border-r border-slate-100 px-4 py-3">{cookieTypeLabel(t, account)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onSelect} className="font-semibold text-blue-600">{t("编辑记忆", "Edit memory")}</button>
          <button type="button" onClick={onRelogin} className="font-semibold text-blue-600">{t("续登识别", "Renew login & identify")}</button>
        </div>
      </td>
    </tr>
  );
}

function MemoryField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm text-slate-500">
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
    </label>
  );
}

function PreviewField(props: { label: string; value: string; onChange?: (value: string) => void; placeholder?: string; readOnly?: boolean }) {
  return (
    <label className="block text-sm text-slate-500">
      {props.label}
      <input value={props.value} readOnly={props.readOnly} onChange={(event) => props.onChange?.(event.target.value)} placeholder={props.placeholder} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100" />
    </label>
  );
}
