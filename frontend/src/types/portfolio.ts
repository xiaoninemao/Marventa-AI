export interface PortfolioScript {
  id: string;
  user_id: string;
  creator_name?: string;
  title: string;
  content: string;
  source_session_id: string;
  project_id: string;
  project_title: string;
  project_role: "owner" | "admin" | "member";
  status: "generating" | "completed" | "failed";
  created_at: string;
  updated_at: string;
}
