export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      bank_statements: {
        Row: {
          bank_name: string
          deleted_at: string | null
          file_name: string
          file_path: string
          id: string
          period_end: string | null
          period_start: string | null
          processed: boolean
          processing_error: string | null
          statement_month: number | null
          statement_period: string | null
          statement_year: number | null
          transaction_count: number | null
          uploaded_at: string
          user_id: string
        }
        Insert: {
          bank_name?: string
          deleted_at?: string | null
          file_name: string
          file_path: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          processed?: boolean
          processing_error?: string | null
          statement_month?: number | null
          statement_period?: string | null
          statement_year?: number | null
          transaction_count?: number | null
          uploaded_at?: string
          user_id: string
        }
        Update: {
          bank_name?: string
          deleted_at?: string | null
          file_name?: string
          file_path?: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          processed?: boolean
          processing_error?: string | null
          statement_month?: number | null
          statement_period?: string | null
          statement_year?: number | null
          transaction_count?: number | null
          uploaded_at?: string
          user_id?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          sort_order: number
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          company_name: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      responsibles: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number | null
          balance: number | null
          category: string | null
          category_id: string | null
          created_at: string
          credit: number | null
          date: string
          dcto: string | null
          debit: number | null
          deleted_at: string | null
          description: string
          has_iva: boolean
          has_retefuente: boolean
          id: string
          iva_amount: number
          iva_rate: number
          iva_type: string | null
          notes: string | null
          operational_type: string | null
          owner: string | null
          raw_line: string | null
          responsible_id: string | null
          retefuente_amount: number
          retefuente_rate: number
          statement_id: string
          sucursal: string | null
          transaction_type: string | null
          type: string | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          balance?: number | null
          category?: string | null
          category_id?: string | null
          created_at?: string
          credit?: number | null
          date: string
          dcto?: string | null
          debit?: number | null
          deleted_at?: string | null
          description: string
          has_iva?: boolean
          has_retefuente?: boolean
          id?: string
          iva_amount?: number
          iva_rate?: number
          iva_type?: string | null
          notes?: string | null
          operational_type?: string | null
          owner?: string | null
          raw_line?: string | null
          responsible_id?: string | null
          retefuente_amount?: number
          retefuente_rate?: number
          statement_id: string
          sucursal?: string | null
          transaction_type?: string | null
          type?: string | null
          user_id: string
        }
        Update: {
          amount?: number | null
          balance?: number | null
          category?: string | null
          category_id?: string | null
          created_at?: string
          credit?: number | null
          date?: string
          dcto?: string | null
          debit?: number | null
          deleted_at?: string | null
          description?: string
          has_iva?: boolean
          has_retefuente?: boolean
          id?: string
          iva_amount?: number
          iva_rate?: number
          iva_type?: string | null
          notes?: string | null
          operational_type?: string | null
          owner?: string | null
          raw_line?: string | null
          responsible_id?: string | null
          retefuente_amount?: number
          retefuente_rate?: number
          statement_id?: string
          sucursal?: string | null
          transaction_type?: string | null
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "bank_statements"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      fix_transaction_dates_for_statement: {
        Args: { p_statement_id: string }
        Returns: number
      }
    }
    Enums: {
      transaction_simple_type: "ingreso" | "egreso" | "transferencia"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      transaction_simple_type: ["ingreso", "egreso", "transferencia"],
    },
  },
} as const
