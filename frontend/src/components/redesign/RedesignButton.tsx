import type { ButtonHTMLAttributes, ReactNode } from "react";

type RedesignButtonVariant = "primary" | "secondary" | "ghost";

interface RedesignButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: ReactNode;
  variant?: RedesignButtonVariant;
}

export default function RedesignButton({
  children,
  className = "",
  icon,
  type = "button",
  variant = "primary",
  ...props
}: RedesignButtonProps) {
  const variantClass = {
    primary: "amp-button-primary",
    secondary: "amp-button-secondary",
    ghost: "amp-button-ghost",
  }[variant];

  return (
    <button
      type={type}
      className={`amp-button ${variantClass} ${className}`.trim()}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
