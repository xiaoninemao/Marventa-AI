"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/contexts/i18n_context";
import type { ContentProject } from "@/types/publishing";
import InlineIcon from "@/components/redesign/InlineIcon";

export default function ProjectQuickSearchList({
  projects,
  renderProject,
}: {
  projects: ContentProject[];
  renderProject: (project: ContentProject) => ReactNode;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = normalizedQuery
    ? projects.filter((project) => project.title.toLocaleLowerCase().includes(normalizedQuery))
    : projects;

  return (
    <>
      <div className="amp-project-quick-search">
        <InlineIcon name="search" />
        <input type="search" value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("搜索项目", "Search projects")}
          placeholder={t("搜索项目", "Search projects")} />
      </div>
      {visibleProjects.map(renderProject)}
    </>
  );
}
