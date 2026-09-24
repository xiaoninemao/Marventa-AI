import type {
  Organization,
  OrganizationDetail,
  OrganizationDetails,
  OrganizationMember,
} from "@/types/auth";
import type { ItemResponse, ListResponse } from "@/types/publishing";
import {
  API_BASE,
  auth_headers,
  normalize_network_error,
  response_error,
} from "@/services/api_core";

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
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ name }),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not create organization");
  return res.json();
}

export async function rename_organization(id: string, name: string): Promise<ItemResponse<OrganizationDetails>> {
  const res = await fetch(`${API_BASE}/api/v1/organizations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ name }),
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

export async function delete_organization(id: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/organizations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: auth_headers(),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not delete organization");
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

export async function remove_organization_member(
  id: string, userId: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(
    `${API_BASE}/api/v1/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: auth_headers() },
  ).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not remove organization member");
  return res.json();
}

export async function switch_organization(id: string): Promise<ItemResponse<Organization>> {
  const res = await fetch(`${API_BASE}/api/v1/organizations/${encodeURIComponent(id)}/switch`, {
    method: "POST",
    headers: auth_headers(),
  }).catch(normalize_network_error);
  if (!res.ok) throw await response_error(res, "Could not switch organization");
  return res.json();
}
