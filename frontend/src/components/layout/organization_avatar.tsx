"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useI18n } from "@/contexts/i18n_context";
import type { Organization } from "@/types/auth";
import { organizationName } from "@/utils/organizations";

const colors = [
  "bg-[#dbeafe] text-[#1d4ed8]",
  "bg-[#d1fae5] text-[#047857]",
  "bg-[#ede9fe] text-[#6d28d9]",
  "bg-[#fef3c7] text-[#b45309]",
  "bg-[#ffe4e6] text-[#be123c]",
];

interface OrganizationAvatarProps {
  organization: Organization;
  className?: string;
}

export default function OrganizationAvatar({
  organization,
  className = "h-8 w-8 text-xs",
}: OrganizationAvatarProps) {
  const { t } = useI18n();
  const [imageError, setImageError] = useState(false);
  const name = organizationName(organization, t).trim();
  const initial = Array.from(name)[0]?.toLocaleUpperCase() || "O";
  const colorIndex = organization.id
    .split("")
    .reduce((total, character) => total + character.charCodeAt(0), 0) % colors.length;

  useEffect(() => setImageError(false), [organization.avatar_url]);

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg font-bold ${colors[colorIndex]} ${className}`}
      aria-hidden="true"
    >
      {organization.avatar_url && !imageError ? (
        <Image
          src={organization.avatar_url}
          alt=""
          fill
          unoptimized
          sizes="56px"
          className="object-cover"
          onError={() => setImageError(true)}
        />
      ) : initial}
    </span>
  );
}
