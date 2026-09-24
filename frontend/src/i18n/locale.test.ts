import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOCALE, isLocale, resolveLocale, translate } from "./locale.ts";

test("only the two supported locales are accepted", () => {
  assert.equal(DEFAULT_LOCALE, "en");
  assert.equal(isLocale("zh-CN"), true);
  assert.equal(isLocale("en"), true);
  for (const value of ["", "fr", "en-US", null, undefined, 1]) {
    assert.equal(isLocale(value), false);
  }
});

test("missing, cleared, and unsupported language preferences fall back to English", () => {
  for (const value of [null, undefined, "", "fr", "en-US", 1]) {
    assert.equal(resolveLocale(value), "en");
  }
});

test("explicit saved language choices are preserved", () => {
  assert.equal(resolveLocale("zh-CN"), "zh-CN");
  assert.equal(resolveLocale("en"), "en");
});

test("chooses the corresponding interface text", () => {
  assert.equal(translate("zh-CN", "作品集", "Portfolio"), "作品集");
  assert.equal(translate("en", "作品集", "Portfolio"), "Portfolio");
});

test("interpolates numeric values including zero and repeated parameters", () => {
  assert.equal(
    translate("en", "已选 {count} 项，共 {total} 项", "{count} selected out of {total}; selected: {count}", { count: 0, total: 12 }),
    "0 selected out of 12; selected: 0",
  );
});

test("does not translate or reinterpret user-provided values", () => {
  assert.equal(
    translate("en", "删除“{name}”？", 'Delete "{name}"?', { name: "我的作品 {count}" }),
    'Delete "我的作品 {count}"?',
  );
});

test("does not interpolate inherited object properties", () => {
  assert.equal(translate("en", "", "{toString}", {}), "{toString}");
});
