import type { ContentCard } from "@/types/content_generator";

export interface ContentProject {
  id: string;
  user_id: string;
  title: string;
  xhs_account: string;
  source_session_id: string;
  source_card_id: string;
  content_type: string;
  platform_hint: string;
  cards_snapshot: ContentCard[];
  final_snapshot: Record<string, unknown>;
  notes: string;
  status: string;
  role: "owner" | "admin" | "member";
  avatar_color: string;
  avatar_icon: string;
  members: ProjectMember[];
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  user_id: string;
  username: string;
  email: string;
  nickname: string;
  avatar_url: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
}

export interface ListResponse<T> {
  success: boolean;
  message: string;
  data: T[];
}

export interface ItemResponse<T> {
  success: boolean;
  message: string;
  data: T;
}
