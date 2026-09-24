import type { User } from "@/types/auth";
import type { CaseItem } from "@/types/case_library";

export function canManageCase(user: User | null, item: CaseItem): boolean {
  if (!user) return false;
  const organization = user.current_organization ?? user.default_organization;
  return Boolean(organization?.id && item.organization_id === organization.id && (
    item.owner_id === user.id
    || item.project_role === "owner"
    || item.project_role === "admin"
  ));
}

export function isCaseAnalyzed(item: CaseItem): boolean {
  return item.ai_status === "completed" && Boolean(item.ai_analysis);
}
