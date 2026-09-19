const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8765";

import { apiError } from "@/i18n/errors";
import type {
  ParseResponse, HistoryListResponse, HistoryItemResponse, AIAnalysis,
} from "@/types/market_insight";
import type {
  AuthResponse,
  UserResponse,
  Organization,
  OrganizationDetail,
  OrganizationDetails,
  OrganizationMember,
} from "@/types/auth";
import type { CaseListResponse, CaseItemResponse, CaseImportTaskResponse } from "@/types/case_library";
import type {
  SessionListResponse, SessionDetailResponse, ChatResponse, GenerateResponse,
  VersionListResponse, VersionRestoreResponse,
} from "@/types/content_generator";
import type {
  AccountMemory, ContentProject, ItemResponse, ListResponse, PublishMetric, PublishReview, PublishTask, ReviewConclusion, SocialAccount,
} from "@/types/publishing";
import type { NotificationListResponse, NotificationMutationResponse } from "@/types/notifications";

// ── Auth token management ──

let _auth_token: string | null = null;

export function set_auth_token(token: string | null) {
  _auth_token = token;
}

export function clear_auth_token() {
  _auth_token = null;
}

function auth_headers(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (_auth_token) {
    headers["Authorization"] = `Bearer ${_auth_token}`;
  }
  return headers;
}

function normalize_network_error(error: unknown): never {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    throw apiError("读取超时，请稍后重试，或粘贴正文后使用半自动识别。");
  }
  if (error instanceof TypeError) {
    throw apiError(`无法连接后端服务：${API_BASE}。请确认后端已启动。`);
  }
  throw error;
}

async function response_error(res: Response, fallback: string): Promise<Error> {
  try {
    const err = await res.clone().json();
    return apiError(err.detail || err.message || fallback);
  } catch {
    const text = await res.text().catch(() => "");
    return apiError(text || fallback);
  }
}

// ── Auth API ──

export async function login_user(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).catch(normalize_network_error);
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Login failed");
  }
  return res.json();
}

export async function register_user(email: string, password: string, nickname = ""): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, nickname }),
  }).catch(normalize_network_error);
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Registration failed");
  }
  return res.json();
}

export async function update_me(updates: {
  nickname?: string; avatar_url?: string;
}): Promise<UserResponse> {
  const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Update failed");
  }
  return res.json();
}

export async function verify_token(): Promise<UserResponse> {
  const res = await fetch(`${API_BASE}/api/v1/auth/verify`, {
    method: "POST",
    headers: auth_headers(),
  }).catch(normalize_network_error);
  if (!res.ok) throw apiError("Invalid token");
  return res.json();
}

// ── Organizations API ──

