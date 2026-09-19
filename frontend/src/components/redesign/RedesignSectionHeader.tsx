import type { ReactNode } from "react";

interface RedesignSectionHeaderProps {
  eyebrow?: ReactNode;
  subtitle?: string;
  title: string;
}

export default function RedesignSectionHeader({
  eyebrow,
  subtitle,
  title,
}: RedesignSectionHeaderProps) {
  return (
    <div className="amp-section-header">
      {eyebrow}
      <h2 className="amp-section-title">{title}</h2>
      {subtitle && <p className="amp-section-subtitle">{subtitle}</p>}
    </div>
  );
}
