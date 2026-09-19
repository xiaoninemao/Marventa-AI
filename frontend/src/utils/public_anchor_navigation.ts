import type { MouseEvent } from "react";

const PENDING_ANCHOR_KEY = "marventa_pending_anchor";

function normalizeHash(href: string): string {
  const hashIndex = href.indexOf("#");
  return hashIndex >= 0 ? href.slice(hashIndex) : "";
}

export function scrollToHash(hash: string) {
  const id = hash.replace(/^#/, "");
  if (!id) return;
  const target = document.getElementById(id);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function consumePendingAnchor() {
  const pendingHash = window.sessionStorage.getItem(PENDING_ANCHOR_KEY) || window.location.hash;
  if (!pendingHash) return;
  window.sessionStorage.removeItem(PENDING_ANCHOR_KEY);
  window.requestAnimationFrame(() => scrollToHash(pendingHash));
}

export function handlePublicAnchorClick(href: string, event: MouseEvent<HTMLAnchorElement>) {
  const hash = normalizeHash(href);
  if (!hash) return;

  if (window.location.pathname === "/") {
    event.preventDefault();
    window.history.replaceState(null, "", hash);
    scrollToHash(hash);
    return;
  }

  window.sessionStorage.setItem(PENDING_ANCHOR_KEY, hash);
}

export function getPublicNavLinkClass(href: string, pathname: string, hash: string) {
  const isAnchor = href.startsWith("/#");
  const isActive = isAnchor
    ? pathname === "/" && hash === normalizeHash(href)
    : pathname === href;

  return `amp-landing-nav-link${isActive ? " amp-landing-nav-link-active" : ""}`;
}
