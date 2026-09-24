"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { ContentGeneratorExperience } from "@/components/content_generator/ContentGeneratorExperience";

export default function ContentCanvasDetailPage() {
  const params = useParams<{ sessionId: string }>();

  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500" role="status">Loading...</div>}>
      <ContentGeneratorExperience canvasId={params.sessionId} />
    </Suspense>
  );
}
