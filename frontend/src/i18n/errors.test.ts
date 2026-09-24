import test from "node:test";
import assert from "node:assert/strict";
import { apiError, currentInterfaceLocale } from "./errors.ts";

test("server-side errors default to English without a document", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(currentInterfaceLocale(), "en");
  assert.equal(apiError("组织名称不能为空").message, "Organization name is required");
});

test("browser errors respect supported languages and use English for missing or invalid ones", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    for (const [lang, expected] of [
      ["zh-CN", "组织名称不能为空"],
      ["en", "Organization name is required"],
      ["", "Organization name is required"],
      ["fr", "Organization name is required"],
    ]) {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: { documentElement: { lang } },
      });
      assert.equal(currentInterfaceLocale(), lang === "zh-CN" ? "zh-CN" : "en");
      assert.equal(apiError("组织名称不能为空").message, expected);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
