export interface CaseAIAnalysis {
  content_analysis: string;
  marketing_angle: string;
  target_audience: string;
  experience_extraction: string;
  key_highlights: string[];
  improvement_suggestions: string[];
  similar_approaches: string[];
  title_suggestions?: string[];
  tag_suggestions?: string[];
  hook_analysis?: string;
  rewrite_examples?: string[];
}

export interface CaseItem {
  id: string;
  title: string;
  content_type: "video" | "image_text" | "pending";
  category: "agency" | "curated" | "mine";
  description: string;
  video_url: string;
  image_urls: string[];
  tags: string[];
  owner_id: string;
  is_public: boolean;
  source: string;
  is_favorited: boolean;
  isFavorited?: boolean;
  created_at: string;
  updated_at: string;
  ai_status: string;
  ai_analysis: CaseAIAnalysis | null;
  tabType?: "industry" | "enterprise" | "mine";
  platform?: string;
  industry?: string;
  scene?: string;
  original_url?: string;
  cover_url?: string;
  published_at?: string;
  popularity?: number;
  likes?: number | null;
  favorites_count?: number | null;
  comments?: number | null;
  body?: string;
  recognition_status?: "recognized" | "partial" | "pending";
  reusable_structure?: string[];
  rewrite_suggestions?: string[];
}

export interface CaseListData {
  cases: CaseItem[];
  favorite_ids: string[];
}

export interface CaseListResponse {
  success: boolean;
  message: string;
  data: CaseItem[] | CaseListData;
}

export interface CaseItemResponse {
  success: boolean;
  message: string;
  data: CaseItem;
}

export interface CaseImportTask {
  id: string;
  owner_id: string;
  platform: "xiaohongshu" | "douyin" | "unknown";
  source_url: string;
  raw_input: string;
  manual_text: string;
  status: "pending" | "completed" | "failed";
  recognition_status: "recognized" | "partial" | "pending";
  parsed_data: Record<string, unknown>;
  ai_analysis: CaseAIAnalysis;
  case_id: string;
  logs: string[];
  error: string;
  created_at: string;
  updated_at: string;
  case: CaseItem | null;
}

export interface CaseImportTaskResponse {
  success: boolean;
  message: string;
  data: CaseImportTask;
}
