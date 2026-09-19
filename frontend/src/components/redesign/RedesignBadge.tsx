import type { HTMLAttributes, ReactNode } from "react";

type RedesignBadgeTone = "primary" | "cyan" | "muted";

interface RedesignBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  icon?: ReactNode;
  tone?: RedesignBadgeTone;
}

export default function RedesignBadge({
  children,
  className = "",
  icon,
  tone = "primary",
  ...props
}: RedesignBadgeProps) {
  const toneClass = {
    primary: "amp-badge-primary",
    cyan: "amp-badge-cyan",
    muted: "amp-badge-muted",
  }[tone];

  return (
    <span className={`amp-badge ${toneClass} ${className}`.trim()} {...props}>
      {icon}
      {children}
    </span>
  );
}
