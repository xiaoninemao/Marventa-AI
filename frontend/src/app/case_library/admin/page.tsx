import { redirect } from "next/navigation";

export default async function LegacyCaseAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  redirect(project ? `/case_library?project=${encodeURIComponent(project)}` : "/case_library");
}
