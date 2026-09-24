export interface NotificationItem {
  id: string;
  organization_id: string;
  kind: string;
  data: Record<string, string>;
  action_url: string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListData {
  items: NotificationItem[];
  unread_count: number;
}

export interface NotificationListResponse {
  success: boolean;
  message: string;
  data: NotificationListData;
}

export interface NotificationMutationResponse {
  success: boolean;
  message: string;
  data: { updated_count: number } | null;
}
