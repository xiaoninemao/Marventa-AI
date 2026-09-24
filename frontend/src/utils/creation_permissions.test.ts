import assert from "node:assert/strict";
import test from "node:test";
import { canManageCreation } from "./creation_permissions.ts";
import type { User } from "../types/auth.ts";

const organization = {
  id: "org-a", name: "Team", avatar_url: "", role: "member" as const,
  is_default: true, uses_default_name: false,
};
const user: User = {
  id: "viewer", username: "viewer", email: "", nickname: "", avatar_url: "",
  current_organization: organization, default_organization: organization,
};
const creation = {
  user_id: "creator", organization_id: "org-a", project_role: "member" as const,
};

test("only the creator and project managers can rename or delete a creation", () => {
  assert.equal(canManageCreation(null, creation), false);
  assert.equal(canManageCreation(user, creation), false);
  assert.equal(canManageCreation(user, { ...creation, user_id: user.id }), true);
  assert.equal(canManageCreation(user, { ...creation, project_role: "owner" }), true);
  assert.equal(canManageCreation(user, { ...creation, project_role: "admin" }), true);
});

test("organization roles do not grant creation management", () => {
  for (const role of ["owner", "admin"] as const) {
    assert.equal(canManageCreation({
      ...user, current_organization: { ...organization, role },
    }, creation), false);
  }
});

test("stale ownership and project roles do not grant access after switching organizations", () => {
  const switched = { ...user, current_organization: { ...organization, id: "org-b" } };
  assert.equal(canManageCreation(switched, { ...creation, user_id: user.id }), false);
  assert.equal(canManageCreation(switched, { ...creation, project_role: "admin" }), false);
  assert.equal(canManageCreation(user, { ...creation, organization_id: undefined }), false);
});
