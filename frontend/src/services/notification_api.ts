import type {
  NotificationListResponse,
  NotificationMutationResponse,
} from "@/types/notifications";
import {
  API_BASE,
  auth_headers,
  normalize_network_error,
  response_error,
} from "@/services/api_core";

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
