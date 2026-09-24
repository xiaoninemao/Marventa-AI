import { apiError } from "@/i18n/errors";
import { API_BASE, auth_headers } from "@/services/api_core";
import type { PortfolioScript } from "@/types/portfolio";

// ── Script Library ──

export async function fetch_scripts(project_id = ""): Promise<{
  success: boolean; message: string; data: PortfolioScript[]
}> {
  const params = new URLSearchParams();
  if (project_id) params.set("project_id", project_id);
  const res = await fetch(`${API_BASE}/api/v1/portfolio/scripts?${params.toString()}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Fetch scripts failed");
  return res.json();
}

export async function fetch_script(id: string): Promise<{
  success: boolean; message: string; data: PortfolioScript
}> {
  const res = await fetch(`${API_BASE}/api/v1/portfolio/scripts/${id}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Fetch script failed");
  return res.json();
}

export async function update_script(id: string, data: { title?: string; content?: string }): Promise<{
  success: boolean; message: string; data: PortfolioScript
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
