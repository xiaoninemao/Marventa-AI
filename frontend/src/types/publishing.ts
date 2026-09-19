import type { ContentCard } from "@/types/content_generator";

export type PublishStatus =
  | "pending_publish"
  | "scheduled"
  | "publishing"
  | "published_pending_data"
  | "reviewed"
  | "archived";

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
  media_assets: MediaAsset[];
  notes: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PublishTask {
  id: string;
  user_id: string;
  project_id: string;
  source_session_id: string;
  source_card_id: string;
  platform: string;
  account_name: string;
  content_type: string;
  status: PublishStatus;
  selected_version_ids: Record<string, string>;
  original_cards: ContentCard[];
  final_snapshot: Record<string, unknown>;
  planned_publish_at: string;
  published_at: string;
  publish_link: string;
  platform_work_id: string;
  metrics: Record<string, unknown>;
  review: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PublishMetric {
  id: string;
  task_id: string;
  user_id: string;
  views: number;
  likes: number;
  collects: number;
  comments: number;
  shares: number;
  followers: number;
  leads: number;
  completion_rate: number;
  interaction_rate: number;
  collect_rate: number;
  raw_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PublishReview {
  id: string;
  task_id: string;
  user_id: string;
  summary: string;
  success_reasons: string[];
  problem_reasons: string[];
  reusable_structures: string[];
  next_directions: string[];
  series_potential: string;
  memory_update_suggestion: string;
  created_at: string;
  updated_at: string;
}

export interface MediaAsset {
  id: string;
  kind: "image" | "video";
  name: string;
  path?: string;
  url: string;
}

export interface SocialAccount {
  id: string;
  user_id: string;
  platform: string;
  account_name: string;
  platform_user_id: string;
  nickname: string;
  avatar_url: string;
  profile_url: string;
  account_type: string;
  remark: string;
  session_dir: string;
  status: string;
  cookie_status: string;
  profile: Record<string, unknown>;
  last_checked_at: string;
  created_at: string;
  updated_at: string;
}

export interface AccountMemory {
  id: string;
  user_id: string;
  platform: string;
  account_name: string;
  brand_positioning: string;
  target_users: string;
  product_selling_points: string;
  content_style: string;
  banned_expressions: string[];
  common_tags: string[];
  high_performing_content: string[];
  low_performing_directions: string[];
  ai_operation_lessons: string[];
  created_at: string;
  updated_at: string;
}

export interface ReviewConclusion {
  summary: string;
  performance_reasons: string[];
  reusable_structures: string[];
  problems: string[];
  next_adjustments: string[];
  series_potential: string;
  memory_lesson: string;
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
