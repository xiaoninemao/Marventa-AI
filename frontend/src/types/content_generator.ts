export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ContentCard {
  id: string;
  card_type: "script" | "title" | "copy" | "hashtags" | "visual";
  title: string;
  preview: string;
  content: string;
  tips: string[];
}

export interface SessionRecord {
  id: string;
  user_id: string;
  title: string;
  messages: ChatMessage[];
  cards: ContentCard[];
  status: "drafting" | "generating" | "completed" | "failed";
  insight_ids: string[];
  case_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface SessionListResponse {
  success: boolean;
  message: string;
  data: SessionRecord[];
}

export interface SessionDetailResponse {
  success: boolean;
  message: string;
  data: SessionRecord;
}

export interface ChatResponse {
  success: boolean;
  message: string;
  data: {
    reply: ChatMessage;
    session: SessionRecord;
  };
}

export interface GenerateResponse {
  success: boolean;
  message: string;
  data: { status: string };
}

export interface ContentVersion {
  id: string;
  session_id: string;
  version_label: string;
  major: number;
  minor: number;
  cards: ContentCard[];
  created_at: string;
}

export interface VersionListResponse {
  success: boolean;
  message: string;
  data: ContentVersion[];
}

export interface VersionRestoreResponse {
  success: boolean;
  message: string;
  data: {
    version: ContentVersion;
    session: SessionRecord;
  };
}
