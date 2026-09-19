"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/contexts/i18n_context";

interface ToastItem {
  id: number;
  message: string;
}

interface ToastContextValue {
  showError: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());
  const lastToast = useRef({ message: "", shownAt: 0 });

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const showError = useCallback((message: string) => {
    const normalized = message.trim();
    if (!normalized) return;
    const now = Date.now();
    if (lastToast.current.message === normalized && now - lastToast.current.shownAt < 1000) return;
    lastToast.current = { message: normalized, shownAt: now };
    const id = nextId.current++;
    setToasts((items) => [...items.slice(-2), { id, message: normalized }]);
    timers.current.set(id, window.setTimeout(() => dismiss(id), 4500));
  }, [dismiss]);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  useEffect(() => setMounted(true), []);

  const viewport = (
    <div className="pointer-events-none fixed right-4 top-4 z-[10000] flex w-[calc(100%_-_32px)] max-w-sm flex-col gap-3"
      aria-live="assertive" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} role="alert"
          className="pointer-events-auto flex items-start gap-3 rounded-xl border border-red-200 bg-white p-4 text-sm text-red-700 shadow-2xl">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 font-bold" aria-hidden="true">!</span>
          <p className="min-w-0 flex-1 leading-5">{toast.message}</p>
          <button type="button" className="shrink-0 text-lg leading-5 text-red-400 hover:text-red-700"
            aria-label={t("关闭错误提示", "Dismiss error")} onClick={() => dismiss(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );

  return (
    <ToastContext.Provider value={{ showError }}>
      {children}
      {mounted && createPortal(viewport, document.querySelector<HTMLDialogElement>("dialog[open]") ?? document.body)}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