export async function fetch_organizations(): Promise<ListResponse<OrganizationDetails>> {
  const res = await fetch(`${API_BASE}/api/v1/organizations`, { headers: auth_headers() }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not load organizations");
  return res.json();
}

export async function fetch_organization(id: string): Promise<ItemResponse<OrganizationDetail>> {
  const res = await fetch(`${API_BASE}/api/v1/organizations/${encodeURIComponent(id)}`, {
    headers: auth_headers(),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not load organization");
  return res.json();
}

export async function create_organization(name: string): Promise<ItemResponse<OrganizationDetails>> {
  const res = await fetch(`${API_BASE}/api/v1/organizations`, {
    method: "POST", headers: { "Content-Type": "application/json", ...auth_headers() }, body: JSON.stringify({ name }),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not create organization");
  return res.json();
}

export async function rename_organization(id: string, name: string): Promise<ItemResponse<OrganizationDetails>> {
  const res = await fetch(`${API_BASE}/api/v1/organizations/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", ...auth_headers() }, body: JSON.stringify({ name }),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not rename organization");
  return res.json();
}

export async function update_organization_avatar(id: string, avatarUrl: string): Promise<ItemResponse<OrganizationDetails>> {
  const res = await fetch(`${API_BASE}/api/v1/organizations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ avatar_url: avatarUrl }),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not update organization avatar");
  return res.json();
}

export async function invite_organization_member(
  id: string, email: string, role: "admin" | "member",
): Promise<ItemResponse<OrganizationMember>> {
  const res = await fetch(`${API_BASE}/api/v1/organizations/${encodeURIComponent(id)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ email, role }),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not add organization member");
  return res.json();
}

export async function update_organization_member_role(
  id: string, userId: string, role: "admin" | "member",
): Promise<ItemResponse<OrganizationMember>> {
  const res = await fetch(
    `${API_BASE}/api/v1/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify({ role }),
    },
  ).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not update member permissions");
  return res.json();
}

export async function switch_organization(id: string): Promise<ItemResponse<Organization>> {
  const res = await fetch(`${API_BASE}/api/v1/organizations/${encodeURIComponent(id)}/switch`, {
    method: "POST", headers: auth_headers(),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not switch organization");
  return res.json();
}

// ── Notifications API ──

export async function fetch_notifications(limit = 30): Promise<NotificationListResponse> {
  const res = await fetch(`${API_BASE}/api/v1/notifications?limit=${limit}`, {
    headers: auth_headers(),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not load notifications");
  return res.json();
}

export async function mark_notification_read(id: string): Promise<NotificationMutationResponse> {
  const res = await fetch(`${API_BASE}/api/v1/notifications/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
    headers: auth_headers(),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not update notification");
  return res.json();
}

export async function mark_all_notifications_read(): Promise<NotificationMutationResponse> {
  const res = await fetch(`${API_BASE}/api/v1/notifications/read-all`, {
    method: "POST",
    headers: auth_headers(),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not update notifications");
  return res.json();
}

// ── Market Insight API ──
export async function parse_file(file: File): Promise<ParseResponse> {
  const form_data = new FormData();
  form_data.append("file", file);

  const url = `${API_BASE}/api/v1/market_insight/parse`;

  const res = await fetch(url, {
    method: "POST",
    body: form_data,
    headers: auth_headers(),
  });
  if (!res.ok) {
    const error = await res.json();
    throw apiError(error.detail || "Parse failed");
  }
  return res.json();
}

export async function parse_repo(repo_url: string): Promise<ParseResponse> {
  const url = `${API_BASE}/api/v1/market_insight/parse_repo`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ repo_url }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw apiError(error.detail || "Repository parse failed");
  }
  return res.json();
}

export async function fetch_history(search = ""): Promise<HistoryListResponse> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);

  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history${qs ? "?" + qs : ""}`, {
    headers: auth_headers(),
  });
  return res.json();
}

export async function fetch_history_item(id: string): Promise<HistoryItemResponse> {
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history/${id}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Record not found");
  return res.json();
}

export async function update_history_item(id: string, analysis: AIAnalysis): Promise<HistoryItemResponse> {
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ ai_analysis: analysis }),
  });
  if (!res.ok) throw apiError("Update failed");
  return res.json();
}

export async function delete_history_item(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history/${id}`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Delete failed");
}

export async function create_manual_insight(analysis: AIAnalysis): Promise<HistoryItemResponse> {
  const res = await fetch(`${API_BASE}/api/v1/market_insight/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ ai_analysis: analysis }),
  });
  if (!res.ok) throw apiError("Create failed");
  return res.json();
}

// ── Case Library API ──

export async function fetch_cases(limit = 50, offset = 0, content_type = "", category = "", search = ""): Promise<CaseListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (content_type) params.set("content_type", content_type);
  if (category) params.set("category", category);
  if (search) params.set("search", search);

  const res = await fetch(`${API_BASE}/api/v1/case_library/cases?${params.toString()}`, {
    headers: auth_headers(),
  });
  return res.json();
}

export async function fetch_my_cases(limit = 100, offset = 0, search = ""): Promise<CaseListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (search) params.set("search", search);

  const res = await fetch(`${API_BASE}/api/v1/case_library/my/cases?${params.toString()}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Failed to fetch cases");
  return res.json();
}

export async function fetch_my_favorites(limit = 100, offset = 0, search = ""): Promise<CaseListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (search) params.set("search", search);

  const res = await fetch(`${API_BASE}/api/v1/case_library/my/favorites?${params.toString()}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Failed to fetch favorites");
  return res.json();
}

export async function fetch_case(id: string): Promise<CaseItemResponse> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Case not found");
  return res.json();
}

export async function create_case_import_task(
  input: string,
  manual_text = "",
  save_case = true,
): Promise<CaseImportTaskResponse> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/import_tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ input, manual_text, save_case }),
    signal: AbortSignal.timeout(45000),
  }).catch(normalize_network_error);
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Import task failed");
  }
  return res.json();
}

