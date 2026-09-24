export interface Organization {
  id: string;
  name: string;
  avatar_url: string;
  role: "owner" | "admin" | "member";
  is_default: boolean;
  uses_default_name: boolean;
}

export interface OrganizationDetails extends Organization {
  created_at: string;
  member_count: number;
}

export interface OrganizationMember {
  user_id: string;
  username: string;
  email: string;
  nickname: string;
  avatar_url: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
}

export interface OrganizationDetail extends OrganizationDetails {
  members: OrganizationMember[];
}

export interface User {
  id: string;
  username: string;
  email: string;
  nickname: string;
  avatar_url: string;
  default_organization: Organization;
  current_organization: Organization;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data: TokenResponse;
}

export interface UserResponse {
  success: boolean;
  message: string;
  data: User;
}
