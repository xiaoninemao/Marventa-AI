export interface CodeBlock {
  language: string;
  code: string;
}

export interface Section {
  heading: string;
  level: number;
  content: string;
  subsections: Section[];
}

export interface AIAnalysis {
  product_name: string;
  product_category: string;
  product_description: string;
  product_images: string[];
  similar_products: string[];
  strengths: string[];
  weaknesses: string[];
  product_summary: string;
  target_audience: string;
  use_cases: string[];
  market_positioning: string;
  tech_highlights: string[];
  suggested_marketing_angles: string[];
  marketing_stage: string;
}

export interface ParsedDocument {
  title: string;
  source_type: string;
  sections: Section[];
  code_blocks: CodeBlock[];
  tech_stack: string[];
  features: string[];
  raw_text: string;
  ai_analysis: AIAnalysis | null;
  ai_model: string;
  record_id?: string;
}

export interface HistoryRecord {
  id: string;
  filename: string;
  file_size: number;
  upload_time: string;
  source_type: string;
  title: string;
  ai_model: string;
  ai_analysis: AIAnalysis | null;
  is_edited: boolean;
  status: string;
}

export interface ParseResponse {
  success: boolean;
  message: string;
  data: ParsedDocument | null;
  warning?: string | null;
}

export interface HistoryListResponse {
  success: boolean;
  message: string;
  data: HistoryRecord[];
}

export interface HistoryItemResponse {
  success: boolean;
  message: string;
  data: HistoryRecord;
}
