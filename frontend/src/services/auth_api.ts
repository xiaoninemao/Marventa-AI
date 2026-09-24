import { apiError } from "@/i18n/errors";
import type { AuthResponse, UserResponse } from "@/types/auth";
import {
  API_BASE,
  auth_headers,
  clear_auth_token,
  normalize_network_error,
  set_auth_token,
} from "@/services/api_core";

export { clear_auth_token, set_auth_token };

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
