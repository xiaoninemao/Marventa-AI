import type { HTMLAttributes, ReactNode } from "react";

interface RedesignCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hover?: boolean;
}

export default function RedesignCard({
  children,
  className = "",
  hover = false,
  ...props
}: RedesignCardProps) {
  return (
    <div
      className={`amp-card ${hover ? "amp-card-hover" : ""} ${className}`.trim()}
      {...props}
    >
      {children}
    </div>
  );
}
