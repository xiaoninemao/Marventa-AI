import type { ReactNode, SVGProps } from "react";

export type InlineIconName =
  | "arrowLeft"
  | "bell"
  | "case"
  | "chart"
  | "check"
  | "chevronRight"
  | "close"
  | "edit"
  | "eye"
  | "eyeOff"
  | "file"
  | "folder"
  | "gallery"
  | "home"
  | "lock"
  | "mail"
  | "menu"
  | "moon"
  | "more"
  | "organization"
  | "panelLeft"
  | "panelLeftClose"
  | "panelLeftOpen"
  | "portfolio"
  | "search"
  | "share"
  | "settings"
  | "sparkle"
  | "sun"
  | "trending"
  | "upload"
  | "user";

interface InlineIconProps extends SVGProps<SVGSVGElement> {
  name: InlineIconName;
  title?: string;
}

const paths: Record<InlineIconName, ReactNode> = {
  arrowLeft: <path d="m15 18-6-6 6-6" />,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-4 12a2 2 0 0 1-4 0" />,
  case: <><path d="M5 7h14v11H5V7Z" /><path d="M8 4h8v3H8V4Z" /><path d="M8 11h8M8 15h5" /></>,
  chart: <path d="M4 16.5 8.6 12l3.4 3.2 6.8-7.4M4 20h16" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  edit: <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Zm11-12 3 3" />,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /></>,
  eyeOff: <><path d="m3 3 18 18" /><path d="M10.6 10.6A2 2 0 0 0 13.4 13.4" /><path d="M9.5 5.4A10.7 10.7 0 0 1 12 5c6 0 9.5 7 9.5 7a16.8 16.8 0 0 1-2.1 3.1" /><path d="M6.2 6.8C3.8 8.4 2.5 12 2.5 12s3.5 7 9.5 7c1.4 0 2.7-.4 3.8-1" /></>,
  file: <path d="M6 3h8l4 4v14H6V3Zm8 0v5h5M9 13h6M9 17h5" />,
  folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />,
  gallery: <><path d="M4 5h7v6H4V5ZM13 5h7v6h-7V5ZM4 13h7v6H4v-6ZM13 13h7v6h-7v-6Z" /><path d="m6 9 1.2-1.3L9.5 10M15 9l1.2-1.3L18.5 10" /></>,
  home: <path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z" />,
  lock: <path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12v10H6V10Zm6 4v3" />,
  mail: <><path d="M3 5h18v14H3V5Z" /><path d="m4 7 8 6 8-6" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  moon: <path d="M20.8 15.1A9 9 0 0 1 8.9 3.2 9 9 0 1 0 20.8 15.1Z" />,
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
  organization: <><path d="M5 21V5l7-2v18M12 8h7v13M3 21h18M8 7v1M8 11v1M8 15v1M15 12h1M15 16h1" /></>,
  panelLeft: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>,
  panelLeftClose: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="m16 15-3-3 3-3" /></>,
  panelLeftOpen: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="m13 9 3 3-3 3" /></>,
  portfolio: <><path d="M3.75 7.5A2.25 2.25 0 0 1 6 5.25h4.15c.55 0 1.07.2 1.48.56l1.34 1.19H18a2.25 2.25 0 0 1 2.25 2.25v7.5A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.5Z" /><path d="M8 10.5h8M8 13.5h6M8 16.5h4" /></>,
  search: <path d="m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" />,
  share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></>,
  settings: <><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" /><path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8.1 8.1 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A8.1 8.1 0 0 0 7 6L4.6 5l-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8.1 8.1 0 0 0 2.6 1.5L10 22h4l.4-2.5A8.1 8.1 0 0 0 17 18l2.4 1 2-3.5-2-1.5Z" /></>,
  sparkle: <path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9L12 3Zm6 12 .7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7L18 15Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  trending: <path d="M3 17 9 11l4 4 7-8m0 0h-5m5 0v5" />,
  upload: <path d="M12 16V4m0 0 5 5m-5-5-5 5M5 20h14" />,
  user: <><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
};

export default function InlineIcon({
  className = "",
  name,
  title,
  ...props
}: InlineIconProps) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={className}
      fill="none"
      focusable="false"
      role={title ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      {...props}
    >
      {title && <title>{title}</title>}
      {paths[name]}
    </svg>
  );
}