export async function create_video_case(
  title: string, description: string, tags: string[], video_file: File,
  is_public = false, category = "agency", source = "",
): Promise<CaseItemResponse> {
  const form = new FormData();
  form.append("title", title);
  form.append("content_type", "video");
  form.append("category", category);
  form.append("description", description);
  form.append("tags", JSON.stringify(tags));
  form.append("is_public", String(is_public));
  if (source) form.append("source", source);
  form.append("video", video_file);

  const res = await fetch(`${API_BASE}/api/v1/case_library/cases`, {
    method: "POST",
    headers: auth_headers(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Create case failed");
  }
  return res.json();
}

export async function create_image_text_case(
  title: string, description: string, tags: string[], image_files: File[],
  is_public = false, category = "agency", source = "",
): Promise<CaseItemResponse> {
  const form = new FormData();
  form.append("title", title);
  form.append("content_type", "image_text");
  form.append("category", category);
  form.append("description", description);
  form.append("tags", JSON.stringify(tags));
  form.append("is_public", String(is_public));
  if (source) form.append("source", source);
  image_files.forEach((f) => form.append("images", f));

  const res = await fetch(`${API_BASE}/api/v1/case_library/cases`, {
    method: "POST",
    headers: auth_headers(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Create case failed");
  }
  return res.json();
}

export async function fetch_admin_cases(limit = 100, offset = 0): Promise<CaseListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const res = await fetch(`${API_BASE}/api/v1/case_library/admin/cases?${params.toString()}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Unauthorized");
  return res.json();
}

export async function update_case(
  id: string, payload: { title?: string; description?: string; tags?: string[]; is_public?: boolean; category?: string; source?: string },
): Promise<CaseItemResponse> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Update case failed");
  }
  return res.json();
}

export async function replace_case_media(
  id: string, video_file?: File | null, image_files?: File[],
): Promise<CaseItemResponse> {
  const form = new FormData();
  if (video_file) form.append("video", video_file);
  if (image_files && image_files.length > 0) {
    image_files.forEach((f) => form.append("images", f));
  }

  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}/media`, {
    method: "POST",
    headers: auth_headers(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Replace media failed");
  }
  return res.json();
}

export async function delete_case(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Delete case failed");
  }
}

export async function favorite_case(id: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}/favorite`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Favorite failed");
  }
  return res.json();
}

export async function unfavorite_case(id: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}/favorite`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Unfavorite failed");
  }
  return res.json();
}

export async function analyze_case(id: string): Promise<{ success: boolean; message: string; data: { status: string } }> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}/analyze`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Analyze failed");
  }
  return res.json();
}

// ── Content Generator API ──

export async function create_session(): Promise<SessionDetailResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Create session failed");
  }
  return res.json();
}

export async function fetch_sessions(): Promise<SessionListResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions`, {
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Fetch sessions failed");
  }
  return res.json();
}

export async function fetch_session(id: string): Promise<SessionDetailResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}`, {
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Fetch session failed");
  }
  return res.json();
}

export async function send_chat_message(
  id: string, message: string,
  insight_ids: string[] = [], case_ids: string[] = [],
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ message, insight_ids, case_ids }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Send message failed");
  }
  return res.json();
}

export async function set_session_references(
  id: string, insight_ids: string[], case_ids: string[],
): Promise<SessionDetailResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}/references`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ insight_ids, case_ids }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Set references failed");
  }
  return res.json();
}

export async function generate_cards(id: string): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}/generate`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Generate failed");
  }
  return res.json();
}

export async function modify_card(
  session_id: string, card_id: string, instruction: string, signal?: AbortSignal,
): Promise<{ success: boolean; message: string; data: { card: import("@/types/content_generator").ContentCard } }> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/cards/${card_id}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ instruction }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Modify card failed");
  }
  return res.json();
}

export async function delete_session(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Delete session failed");
  }
}

// ── Generate document from session cards ──

export async function generate_document(session_id: string): Promise<{
  success: boolean; message: string; data: {
    id?: string; title?: string; content?: string;
    source_session_id: string; created_at?: string;
    status?: string;
  }
}> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/generate_document`, {
    method: "POST",
    headers: auth_headers(),
    keepalive: true,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Generate document failed");
  }
  return res.json();
}

export async function fetch_versions(session_id: string): Promise<VersionListResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/versions`, {
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Fetch versions failed");
  }
  return res.json();
}

export async function restore_version(session_id: string, version_id: string): Promise<VersionRestoreResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/versions/${version_id}/restore`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Restore version failed");
  }
  return res.json();
}

