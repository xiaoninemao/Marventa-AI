import type { Organization } from "@/types/auth";
import type { Translate } from "@/i18n/locale";

export function organizationName(organization: Organization, t: Translate): string {
  const match = organization.uses_default_name ? organization.name.match(/^(.+)的组织$/u) : null;
  return match
    ? t(organization.name, "{name}'s Organization", { name: match[1] })
    : organization.name;
}

export function organizationRole(role: Organization["role"], t: Translate): string {
  return {
    owner: t("所有者", "Owner"),
    admin: t("管理员", "Administrator"),
    member: t("成员", "Member"),
  }[role];
}
