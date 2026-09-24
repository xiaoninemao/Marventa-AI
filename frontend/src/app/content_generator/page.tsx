"use client";

import { Suspense } from "react";
import { ContentGeneratorExperience } from "@/components/content_generator/ContentGeneratorExperience";

export default function ContentGeneratorPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500" role="status">Loading...</div>}>
      <ContentGeneratorExperience />
    </Suspense>
  );
}
