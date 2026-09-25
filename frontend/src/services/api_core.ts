import { apiError } from "../i18n/errors.ts";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8765";
export const AUTH_EXPIRED_EVENT = "marventa:auth-expired";

let authToken: string | null = null;

export function set_auth_token(token: string | null) {
  authToken = token;
}

export function clear_auth_token() {
  authToken = null;
}

function expire_auth_session() {
  clear_auth_token();
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("auth_token");
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

export function auth_headers(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

export function normalize_network_error(error: unknown): never {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    throw apiError("读取超时，请稍后重试，或粘贴正文后使用半自动识别。");
  }
  if (error instanceof TypeError) {
    throw apiError(`无法连接后端服务：${API_BASE}。请确认后端已启动。`);
  }
  throw error;
}

export async function response_error(res: Response, fallback: string): Promise<Error> {
  if (res.status === 401) expire_auth_session();
  try {
    const err = await res.clone().json();
    return apiError(err.detail || err.message || fallback);
  } catch {
    const text = await res.text().catch(() => "");
    return apiError(text || fallback);
  }
}
