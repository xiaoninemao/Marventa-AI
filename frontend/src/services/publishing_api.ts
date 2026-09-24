import { apiError } from "@/i18n/errors";
import type { ContentProject, ItemResponse, ListResponse, ProjectMember } from "@/types/publishing";
import { API_BASE, auth_headers, response_error } from "@/services/api_core";

// Project APIs retain their existing URL namespace.

export async function create_manual_content_project(payload: {
  title?: string;
  platform_hint?: string;
  content_type?: string;
  xhs_account?: string;
  final_snapshot?: Record<string, unknown>;
  notes?: string;
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

export async function fetch_content_project(project_id: string): Promise<ItemResponse<ContentProject>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}`, {
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Fetch project failed");
  }
  return res.json();
}

export async function update_content_project(
  project_id: string,
  payload: { title?: string; notes?: string; avatar_color?: string; avatar_icon?: string },
): Promise<ItemResponse<ContentProject>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await response_error(res, "Could not update project");
  return res.json();
}

export async function delete_content_project(
  project_id: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) throw await response_error(res, "Could not delete project");
  return res.json();
}

export async function fetch_project_members(project_id: string): Promise<ListResponse<ProjectMember>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/members`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw await response_error(res, "Could not load project members");
  return res.json();
}

export async function invite_project_member(
  project_id: string, email: string, role: "admin" | "member",
): Promise<ItemResponse<ProjectMember>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw await response_error(res, "Could not add project member");
  return res.json();
}

export async function update_project_member_role(
  project_id: string, user_id: string, role: "admin" | "member",
): Promise<ItemResponse<ProjectMember>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/members/${encodeURIComponent(user_id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify({ role }),
    },
  );
  if (!res.ok) throw await response_error(res, "Could not update project member");
  return res.json();
}

export async function remove_project_member(
  project_id: string, user_id: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/members/${encodeURIComponent(user_id)}`,
    { method: "DELETE", headers: auth_headers() },
  );
  if (!res.ok) throw await response_error(res, "Could not remove project member");
  return res.json();
}
