"use client";

import { useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/contexts/i18n_context";
import type { ContentProject } from "@/types/publishing";
import InlineIcon from "@/components/redesign/InlineIcon";
import ProjectQuickSearchList from "@/components/projects/ProjectQuickSearchList";

const STORAGE_KEY = "amp-project-sidebar-collapsed";

interface ProjectQuickSidebarProps {
  projects: ContentProject[];
  currentProjectId?: string;
}

export default function ProjectQuickSidebar({
  projects,
  currentProjectId,
}: ProjectQuickSidebarProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [transitionReady, setTransitionReady] = useState(false);

  useLayoutEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "true");
    const frame = window.requestAnimationFrame(() => setTransitionReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <aside className={`amp-project-quick-sidebar ${collapsed ? "amp-project-quick-sidebar-collapsed" : ""} ${transitionReady ? "" : "amp-project-quick-sidebar-initializing"}`}
      aria-label={t("项目快速访问", "Project quick access")}>
      <div className="amp-project-quick-sidebar-header">
        <span>{t("快速访问", "Quick access")}</span>
        <button type="button" onClick={toggleCollapsed}
          aria-label={collapsed ? t("展开项目侧栏", "Expand project sidebar") : t("收起项目侧栏", "Collapse project sidebar")}
          title={collapsed ? t("展开", "Expand") : t("收起", "Collapse")}>
          <InlineIcon name={collapsed ? "panelLeftOpen" : "panelLeftClose"} />
        </button>
      </div>

      <nav className="amp-project-quick-nav">
        <Link href="/projects" aria-current={!currentProjectId ? "page" : undefined}
          className={!currentProjectId ? "amp-project-quick-active" : ""} title={t("所有项目", "All projects")}>
          <span className="amp-project-quick-icon"><InlineIcon name="folder" /></span>
          <span className="amp-project-quick-label">{t("所有项目", "All projects")}</span>
        </Link>

        <div className="amp-project-quick-divider" />
        <p className="amp-project-quick-section-label">{t("项目", "Projects")}</p>
        <ProjectQuickSearchList projects={projects} renderProject={(project) => (
          <Link key={project.id} href={`/projects/${encodeURIComponent(project.id)}`}
            aria-current={currentProjectId === project.id ? "page" : undefined}
            className={currentProjectId === project.id ? "amp-project-quick-active" : ""}
            title={project.title}>
            <span className="amp-project-quick-avatar" style={{ backgroundColor: project.avatar_color || "#bfdbfe" }}>
              {project.avatar_icon || "💡"}
            </span>
            <span className="amp-project-quick-label">{project.title}</span>
          </Link>
        )} />
      </nav>
    </aside>
  );
}
