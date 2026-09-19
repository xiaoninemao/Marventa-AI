import type { HTMLAttributes, ReactNode } from "react";

type RedesignIconBoxTone = "primary" | "cyan" | "purple";

interface RedesignIconBoxProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: RedesignIconBoxTone;
}

export default function RedesignIconBox({
  children,
  className = "",
  tone = "primary",
  ...props
}: RedesignIconBoxProps) {
  const toneClass = tone === "cyan"
    ? "amp-icon-box-cyan"
    : tone === "purple"
      ? "amp-icon-box-purple"
      : "";

  return (
    <div className={`amp-icon-box ${toneClass} ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}
