import assert from "node:assert/strict";
import test from "node:test";
import { normalizePublicHash } from "./public_anchor_navigation.ts";

test("public navigation resolves known fragments without accumulating hashes", () => {
  assert.equal(normalizePublicHash("#capabilities"), "#capabilities");
  assert.equal(normalizePublicHash("/#workflow"), "#workflow");
  assert.equal(normalizePublicHash("#workflow#workflow"), "#workflow");
  assert.equal(normalizePublicHash("/#workflow#capabilities"), "#capabilities");
  assert.equal(normalizePublicHash("#top"), "#top");
  assert.equal(normalizePublicHash("#public-content"), "#public-content");
});

test("previous public-page anchors resolve to the replacement sections", () => {
  assert.equal(normalizePublicHash("/#features"), "#capabilities");
  assert.equal(normalizePublicHash("/#solutions"), "#workflow");
});

test("unrecognized navigation is left to the browser", () => {
  for (const href of ["", "/", "/projects", "#unknown", "#toString", "#__proto__"]) {
    assert.equal(normalizePublicHash(href), "");
  }
});