// ── Script Library ──

export async function fetch_scripts(): Promise<{
  success: boolean; message: string; data: Array<{
    id: string; title: string; content: string;
    source_session_id: string; created_at: string; updated_at: string;
  }>
}> {
  const res = await fetch(`${API_BASE}/api/v1/portfolio/scripts`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Fetch scripts failed");
  return res.json();
}

export async function fetch_script(id: string): Promise<{
  success: boolean; message: string; data: {
    id: string; title: string; content: string;
    source_session_id: string; created_at: string; updated_at: string;
  }
}> {
  const res = await fetch(`${API_BASE}/api/v1/portfolio/scripts/${id}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Fetch script failed");
  return res.json();
}

export async function update_script(id: string, data: { title?: string; content?: string }): Promise<{
  success: boolean; message: string; data: {
    id: string; title: string; content: string;
    source_session_id: string; created_at: string; updated_at: string;
  }
}> {
  const res = await fetch(`${API_BASE}/api/v1/portfolio/scripts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw apiError("Update script failed");
  return res.json();
}

export async function delete_script(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/portfolio/scripts/${id}`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Delete script failed");
}

// ---- Publishing workbench / project archive / account memory ----

export async function save_content_project(payload: {
  source_session_id: string;
  source_card_id?: string;
  title?: string;
  xhs_account?: string;
  content_type?: string;
  platform_hint?: string;
  notes?: string;
}): Promise<ItemResponse<ContentProject>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/from_session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Save project failed");
  }
  return res.json();
}

export async function create_manual_content_project(payload: {
  title?: string;
  platform_hint?: string;
  content_type?: string;
  xhs_account?: string;
  final_snapshot?: Record<string, unknown>;
  notes?: string;
  media_assets?: Array<Record<string, unknown>>;
}): Promise<ItemResponse<ContentProject>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Create manual project failed");
  }
  return res.json();
}

export async function fetch_content_projects(xhs_account = ""): Promise<ListResponse<ContentProject>> {
  const params = new URLSearchParams();
  if (xhs_account) params.set("xhs_account", xhs_account);
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects${params.toString() ? "?" + params.toString() : ""}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Fetch projects failed");
  return res.json();
}

export async function upload_project_media(project_id: string, images: File[], video?: File | null): Promise<ItemResponse<ContentProject>> {
  const form = new FormData();
  images.forEach((image) => form.append("images", image));
  if (video) form.append("video", video);
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${project_id}/media`, {
    method: "POST",
    headers: auth_headers(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Upload project media failed");
  }
  return res.json();
}

export async function delete_project_media(project_id: string, media_id: string): Promise<ItemResponse<ContentProject>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${project_id}/media/${media_id}`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Delete project media failed");
  }
  return res.json();
}

export async function create_publish_task(payload: {
  source_session_id: string;
  source_card_id?: string;
  project_id?: string;
  platform?: string;
  account_name?: string;
  content_type?: string;
  selected_version_ids?: Record<string, string>;
  final_snapshot?: Record<string, unknown>;
  planned_publish_at?: string;
}): Promise<ItemResponse<PublishTask>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/tasks/from_session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Create publish task failed");
  }
  return res.json();
}

export async function create_publish_task_from_project(payload: {
  project_id: string;
  platform?: string;
  account_name?: string;
  content_type?: string;
  selected_version_ids?: Record<string, string>;
  planned_publish_at?: string;
}): Promise<ItemResponse<PublishTask>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/tasks/from_project`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Create publish task failed");
  }
  return res.json();
}

export async function fetch_publish_tasks(status = ""): Promise<ListResponse<PublishTask>> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const res = await fetch(`${API_BASE}/api/v1/publishing/tasks${params.toString() ? "?" + params.toString() : ""}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Fetch publish tasks failed");
  return res.json();
}

export async function update_publish_task(
  id: string,
  payload: Partial<Pick<PublishTask,
    "project_id" | "platform" | "account_name" | "content_type" | "status" |
    "selected_version_ids" | "final_snapshot" | "planned_publish_at" | "published_at" |
    "publish_link" | "platform_work_id"
  >>,
): Promise<ItemResponse<PublishTask>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/tasks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Update publish task failed");
  }
  return res.json();
}

export async function fetch_publish_metric(task_id: string): Promise<ItemResponse<PublishMetric | null>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/tasks/${task_id}/metrics`, { headers: auth_headers() });
  if (!res.ok) throw apiError("Fetch metric failed");
  return res.json();
}

