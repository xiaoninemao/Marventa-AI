import type { HTMLAttributes, ReactNode } from "react";

interface RedesignGradientBannerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export default function RedesignGradientBanner({
  children,
  className = "",
  ...props
}: RedesignGradientBannerProps) {
  return (
    <div className={`amp-gradient-banner ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}
