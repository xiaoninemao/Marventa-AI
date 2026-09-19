import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/layout/app_shell";
import { AuthProvider } from "@/contexts/auth_context";
import { I18nProvider } from "@/contexts/i18n_context";
import { ToastProvider } from "@/contexts/toast_context";

export const metadata: Metadata = {
  title: "Marventa AI",
  description: "AI-powered new media marketing solution for tech SMEs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="h-full flex flex-col bg-white dark:bg-black text-zinc-900 dark:text-zinc-100 font-body">
        <AuthProvider>
          <I18nProvider>
            <ToastProvider>
              <AppShell>{children}</AppShell>
            </ToastProvider>
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
