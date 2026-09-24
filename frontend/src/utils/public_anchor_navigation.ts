import type { MouseEvent } from "react";

const anchorAliases: Record<string, string> = {
  top: "top",
  "public-content": "public-content",
  capabilities: "capabilities",
  workflow: "workflow",
  features: "capabilities",
  solutions: "workflow",
};

export function normalizePublicHash(href: string): string {
  if (!href.includes("#")) return "";
  const fragment = href.split("#").filter(Boolean).at(-1) ?? "";
  const id = Object.hasOwn(anchorAliases, fragment) ? anchorAliases[fragment] : "";
  return id ? `#${id}` : "";
}

function scrollToHash(hash: string) {
  const target = document.getElementById(hash.slice(1));
  if (!target) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
  if (hash === "#public-content") target.focus({ preventScroll: true });
}

export function restorePublicAnchor() {
  const hash = normalizePublicHash(window.location.hash);
  if (!hash) return;
  if (hash !== window.location.hash) {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
  }
  const frame = window.requestAnimationFrame(() => scrollToHash(hash));
  return () => window.cancelAnimationFrame(frame);
}

export function handlePublicAnchorClick(href: string, event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const hash = normalizePublicHash(href);
  if (!hash || window.location.pathname !== "/") return;
  event.preventDefault();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
  scrollToHash(hash);
}
