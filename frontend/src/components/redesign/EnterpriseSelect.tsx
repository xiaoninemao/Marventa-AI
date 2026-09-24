"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDropdownMenu } from "@/hooks/use_dropdown_menu";
import InlineIcon from "@/components/redesign/InlineIcon";

export interface EnterpriseSelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface EnterpriseSelectProps<T extends string> {
  value: T;
  options: Array<EnterpriseSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  variant?: "default" | "inline";
}

export default function EnterpriseSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "",
  disabled = false,
  className = "",
  variant = "default",
}: EnterpriseSelectProps<T>) {
  const [mounted, setMounted] = useState(false);
  const [triggerWidth, setTriggerWidth] = useState<number>();
  const [portalTarget, setPortalTarget] = useState<HTMLElement>();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options.find((option) => option.value === value);
  const enabledCount = options.filter((option) => !option.disabled).length;
  const {
    open,
    position,
    triggerRef,
    menuRef,
    menuId,
    toggleMenu,
    closeMenu,
    handleTriggerKeyDown,
    handleMenuKeyDown,
  } = useDropdownMenu(enabledCount, "start");

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (open) {
      setTriggerWidth(triggerRef.current?.getBoundingClientRect().width);
      setPortalTarget(triggerRef.current?.closest<HTMLDialogElement>("dialog[open]") ?? document.body);
    }
  }, [open, triggerRef, value, options.length]);

  const select = (option: EnterpriseSelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu();
  };

  return (
    <span className={`amp-enterprise-select amp-enterprise-select-${variant} ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="amp-enterprise-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => toggleMenu(selectedIndex)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={selected ? "" : "amp-enterprise-select-placeholder"}>
          {selected?.label || placeholder}
        </span>
        <InlineIcon name="chevronRight" className="amp-enterprise-select-chevron" />
      </button>

      {mounted && open && portalTarget && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="listbox"
          aria-label={ariaLabel}
          className="amp-enterprise-select-menu"
          style={{
            left: position.left,
            top: position.top,
            minWidth: triggerWidth,
          }}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                className="amp-enterprise-select-option"
                onClick={() => select(option)}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
                {active && <InlineIcon name="check" />}
              </button>
            );
          })}
        </div>,
        portalTarget,
      )}
    </span>
  );
}
