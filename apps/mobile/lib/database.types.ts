export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          phone: string;
          role: 'customer' | 'painter' | 'foreman' | 'admin';
          avatar_url: string | null;
          push_token: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string;
          phone?: string;
          role?: 'customer' | 'painter' | 'foreman' | 'admin';
          avatar_url?: string | null;
          push_token?: string | null;
        };
        Update: {
          full_name?: string;
          phone?: string;
          avatar_url?: string | null;
          push_token?: string | null;
        };
      };
      projects: {
        Row: {
          id: string;
          title: string;
          address: string;
          project_type: string;
          description: string;
          start_date: string | null;
          end_date: string | null;
          status: 'active' | 'completed' | 'paused' | 'cancelled';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          address: string;
          project_type?: string;
          description?: string;
          start_date?: string | null;
          end_date?: string | null;
          status?: 'active' | 'completed' | 'paused' | 'cancelled';
        };
        Update: {
          title?: string;
          address?: string;
          project_type?: string;
          description?: string;
          start_date?: string | null;
          end_date?: string | null;
          status?: 'active' | 'completed' | 'paused' | 'cancelled';
        };
      };
      project_members: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          role: 'customer' | 'painter' | 'foreman' | 'admin';
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          role?: 'customer' | 'painter' | 'foreman' | 'admin';
        };
        Update: {
          role?: 'customer' | 'painter' | 'foreman' | 'admin';
        };
      };
      subprojects: {
        Row: {
          id: string;
          project_id: string;
          title: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          title: string;
          sort_order?: number;
        };
        Update: {
          title?: string;
          sort_order?: number;
        };
      };
      phases: {
        Row: {
          id: string;
          subproject_id: string;
          title: string;
          status: 'pending' | 'in_progress' | 'completed';
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          subproject_id: string;
          title: string;
          status?: 'pending' | 'in_progress' | 'completed';
          sort_order?: number;
        };
        Update: {
          title?: string;
          status?: 'pending' | 'in_progress' | 'completed';
          sort_order?: number;
        };
      };
      chat_messages: {
        Row: {
          id: string;
          project_id: string;
          sender_id: string;
          content: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          sender_id: string;
          content: string;
          is_read?: boolean;
        };
        Update: {
          is_read?: boolean;
        };
      };
      documents: {
        Row: {
          id: string;
          project_id: string;
          title: string;
          file_url: string;
          file_type: string;
          sign_code: string | null;
          expires_at: string | null;
          status: 'pending' | 'signed' | 'expired';
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          title: string;
          file_url: string;
          file_type?: string;
          sign_code?: string | null;
          expires_at?: string | null;
          status?: 'pending' | 'signed' | 'expired';
        };
        Update: {
          title?: string;
          file_url?: string;
          sign_code?: string | null;
          expires_at?: string | null;
          status?: 'pending' | 'signed' | 'expired';
        };
      };
    };
  };
}

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type Project = Database['public']['Tables']['projects']['Row'];
export type ProjectMember = Database['public']['Tables']['project_members']['Row'];
export type Subproject = Database['public']['Tables']['subprojects']['Row'];
export type Phase = Database['public']['Tables']['phases']['Row'];
export type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];
export type Document = Database['public']['Tables']['documents']['Row'];
