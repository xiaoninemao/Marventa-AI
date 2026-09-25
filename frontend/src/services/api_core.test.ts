import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_EXPIRED_EVENT,
  auth_headers,
  response_error,
  set_auth_token,
} from "./api_core.ts";

test("a 401 response clears the token and emits an auth-expired event", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  let removedKey = "";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(events, {
      localStorage: {
        removeItem(key: string) {
          removedKey = key;
        },
      },
    }),
  });
  let expired = false;
  window.addEventListener(AUTH_EXPIRED_EVENT, () => {
    expired = true;
  });
  try {
    set_auth_token("expired-token");
    const error = await response_error(
      new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      "Request failed",
    );
    assert.equal(error.message, "Unauthorized");
    assert.deepEqual(auth_headers(), {});
    assert.equal(removedKey, "auth_token");
    assert.equal(expired, true);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    set_auth_token(null);
  }
});

test("non-authentication errors preserve the current token", async () => {
  set_auth_token("active-token");
  try {
    await response_error(
      new Response(JSON.stringify({ detail: "Server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
      "Request failed",
    );
    assert.deepEqual(auth_headers(), {
      Authorization: "Bearer active-token",
    });
  } finally {
    set_auth_token(null);
  }
});
