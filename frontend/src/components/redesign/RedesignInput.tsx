import type { InputHTMLAttributes, ReactNode } from "react";

interface RedesignInputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  rightIconLabel?: string;
  onRightIconClick?: () => void;
}

export default function RedesignInput({
  className = "",
  leftIcon,
  rightIcon,
  rightIconLabel,
  onRightIconClick,
  ...props
}: RedesignInputProps) {
  const iconPadding = [
    leftIcon ? "amp-input-with-left-icon" : "",
    rightIcon ? "amp-input-with-right-icon" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="amp-input-wrap">
      {leftIcon && <span className="amp-input-icon-left">{leftIcon}</span>}
      <input className={`amp-input ${iconPadding} ${className}`.trim()} {...props} />
      {rightIcon && onRightIconClick ? (
        <button type="button" aria-label={rightIconLabel} className="amp-input-icon-right amp-input-icon-button" onClick={onRightIconClick}>
          {rightIcon}
        </button>
      ) : (
        rightIcon && <span className="amp-input-icon-right">{rightIcon}</span>
      )}
    </div>
  );
}
