import assert from "node:assert/strict";
import test from "node:test";
import { userAvatarColor, userAvatarInitial } from "./user_avatar.ts";

test("default avatar colors preserve the account's existing stable palette", () => {
  const expected = [
    ["a", "bg-violet-600"], ["b", "bg-amber-600"], ["c", "bg-rose-600"],
    ["d", "bg-indigo-700"], ["e", "bg-emerald-600"],
  ];
  for (const [id, color] of expected) {
    assert.equal(userAvatarColor(id), color);
    assert.equal(userAvatarColor(id), userAvatarColor(id));
  }
});

test("all avatar surfaces use the same uppercase initial and support Unicode", () => {
  assert.equal(userAvatarInitial("xiaonine"), "X");
  assert.equal(userAvatarInitial(" alice "), "A");
  assert.equal(userAvatarInitial("小九"), "小");
  assert.equal(userAvatarInitial("😊creator"), "😊");
  assert.equal(userAvatarInitial(""), "U");
});