export async function save_publish_metric(
  task_id: string,
  payload: Partial<Pick<PublishMetric, "views" | "likes" | "collects" | "comments" | "shares" | "followers" | "leads" | "completion_rate">>,
): Promise<ItemResponse<PublishMetric>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/tasks/${task_id}/metrics`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Save metric failed");
  }
  return res.json();
}

export async function fetch_publish_review_result(task_id: string): Promise<ItemResponse<PublishReview | null>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/tasks/${task_id}/review`, { headers: auth_headers() });
  if (!res.ok) throw apiError("Fetch review failed");
  return res.json();
}

export async function execute_publish_task(id: string, dry_run = false): Promise<ItemResponse<{ status: string }>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/tasks/${id}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ dry_run }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Publish failed");
  }
  return res.json();
}

export async function fetch_social_accounts(platform = ""): Promise<ListResponse<SocialAccount>> {
  const params = new URLSearchParams();
  if (platform) params.set("platform", platform);
  const res = await fetch(`${API_BASE}/api/v1/publishing/accounts${params.toString() ? "?" + params.toString() : ""}`, {
    headers: auth_headers(),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "账号列表读取失败");
  return res.json();
}

export async function start_social_login(platform: string, account_name: string, account_id = "", fresh = false): Promise<ItemResponse<{ status: string; login_session_id: string; session_dir: string; storage_state_file?: string; login_url: string }>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/accounts/login/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ platform, account_name, account_id, fresh }),
  }).catch(normalize_network_error);
  if (!res.ok) {
    throw await response_error(res, "打开平台登录窗口失败");
  }
  return res.json();
}

export type LoginPreview = {
  nickname: string;
  avatar_url: string;
  profile_url: string;
  platform_user_id: string;
  followers: string;
  authorized: boolean;
  cookie_count: number;
  cookie_names: string[];
  login_checked_at: string;
};

export async function inspect_social_login(login_session_id: string): Promise<ItemResponse<LoginPreview>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/accounts/login/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ login_session_id }),
  }).catch(normalize_network_error);
  if (!res.ok) {
    throw await response_error(res, "识别账号失败");
  }
  return res.json();
}

export async function save_social_login(
  platform: string,
  account_name: string,
  login_session_id = "",
  payload: Partial<LoginPreview> & { account_id?: string; remark?: string } = {},
): Promise<ItemResponse<SocialAccount>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/accounts/login/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ platform, account_name, login_session_id, ...payload }),
  }).catch(normalize_network_error);
  if (!res.ok) {
    throw await response_error(res, "保存登录态失败");
  }
  return res.json();
}

export async function update_social_account(
  account_id: string,
  payload: Partial<Pick<SocialAccount, "account_name" | "platform_user_id" | "avatar_url" | "profile_url" | "remark" | "status" | "cookie_status">> & {
    followers?: string;
    industry?: string;
  },
): Promise<ItemResponse<SocialAccount>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/accounts/${account_id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Update account failed");
  }
  return res.json();
}

export async function import_social_account_cookie(payload: {
  platform: string;
  account_type: string;
  cookie_format: string;
  cookie_content: string;
  account_name?: string;
  remark?: string;
  profile_url?: string;
  platform_user_id?: string;
  nickname?: string;
}): Promise<ItemResponse<SocialAccount>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/accounts/manual_import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Import account failed");
  }
  return res.json();
}

export async function generate_publish_review(id: string, write_to_memory: boolean): Promise<ItemResponse<ReviewConclusion>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/tasks/${id}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ write_to_memory }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Generate review failed");
  }
  return res.json();
}

export async function fetch_account_memories(platform = ""): Promise<ListResponse<AccountMemory>> {
  const params = new URLSearchParams();
  if (platform) params.set("platform", platform);
  const res = await fetch(`${API_BASE}/api/v1/publishing/account_memories${params.toString() ? "?" + params.toString() : ""}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Fetch account memories failed");
  return res.json();
}

export async function save_account_memory(payload: Partial<AccountMemory> & { account_name: string }): Promise<ItemResponse<AccountMemory>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/account_memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Save account memory failed");
  }
  return res.json();
}
