import assert from "node:assert/strict";
import test from "node:test";
import { canManageCase, isCaseAnalyzed } from "./case_permissions.ts";
import type { CaseItem } from "../types/case_library.ts";
import type { User } from "../types/auth.ts";

const organization = {
  id: "org-a", name: "Team", avatar_url: "", role: "member" as const,
  is_default: true, uses_default_name: false,
};
const user: User = {
  id: "viewer", username: "viewer", email: "", nickname: "", avatar_url: "",
  current_organization: organization, default_organization: organization,
};
const item: CaseItem = {
  id: "case", title: "Case", content_type: "image_text",
  description: "", video_url: "", image_urls: [], tags: [], owner_id: "creator",
  organization_id: "org-a", project_id: "project", project_title: "Project",
  project_role: "member", is_project_member: true,
  source: "", is_favorited: false, created_at: "", updated_at: "",
  ai_status: "completed", ai_analysis: null,
};
const analysis = {
  content_analysis: "Ready",
  marketing_angle: "Angle",
  target_audience: "Audience",
  experience_extraction: "Experience",
  key_highlights: [],
  improvement_suggestions: [],
  similar_approaches: [],
};

test("case actions require creator or project management role", () => {
  assert.equal(canManageCase(null, item), false);
  assert.equal(canManageCase(user, item), false);
  assert.equal(canManageCase(user, { ...item, owner_id: user.id }), true);
  assert.equal(canManageCase(user, { ...item, project_role: "admin" }), true);
  assert.equal(canManageCase(user, { ...item, project_role: "owner" }), true);
});

test("stale roles cannot grant cross-organization management", () => {
  const switched: User = {
    ...user, current_organization: { ...organization, id: "org-b" },
  };
  assert.equal(canManageCase(switched, { ...item, owner_id: user.id }), false);
  assert.equal(canManageCase(switched, { ...item, project_role: "admin" }), false);
  assert.equal(canManageCase(switched, { ...item, project_role: "owner" }), false);
  assert.equal(canManageCase(user, { ...item, organization_id: undefined, project_role: "admin" }), false);
});

test("only completed cases with analysis can be referenced", () => {
  assert.equal(isCaseAnalyzed(item), false);
  assert.equal(isCaseAnalyzed({
    ...item,
    ai_status: "analyzing",
    ai_analysis: analysis,
  }), false);
  assert.equal(isCaseAnalyzed({
    ...item,
    ai_status: "completed",
    ai_analysis: analysis,
  }), true);
});
