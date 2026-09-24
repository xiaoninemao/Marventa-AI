import type { User } from "../types/auth";
import type { SessionRecord } from "../types/content_generator";

export function canManageCreation(
  user: User | null,
  creation: Pick<SessionRecord, "user_id" | "organization_id" | "project_role">,
): boolean {
  if (!user) return false;
  const organization = user.current_organization ?? user.default_organization;
  return Boolean(organization?.id && creation.organization_id === organization.id && (
    creation.user_id === user.id
    || creation.project_role === "owner"
    || creation.project_role === "admin"
  ));
}
