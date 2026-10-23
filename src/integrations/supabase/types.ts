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
      _backup_fiscal_config_actividad: {
        Row: {
          actividad_old: string | null
          backed_up_at: string | null
          id: string | null
          user_id: string | null
        }
        Insert: {
          actividad_old?: string | null
          backed_up_at?: string | null
          id?: string | null
          user_id?: string | null
        }
        Update: {
          actividad_old?: string | null
          backed_up_at?: string | null
          id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      activity_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_label: string
          entity_type: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_label?: string
          entity_type: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_label?: string
          entity_type?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      aluminum_catalog: {
        Row: {
          active: boolean
          color: string
          condiciones: string | null
          costo_calculado_m2: number
          created_at: string
          description: string | null
          id: string
          lleva_vidrio: boolean
          mano_obra_pct: number | null
          price_per_m2: number
          system: string
          tiempo_entrega_dias: number
          tipo_vidrio: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          color: string
          condiciones?: string | null
          costo_calculado_m2?: number
          created_at?: string
          description?: string | null
          id?: string
          lleva_vidrio?: boolean
          mano_obra_pct?: number | null
          price_per_m2?: number
          system: string
          tiempo_entrega_dias?: number
          tipo_vidrio?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          color?: string
          condiciones?: string | null
          costo_calculado_m2?: number
          created_at?: string
          description?: string | null
          id?: string
          lleva_vidrio?: boolean
          mano_obra_pct?: number | null
          price_per_m2?: number
          system?: string
          tiempo_entrega_dias?: number
          tipo_vidrio?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      aluminum_catalog_components: {
        Row: {
          catalog_id: string
          created_at: string
          id: string
          notes: string | null
          product_id: string
          quantity_per_m2: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          catalog_id: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          quantity_per_m2?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          catalog_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          quantity_per_m2?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aluminum_catalog_components_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "aluminum_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aluminum_catalog_components_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          user_id?: string
        }
        Relationships: []
      }
      app_events: {
        Row: {
          event_type: string
          id: string
          occurred_at: string
          props: Json
          user_id: string | null
        }
        Insert: {
          event_type: string
          id?: string
          occurred_at?: string
          props?: Json
          user_id?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          occurred_at?: string
          props?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      app_feedback: {
        Row: {
          app_version: string | null
          comments: string | null
          id: string
          rating: number
          submitted_at: string
          user_id: string
          wishlist: string | null
        }
        Insert: {
          app_version?: string | null
          comments?: string | null
          id?: string
          rating: number
          submitted_at?: string
          user_id: string
          wishlist?: string | null
        }
        Update: {
          app_version?: string | null
          comments?: string | null
          id?: string
          rating?: number
          submitted_at?: string
          user_id?: string
          wishlist?: string | null
        }
        Relationships: []
      }
      app_feedback_postponed: {
        Row: {
          postponed_until: string
          updated_at: string
          user_id: string
        }
        Insert: {
          postponed_until: string
          updated_at?: string
          user_id: string
        }
        Update: {
          postponed_until?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          id: number
          owner_id: string | null
          row_id: string
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          id?: never
          owner_id?: string | null
          row_id: string
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          id?: never
          owner_id?: string | null
          row_id?: string
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      auth_failed_attempts: {
        Row: {
          attempted_at: string
          email: string
          id: number
          ip: string
          reason: string | null
          user_agent: string | null
        }
        Insert: {
          attempted_at?: string
          email: string
          id?: number
          ip: string
          reason?: string | null
          user_agent?: string | null
        }
        Update: {
          attempted_at?: string
          email?: string
          id?: number
          ip?: string
          reason?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      bank_statements: {
        Row: {
          account_number: string | null
          bank_name: string
          deleted_at: string | null
          display_name: string | null
          file_name: string
          file_path: string
          id: string
          intereses: number | null
          period_end: string | null
          period_start: string | null
          period_type: Database["public"]["Enums"]["bank_statement_period_type"]
          processed: boolean
          processing_error: string | null
          retefuente: number | null
          saldo_actual: number | null
          saldo_anterior: number | null
          saldo_promedio: number | null
          statement_month: number | null
          statement_period: string | null
          statement_year: number | null
          total_abonos: number | null
          total_cargos: number | null
          transaction_count: number | null
          uploaded_at: string
          user_id: string
        }
        Insert: {
          account_number?: string | null
          bank_name?: string
          deleted_at?: string | null
          display_name?: string | null
          file_name: string
          file_path: string
          id?: string
          intereses?: number | null
          period_end?: string | null
          period_start?: string | null
          period_type?: Database["public"]["Enums"]["bank_statement_period_type"]
          processed?: boolean
          processing_error?: string | null
          retefuente?: number | null
          saldo_actual?: number | null
          saldo_anterior?: number | null
          saldo_promedio?: number | null
          statement_month?: number | null
          statement_period?: string | null
          statement_year?: number | null
          total_abonos?: number | null
          total_cargos?: number | null
          transaction_count?: number | null
          uploaded_at?: string
          user_id: string
        }
        Update: {
          account_number?: string | null
          bank_name?: string
          deleted_at?: string | null
          display_name?: string | null
          file_name?: string
          file_path?: string
          id?: string
          intereses?: number | null
          period_end?: string | null
          period_start?: string | null
          period_type?: Database["public"]["Enums"]["bank_statement_period_type"]
          processed?: boolean
          processing_error?: string | null
          retefuente?: number | null
          saldo_actual?: number | null
          saldo_anterior?: number | null
          saldo_promedio?: number | null
          statement_month?: number | null
          statement_period?: string | null
          statement_year?: number | null
          total_abonos?: number | null
          total_cargos?: number | null
          transaction_count?: number | null
          uploaded_at?: string
          user_id?: string
        }
        Relationships: []
      }
      beneficiary_segments: {
        Row: {
          beneficiary_norm: string
          created_at: string
          id: string
          segment: string
          user_id: string
        }
        Insert: {
          beneficiary_norm: string
          created_at?: string
          id?: string
          segment: string
          user_id: string
        }
        Update: {
          beneficiary_norm?: string
          created_at?: string
          id?: string
          segment?: string
          user_id?: string
        }
        Relationships: []
      }
      budgets: {
        Row: {
          amount_planned: number
          created_at: string
          id: string
          month: number
          report_group: string
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          amount_planned?: number
          created_at?: string
          id?: string
          month: number
          report_group: string
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          amount_planned?: number
          created_at?: string
          id?: string
          month?: number
          report_group?: string
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      business_memory: {
        Row: {
          created_at: string
          id: string
          metric_key: string
          metric_value: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metric_key: string
          metric_value?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metric_key?: string
          metric_value?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      business_obligations: {
        Row: {
          activa: boolean | null
          completadas: string[] | null
          created_at: string | null
          dia_mes: number
          id: string
          meses: string[] | null
          monto_estimado: number | null
          nombre: string
          notas: string | null
          tipo: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          activa?: boolean | null
          completadas?: string[] | null
          created_at?: string | null
          dia_mes: number
          id?: string
          meses?: string[] | null
          monto_estimado?: number | null
          nombre: string
          notas?: string | null
          tipo: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          activa?: boolean | null
          completadas?: string[] | null
          created_at?: string | null
          dia_mes?: number
          id?: string
          meses?: string[] | null
          monto_estimado?: number | null
          nombre?: string
          notas?: string | null
          tipo?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      business_patterns: {
        Row: {
          amount_max: number
          amount_min: number
          confidence: number
          created_at: string
          description: string
          entities: Json
          frequency_days: number
          id: string
          last_occurrence: string | null
          occurrences: number
          pattern_key: string | null
          pattern_type: string
          source: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_max?: number
          amount_min?: number
          confidence?: number
          created_at?: string
          description?: string
          entities?: Json
          frequency_days?: number
          id?: string
          last_occurrence?: string | null
          occurrences?: number
          pattern_key?: string | null
          pattern_type: string
          source?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_max?: number
          amount_min?: number
          confidence?: number
          created_at?: string
          description?: string
          entities?: Json
          frequency_days?: number
          id?: string
          last_occurrence?: string | null
          occurrences?: number
          pattern_key?: string | null
          pattern_type?: string
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      card_description_rules: {
        Row: {
          active: boolean
          category_id: string | null
          created_at: string
          description: string
          id: string
          match_count: number
          responsible_id: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          description: string
          id?: string
          match_count?: number
          responsible_id?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          description?: string
          id?: string
          match_count?: number
          responsible_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_description_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_description_rules_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_description_rules_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          date: string
          description: string | null
          id: string
          notes: string | null
          petty_cash_movement_id: string | null
          responsible_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          date: string
          description?: string | null
          id?: string
          notes?: string | null
          petty_cash_movement_id?: string | null
          responsible_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          notes?: string | null
          petty_cash_movement_id?: string | null
          responsible_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_petty_cash_movement_id_fkey"
            columns: ["petty_cash_movement_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          cost_behavior: string | null
          created_at: string
          id: string
          is_tax_deductible: boolean
          name: string
          report_group: string
          sort_order: number
          user_id: string
        }
        Insert: {
          active?: boolean
          cost_behavior?: string | null
          created_at?: string
          id?: string
          is_tax_deductible?: boolean
          name: string
          report_group?: string
          sort_order?: number
          user_id: string
        }
        Update: {
          active?: boolean
          cost_behavior?: string | null
          created_at?: string
          id?: string
          is_tax_deductible?: boolean
          name?: string
          report_group?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: []
      }
      client_collection_scores: {
        Row: {
          category: string
          client_name: string
          created_at: string
          id: string
          invoices_count: number | null
          oldest_overdue_days: number | null
          reasoning: string | null
          recommended_action: string | null
          responsible_id: string | null
          score: number
          scored_at: string
          total_owed: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          client_name: string
          created_at?: string
          id?: string
          invoices_count?: number | null
          oldest_overdue_days?: number | null
          reasoning?: string | null
          recommended_action?: string | null
          responsible_id?: string | null
          score: number
          scored_at?: string
          total_owed?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          client_name?: string
          created_at?: string
          id?: string
          invoices_count?: number | null
          oldest_overdue_days?: number | null
          reasoning?: string | null
          recommended_action?: string | null
          responsible_id?: string | null
          score?: number
          scored_at?: string
          total_owed?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_collection_scores_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_collection_scores_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_permissions: {
        Row: {
          access_level: Database["public"]["Enums"]["module_access_level"]
          collaborator_id: string
          created_at: string
          id: string
          module_key: string
          updated_at: string
        }
        Insert: {
          access_level?: Database["public"]["Enums"]["module_access_level"]
          collaborator_id: string
          created_at?: string
          id?: string
          module_key: string
          updated_at?: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["module_access_level"]
          collaborator_id?: string
          created_at?: string
          id?: string
          module_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_permissions_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborators: {
        Row: {
          accepted_at: string | null
          collaborator_email: string
          collaborator_user_id: string | null
          created_at: string
          id: string
          invited_at: string
          name: string
          owner_user_id: string
          role: Database["public"]["Enums"]["collaborator_role"]
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          collaborator_email: string
          collaborator_user_id?: string | null
          created_at?: string
          id?: string
          invited_at?: string
          name?: string
          owner_user_id: string
          role: Database["public"]["Enums"]["collaborator_role"]
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          collaborator_email?: string
          collaborator_user_id?: string | null
          created_at?: string
          id?: string
          invited_at?: string
          name?: string
          owner_user_id?: string
          role?: Database["public"]["Enums"]["collaborator_role"]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      collection_touchpoints: {
        Row: {
          channel: string
          client_name: string
          contacted_at: string
          created_at: string
          id: string
          invoice_id: string | null
          notes: string | null
          outcome: string
          responsible_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          client_name: string
          contacted_at?: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          outcome: string
          responsible_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          client_name?: string
          contacted_at?: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          outcome?: string
          responsible_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_touchpoints_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_touchpoints_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      conciliacion_exclusiones: {
        Row: {
          created_at: string
          desc_normalizada: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          desc_normalizada: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          desc_normalizada?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          read_at: string | null
          replied_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          read_at?: string | null
          replied_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          read_at?: string | null
          replied_at?: string | null
        }
        Relationships: []
      }
      count_sessions: {
        Row: {
          created_at: string
          diffs_count: number
          ended_at: string
          id: string
          operator_id: string | null
          refs_count: number
          started_at: string | null
          units_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          diffs_count?: number
          ended_at?: string
          id?: string
          operator_id?: string | null
          refs_count?: number
          started_at?: string | null
          units_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          diffs_count?: number
          ended_at?: string
          id?: string
          operator_id?: string | null
          refs_count?: number
          started_at?: string | null
          units_count?: number
          user_id?: string
        }
        Relationships: []
      }
      credit_payments: {
        Row: {
          amount_paid: number
          created_at: string
          credit_id: string
          id: string
          interest_paid: number
          is_extra: boolean
          notes: string | null
          payment_date: string
          principal_paid: number
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          amount_paid: number
          created_at?: string
          credit_id: string
          id?: string
          interest_paid?: number
          is_extra?: boolean
          notes?: string | null
          payment_date: string
          principal_paid?: number
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          amount_paid?: number
          created_at?: string
          credit_id?: string
          id?: string
          interest_paid?: number
          is_extra?: boolean
          notes?: string | null
          payment_date?: string
          principal_paid?: number
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_payments_credit_id_fkey"
            columns: ["credit_id"]
            isOneToOne: false
            referencedRelation: "credits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      credits: {
        Row: {
          additional_costs_label: string | null
          additional_costs_pct: number
          amortization_type: string
          bank_name: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          default_category_id: string | null
          default_responsible_id: string | null
          first_payment_date: string
          id: string
          interest_rate_monthly: number
          name: string
          notes: string | null
          principal: number
          start_date: string
          status: string
          term_months: number
          updated_at: string
          user_id: string
        }
        Insert: {
          additional_costs_label?: string | null
          additional_costs_pct?: number
          amortization_type?: string
          bank_name?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          default_category_id?: string | null
          default_responsible_id?: string | null
          first_payment_date: string
          id?: string
          interest_rate_monthly: number
          name: string
          notes?: string | null
          principal: number
          start_date: string
          status?: string
          term_months: number
          updated_at?: string
          user_id: string
        }
        Update: {
          additional_costs_label?: string | null
          additional_costs_pct?: number
          amortization_type?: string
          bank_name?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          default_category_id?: string | null
          default_responsible_id?: string | null
          first_payment_date?: string
          id?: string
          interest_rate_monthly?: number
          name?: string
          notes?: string | null
          principal?: number
          start_date?: string
          status?: string
          term_months?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credits_default_category_id_fkey"
            columns: ["default_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_default_responsible_id_fkey"
            columns: ["default_responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_default_responsible_id_fkey"
            columns: ["default_responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      dian_alerts: {
        Row: {
          acknowledged_at: string | null
          alert_key: string
          created_at: string
          description: string
          id: string
          recommended_action: string | null
          resolved_at: string | null
          severity: string
          status: string
          title: string
          updated_at: string
          user_id: string
          verification_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          alert_key: string
          created_at?: string
          description: string
          id?: string
          recommended_action?: string | null
          resolved_at?: string | null
          severity: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
          verification_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          alert_key?: string
          created_at?: string
          description?: string
          id?: string
          recommended_action?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          verification_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dian_alerts_verification_id_fkey"
            columns: ["verification_id"]
            isOneToOne: false
            referencedRelation: "dian_verifications"
            referencedColumns: ["id"]
          },
        ]
      }
      dian_verifications: {
        Row: {
          created_at: string
          cross_check: Json | null
          duration_ms: number | null
          error_detail: string | null
          id: string
          raw_data: Json | null
          status: string
          summary: Json | null
          triggered_by: string
          user_id: string
          verification_type: string
        }
        Insert: {
          created_at?: string
          cross_check?: Json | null
          duration_ms?: number | null
          error_detail?: string | null
          id?: string
          raw_data?: Json | null
          status: string
          summary?: Json | null
          triggered_by?: string
          user_id: string
          verification_type: string
        }
        Update: {
          created_at?: string
          cross_check?: Json | null
          duration_ms?: number | null
          error_detail?: string | null
          id?: string
          raw_data?: Json | null
          status?: string
          summary?: Json | null
          triggered_by?: string
          user_id?: string
          verification_type?: string
        }
        Relationships: []
      }
      dispatch_scans: {
        Row: {
          id: string
          location: string | null
          operator_id: string | null
          quantity: number
          reference: string
          remision_id: string
          scanned_at: string
          serial: string | null
          user_id: string
        }
        Insert: {
          id?: string
          location?: string | null
          operator_id?: string | null
          quantity?: number
          reference: string
          remision_id: string
          scanned_at?: string
          serial?: string | null
          user_id: string
        }
        Update: {
          id?: string
          location?: string | null
          operator_id?: string | null
          quantity?: number
          reference?: string
          remision_id?: string
          scanned_at?: string
          serial?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_scans_remision_id_fkey"
            columns: ["remision_id"]
            isOneToOne: false
            referencedRelation: "remisiones"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaign_sends: {
        Row: {
          campaign_id: string
          created_at: string
          error_message: string | null
          id: string
          recipient_email: string
          recipient_user_id: string | null
          resend_email_id: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_email: string
          recipient_user_id?: string | null
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_email?: string
          recipient_user_id?: string | null
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          audience_filter: Json | null
          audience_type: string
          body_html: string
          body_text: string | null
          created_at: string
          created_by: string
          error_log: string | null
          failed_count: number
          from_name: string | null
          id: string
          recipient_count: number | null
          reply_to: string | null
          scheduled_at: string | null
          sent_at: string | null
          sent_count: number
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          audience_filter?: Json | null
          audience_type: string
          body_html: string
          body_text?: string | null
          created_at?: string
          created_by: string
          error_log?: string | null
          failed_count?: number
          from_name?: string | null
          id?: string
          recipient_count?: number | null
          reply_to?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          sent_count?: number
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          audience_filter?: Json | null
          audience_type?: string
          body_html?: string
          body_text?: string | null
          created_at?: string
          created_by?: string
          error_log?: string | null
          failed_count?: number
          from_name?: string | null
          id?: string
          recipient_count?: number | null
          reply_to?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          sent_count?: number
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      expected_payments: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          invoice_id: string | null
          notes: string | null
          paid_at: string | null
          responsible_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          paid_at?: string | null
          responsible_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          paid_at?: string | null
          responsible_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expected_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expected_payments_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expected_payments_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      external_trial_balance: {
        Row: {
          account_code: string
          account_name: string | null
          created_at: string
          id: string
          saldo: number
          snapshot_date: string | null
          source: string
          user_id: string
        }
        Insert: {
          account_code: string
          account_name?: string | null
          created_at?: string
          id?: string
          saldo?: number
          snapshot_date?: string | null
          source?: string
          user_id: string
        }
        Update: {
          account_code?: string
          account_name?: string | null
          created_at?: string
          id?: string
          saldo?: number
          snapshot_date?: string | null
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      financial_health_scores: {
        Row: {
          created_at: string
          details: Json | null
          id: string
          month: number
          score_cartera: number
          score_clasificacion: number
          score_conciliacion: number
          score_facturacion: number
          score_impuestos: number
          score_total: number
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: string
          month: number
          score_cartera?: number
          score_clasificacion?: number
          score_conciliacion?: number
          score_facturacion?: number
          score_impuestos?: number
          score_total?: number
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: string
          month?: number
          score_cartera?: number
          score_clasificacion?: number
          score_conciliacion?: number
          score_facturacion?: number
          score_impuestos?: number
          score_total?: number
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      fiscal_config: {
        Row: {
          actividad_principal: string | null
          agente_retencion: boolean | null
          autorretenedor: boolean | null
          codigo_ciiu: string | null
          created_at: string | null
          facturacion_electronica: boolean | null
          ica_city: string | null
          ica_periodicity: string | null
          id: string
          nit_digit: number | null
          nit_ultimo_digito: number | null
          nivel_ingresos: string | null
          nombre_facturador: string | null
          paid_dian_events: string[] | null
          persona_type: string | null
          regimen: string | null
          renta_type: string | null
          responsable_ica: boolean | null
          responsable_iva: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          actividad_principal?: string | null
          agente_retencion?: boolean | null
          autorretenedor?: boolean | null
          codigo_ciiu?: string | null
          created_at?: string | null
          facturacion_electronica?: boolean | null
          ica_city?: string | null
          ica_periodicity?: string | null
          id?: string
          nit_digit?: number | null
          nit_ultimo_digito?: number | null
          nivel_ingresos?: string | null
          nombre_facturador?: string | null
          paid_dian_events?: string[] | null
          persona_type?: string | null
          regimen?: string | null
          renta_type?: string | null
          responsable_ica?: boolean | null
          responsable_iva?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          actividad_principal?: string | null
          agente_retencion?: boolean | null
          autorretenedor?: boolean | null
          codigo_ciiu?: string | null
          created_at?: string | null
          facturacion_electronica?: boolean | null
          ica_city?: string | null
          ica_periodicity?: string | null
          id?: string
          nit_digit?: number | null
          nit_ultimo_digito?: number | null
          nivel_ingresos?: string | null
          nombre_facturador?: string | null
          paid_dian_events?: string[] | null
          persona_type?: string | null
          regimen?: string | null
          renta_type?: string | null
          responsable_ica?: boolean | null
          responsable_iva?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      fixed_assets: {
        Row: {
          activo: boolean
          categoria: string
          created_at: string
          fecha_compra: string
          id: string
          metodo: string
          nombre: string
          notas: string | null
          updated_at: string
          user_id: string
          valor_compra: number
          valor_residual: number
          vida_util_meses: number
        }
        Insert: {
          activo?: boolean
          categoria?: string
          created_at?: string
          fecha_compra: string
          id?: string
          metodo?: string
          nombre: string
          notas?: string | null
          updated_at?: string
          user_id: string
          valor_compra?: number
          valor_residual?: number
          vida_util_meses?: number
        }
        Update: {
          activo?: boolean
          categoria?: string
          created_at?: string
          fecha_compra?: string
          id?: string
          metodo?: string
          nombre?: string
          notas?: string | null
          updated_at?: string
          user_id?: string
          valor_compra?: number
          valor_residual?: number
          vida_util_meses?: number
        }
        Relationships: []
      }
      import_costs: {
        Row: {
          base_asignacion: string
          concepto: string | null
          created_at: string
          id: string
          import_id: string
          moneda: string
          monto: number
          orden: number
          tipo: string
          trm: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          base_asignacion?: string
          concepto?: string | null
          created_at?: string
          id?: string
          import_id: string
          moneda?: string
          monto?: number
          orden?: number
          tipo?: string
          trm?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          base_asignacion?: string
          concepto?: string | null
          created_at?: string
          id?: string
          import_id?: string
          moneda?: string
          monto?: number
          orden?: number
          tipo?: string
          trm?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_costs_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_costs_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports_liquidation"
            referencedColumns: ["import_id"]
          },
        ]
      }
      import_documents: {
        Row: {
          created_at: string
          filename: string | null
          id: string
          import_id: string
          notas: string | null
          storage_path: string
          tipo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filename?: string | null
          id?: string
          import_id: string
          notas?: string | null
          storage_path: string
          tipo: string
          user_id: string
        }
        Update: {
          created_at?: string
          filename?: string | null
          id?: string
          import_id?: string
          notas?: string | null
          storage_path?: string
          tipo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_documents_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_documents_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports_liquidation"
            referencedColumns: ["import_id"]
          },
        ]
      }
      import_estado_history: {
        Row: {
          created_at: string
          estado: string
          fecha: string
          id: string
          import_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          estado: string
          fecha?: string
          id?: string
          import_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          estado?: string
          fecha?: string
          id?: string
          import_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_estado_history_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_estado_history_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports_liquidation"
            referencedColumns: ["import_id"]
          },
        ]
      }
      import_items: {
        Row: {
          bultos: number | null
          cantidad: number
          color: string | null
          costo_unitario_excel: number | null
          created_at: string
          descripcion: string | null
          fob_total_usd: number
          id: string
          import_id: string
          notas: string | null
          orden: number
          peso_kg: number | null
          reference: string
          source: string
          unidad: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bultos?: number | null
          cantidad?: number
          color?: string | null
          costo_unitario_excel?: number | null
          created_at?: string
          descripcion?: string | null
          fob_total_usd?: number
          id?: string
          import_id: string
          notas?: string | null
          orden?: number
          peso_kg?: number | null
          reference: string
          source?: string
          unidad?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bultos?: number | null
          cantidad?: number
          color?: string | null
          costo_unitario_excel?: number | null
          created_at?: string
          descripcion?: string | null
          fob_total_usd?: number
          id?: string
          import_id?: string
          notas?: string | null
          orden?: number
          peso_kg?: number | null
          reference?: string
          source?: string
          unidad?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_items_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_items_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports_liquidation"
            referencedColumns: ["import_id"]
          },
        ]
      }
      import_manual_abonos: {
        Row: {
          cop: number
          created_at: string
          descripcion: string
          fecha: string
          id: string
          import_id: string
          trm: number
          user_id: string
        }
        Insert: {
          cop: number
          created_at?: string
          descripcion?: string
          fecha?: string
          id?: string
          import_id: string
          trm: number
          user_id: string
        }
        Update: {
          cop?: number
          created_at?: string
          descripcion?: string
          fecha?: string
          id?: string
          import_id?: string
          trm?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_manual_abonos_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_manual_abonos_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports_liquidation"
            referencedColumns: ["import_id"]
          },
        ]
      }
      import_payments: {
        Row: {
          amount_cop: number | null
          amount_usd: number
          created_at: string
          fecha: string
          id: string
          import_id: string
          notes: string | null
          tipo: string
          transaction_id: string | null
          trm: number
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cop?: number | null
          amount_usd: number
          created_at?: string
          fecha: string
          id?: string
          import_id: string
          notes?: string | null
          tipo?: string
          transaction_id?: string | null
          trm: number
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cop?: number | null
          amount_usd?: number
          created_at?: string
          fecha?: string
          id?: string
          import_id?: string
          notes?: string | null
          tipo?: string
          transaction_id?: string | null
          trm?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_payments_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_payments_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports_liquidation"
            referencedColumns: ["import_id"]
          },
          {
            foreignKeyName: "import_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      import_scenarios: {
        Row: {
          created_at: string
          flete_usd: number | null
          id: string
          import_id: string | null
          nombre: string
          notas: string | null
          smm_usd_ton: number | null
          snapshot: Json
          trm: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          flete_usd?: number | null
          id?: string
          import_id?: string | null
          nombre: string
          notas?: string | null
          smm_usd_ton?: number | null
          snapshot?: Json
          trm?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          flete_usd?: number | null
          id?: string
          import_id?: string | null
          nombre?: string
          notas?: string | null
          smm_usd_ton?: number | null
          snapshot?: Json
          trm?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_scenarios_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_scenarios_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports_liquidation"
            referencedColumns: ["import_id"]
          },
        ]
      }
      imports: {
        Row: {
          anticipo_pagado_usd: number
          arancel_pct: number
          cantidad_ton: number | null
          cerrada: boolean
          cerrada_at: string | null
          cerrada_by: string | null
          created_at: string
          estado: string
          fecha_anticipo: string | null
          fecha_arribo_real: string | null
          fecha_cotizacion: string | null
          fecha_embarque: string | null
          fecha_estimada_llegada: string | null
          id: string
          iva_pct: number
          monto_total_usd: number | null
          notas: string | null
          peso_real_kg: number | null
          precio_smm_cerrado_usd_ton: number | null
          proveedor_nombre: string
          ref_pedido: string | null
          responsible_id: string | null
          saldo_pendiente_usd: number | null
          trm_causacion: number | null
          unidades_reales: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          anticipo_pagado_usd?: number
          arancel_pct?: number
          cantidad_ton?: number | null
          cerrada?: boolean
          cerrada_at?: string | null
          cerrada_by?: string | null
          created_at?: string
          estado?: string
          fecha_anticipo?: string | null
          fecha_arribo_real?: string | null
          fecha_cotizacion?: string | null
          fecha_embarque?: string | null
          fecha_estimada_llegada?: string | null
          id?: string
          iva_pct?: number
          monto_total_usd?: number | null
          notas?: string | null
          peso_real_kg?: number | null
          precio_smm_cerrado_usd_ton?: number | null
          proveedor_nombre: string
          ref_pedido?: string | null
          responsible_id?: string | null
          saldo_pendiente_usd?: number | null
          trm_causacion?: number | null
          unidades_reales?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          anticipo_pagado_usd?: number
          arancel_pct?: number
          cantidad_ton?: number | null
          cerrada?: boolean
          cerrada_at?: string | null
          cerrada_by?: string | null
          created_at?: string
          estado?: string
          fecha_anticipo?: string | null
          fecha_arribo_real?: string | null
          fecha_cotizacion?: string | null
          fecha_embarque?: string | null
          fecha_estimada_llegada?: string | null
          id?: string
          iva_pct?: number
          monto_total_usd?: number | null
          notas?: string | null
          peso_real_kg?: number | null
          precio_smm_cerrado_usd_ton?: number | null
          proveedor_nombre?: string
          ref_pedido?: string | null
          responsible_id?: string | null
          saldo_pendiente_usd?: number | null
          trm_causacion?: number | null
          unidades_reales?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imports_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imports_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_invoice_addresses: {
        Row: {
          address: string
          created_at: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      initial_balance_matches: {
        Row: {
          created_at: string
          id: string
          initial_state_detail_id: string
          match_type: string
          matched_amount: number
          transaction_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          initial_state_detail_id: string
          match_type?: string
          matched_amount: number
          transaction_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          initial_state_detail_id?: string
          match_type?: string
          matched_amount?: number
          transaction_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "initial_balance_matches_initial_state_detail_id_fkey"
            columns: ["initial_state_detail_id"]
            isOneToOne: false
            referencedRelation: "initial_state_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initial_balance_matches_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      initial_financial_state: {
        Row: {
          anticipos_a_proveedores: number
          anticipos_de_clientes: number
          created_at: string
          cuentas_por_cobrar: number
          cuentas_por_pagar: number
          fecha_inicio: string
          ica_por_pagar: number
          id: string
          impuestos_por_pagar: number
          inventario: number
          iva_a_favor: number
          iva_por_pagar: number
          otros_activos: number
          prestamos: number
          retefuente_por_pagar: number
          saldo_bancos: number
          updated_at: string
          user_id: string
        }
        Insert: {
          anticipos_a_proveedores?: number
          anticipos_de_clientes?: number
          created_at?: string
          cuentas_por_cobrar?: number
          cuentas_por_pagar?: number
          fecha_inicio: string
          ica_por_pagar?: number
          id?: string
          impuestos_por_pagar?: number
          inventario?: number
          iva_a_favor?: number
          iva_por_pagar?: number
          otros_activos?: number
          prestamos?: number
          retefuente_por_pagar?: number
          saldo_bancos?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          anticipos_a_proveedores?: number
          anticipos_de_clientes?: number
          created_at?: string
          cuentas_por_cobrar?: number
          cuentas_por_pagar?: number
          fecha_inicio?: string
          ica_por_pagar?: number
          id?: string
          impuestos_por_pagar?: number
          inventario?: number
          iva_a_favor?: number
          iva_por_pagar?: number
          otros_activos?: number
          prestamos?: number
          retefuente_por_pagar?: number
          saldo_bancos?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      initial_state_details: {
        Row: {
          amount: number
          created_at: string
          field_type: string
          id: string
          invoice_id: string | null
          responsible_id: string | null
          responsible_name: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          field_type: string
          id?: string
          invoice_id?: string | null
          responsible_id?: string | null
          responsible_name?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          field_type?: string
          id?: string
          invoice_id?: string | null
          responsible_id?: string | null
          responsible_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "initial_state_details_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initial_state_details_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initial_state_details_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_config: {
        Row: {
          fecha_corte_stock: string
          updated_at: string
          user_id: string
        }
        Insert: {
          fecha_corte_stock: string
          updated_at?: string
          user_id: string
        }
        Update: {
          fecha_corte_stock?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      inventory_count_lines: {
        Row: {
          costo_unitario: number
          created_at: string
          descripcion: string | null
          diferencia: number | null
          es_nueva: boolean
          id: string
          nota: string | null
          session_id: string
          stock_contado: number
          stock_teorico: number
          user_id: string
          variant_id: string | null
          variant_reference: string
        }
        Insert: {
          costo_unitario?: number
          created_at?: string
          descripcion?: string | null
          diferencia?: number | null
          es_nueva?: boolean
          id?: string
          nota?: string | null
          session_id: string
          stock_contado?: number
          stock_teorico?: number
          user_id: string
          variant_id?: string | null
          variant_reference: string
        }
        Update: {
          costo_unitario?: number
          created_at?: string
          descripcion?: string | null
          diferencia?: number | null
          es_nueva?: boolean
          id?: string
          nota?: string | null
          session_id?: string
          stock_contado?: number
          stock_teorico?: number
          user_id?: string
          variant_id?: string | null
          variant_reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_lines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_sessions: {
        Row: {
          confirmado_at: string | null
          confirmado_por: string | null
          created_at: string
          cuenta_faltantes_como_cero: boolean
          estado: string
          fecha_conteo: string
          id: string
          nombre: string | null
          notas: string | null
          subido_por: string | null
          total_con_diferencia: number
          total_referencias: number
          total_unidades_diferencia: number
          total_valor_diferencia: number
          updated_at: string
          user_id: string
        }
        Insert: {
          confirmado_at?: string | null
          confirmado_por?: string | null
          created_at?: string
          cuenta_faltantes_como_cero?: boolean
          estado?: string
          fecha_conteo?: string
          id?: string
          nombre?: string | null
          notas?: string | null
          subido_por?: string | null
          total_con_diferencia?: number
          total_referencias?: number
          total_unidades_diferencia?: number
          total_valor_diferencia?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          confirmado_at?: string | null
          confirmado_por?: string | null
          created_at?: string
          cuenta_faltantes_como_cero?: boolean
          estado?: string
          fecha_conteo?: string
          id?: string
          nombre?: string | null
          notas?: string | null
          subido_por?: string | null
          total_con_diferencia?: number
          total_referencias?: number
          total_unidades_diferencia?: number
          total_valor_diferencia?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      inventory_counts: {
        Row: {
          count_date: string
          created_at: string
          difference: number
          id: string
          notes: string | null
          physical_quantity: number
          product_id: string
          system_quantity: number
          user_id: string
        }
        Insert: {
          count_date?: string
          created_at?: string
          difference?: number
          id?: string
          notes?: string | null
          physical_quantity?: number
          product_id: string
          system_quantity?: number
          user_id: string
        }
        Update: {
          count_date?: string
          created_at?: string
          difference?: number
          id?: string
          notes?: string | null
          physical_quantity?: number
          product_id?: string
          system_quantity?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_import_logs: {
        Row: {
          created_at: string
          error_details: Json | null
          file_name: string
          id: string
          import_mode: string
          rows_errors: number
          rows_imported: number
          user_id: string
        }
        Insert: {
          created_at?: string
          error_details?: Json | null
          file_name: string
          id?: string
          import_mode?: string
          rows_errors?: number
          rows_imported?: number
          user_id: string
        }
        Update: {
          created_at?: string
          error_details?: Json | null
          file_name?: string
          id?: string
          import_mode?: string
          rows_errors?: number
          rows_imported?: number
          user_id?: string
        }
        Relationships: []
      }
      inventory_labels: {
        Row: {
          created_at: string
          id: string
          location: string | null
          printed_at: string
          printed_by: string | null
          product_id: string | null
          quantity: number
          reference: string
          serial: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string | null
          printed_at?: string
          printed_by?: string | null
          product_id?: string | null
          quantity?: number
          reference: string
          serial: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location?: string | null
          printed_at?: string
          printed_by?: string | null
          product_id?: string | null
          quantity?: number
          reference?: string
          serial?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_labels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          created_at: string
          id: string
          location: string
          product_id: string
          quantity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location: string
          product_id: string
          quantity?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location?: string
          product_id?: string
          quantity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_locations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          costo_promedio_resultante: number | null
          created_at: string
          id: string
          invoice_id: string | null
          movement_date: string
          movement_type: string
          notes: string | null
          origen_id: string | null
          origen_tipo: string | null
          product_id: string
          quantity: number
          reference: string | null
          source_id: string | null
          source_type: string | null
          stock_resultante: number | null
          subtipo: string | null
          tipo: string | null
          total_cost: number
          unit_cost: number
          user_id: string
        }
        Insert: {
          costo_promedio_resultante?: number | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          movement_date?: string
          movement_type?: string
          notes?: string | null
          origen_id?: string | null
          origen_tipo?: string | null
          product_id: string
          quantity?: number
          reference?: string | null
          source_id?: string | null
          source_type?: string | null
          stock_resultante?: number | null
          subtipo?: string | null
          tipo?: string | null
          total_cost?: number
          unit_cost?: number
          user_id: string
        }
        Update: {
          costo_promedio_resultante?: number | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          movement_date?: string
          movement_type?: string
          notes?: string | null
          origen_id?: string | null
          origen_tipo?: string | null
          product_id?: string
          quantity?: number
          reference?: string | null
          source_id?: string | null
          source_type?: string | null
          stock_resultante?: number | null
          subtipo?: string | null
          tipo?: string | null
          total_cost?: number
          unit_cost?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_products: {
        Row: {
          active: boolean
          cost_per_unit: number
          created_at: string
          id: string
          last_count_date: string | null
          last_siigo_sync_at: string | null
          location: string | null
          min_stock: number
          name: string | null
          reference: string
          sale_price: number
          siigo_id: string | null
          source: string
          stock_inicial: number | null
          stock_inicial_date: string | null
          stock_physical: number | null
          stock_system: number
          system: string | null
          unit: string
          units_per_package: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          cost_per_unit?: number
          created_at?: string
          id?: string
          last_count_date?: string | null
          last_siigo_sync_at?: string | null
          location?: string | null
          min_stock?: number
          name?: string | null
          reference: string
          sale_price?: number
          siigo_id?: string | null
          source?: string
          stock_inicial?: number | null
          stock_inicial_date?: string | null
          stock_physical?: number | null
          stock_system?: number
          system?: string | null
          unit?: string
          units_per_package?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          cost_per_unit?: number
          created_at?: string
          id?: string
          last_count_date?: string | null
          last_siigo_sync_at?: string | null
          location?: string | null
          min_stock?: number
          name?: string | null
          reference?: string
          sale_price?: number
          siigo_id?: string | null
          source?: string
          stock_inicial?: number | null
          stock_inicial_date?: string | null
          stock_physical?: number | null
          stock_system?: number
          system?: string | null
          unit?: string
          units_per_package?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      inventory_variant_movements: {
        Row: {
          created_at: string
          fecha: string
          id: string
          movement_type: string
          nota: string | null
          quantity: number
          source_id: string | null
          source_type: string | null
          unit_cost: number
          user_id: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          fecha?: string
          id?: string
          movement_type: string
          nota?: string | null
          quantity: number
          source_id?: string | null
          source_type?: string | null
          unit_cost?: number
          user_id: string
          variant_id: string
        }
        Update: {
          created_at?: string
          fecha?: string
          id?: string
          movement_type?: string
          nota?: string | null
          quantity?: number
          source_id?: string | null
          source_type?: string | null
          unit_cost?: number
          user_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_variant_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_variants: {
        Row: {
          active: boolean
          avg_cost: number
          created_at: string
          id: string
          last_count_date: string | null
          name: string | null
          stock: number
          stock_inicial: number | null
          stock_inicial_date: string | null
          system: string | null
          updated_at: string
          user_id: string
          variant_reference: string
        }
        Insert: {
          active?: boolean
          avg_cost?: number
          created_at?: string
          id?: string
          last_count_date?: string | null
          name?: string | null
          stock?: number
          stock_inicial?: number | null
          stock_inicial_date?: string | null
          system?: string | null
          updated_at?: string
          user_id: string
          variant_reference: string
        }
        Update: {
          active?: boolean
          avg_cost?: number
          created_at?: string
          id?: string
          last_count_date?: string | null
          name?: string | null
          stock?: number
          stock_inicial?: number | null
          stock_inicial_date?: string | null
          system?: string | null
          updated_at?: string
          user_id?: string
          variant_reference?: string
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          description: string | null
          id: string
          invoice_id: string
          item_code: string | null
          iva_amount: number
          iva_rate: number
          line_base: number
          line_total: number
          quantity: number
          reference: string | null
          unit_price: number
          user_id: string
        }
        Insert: {
          description?: string | null
          id?: string
          invoice_id: string
          item_code?: string | null
          iva_amount?: number
          iva_rate?: number
          line_base?: number
          line_total?: number
          quantity?: number
          reference?: string | null
          unit_price?: number
          user_id: string
        }
        Update: {
          description?: string | null
          id?: string
          invoice_id?: string
          item_code?: string | null
          iva_amount?: number
          iva_rate?: number
          line_base?: number
          line_total?: number
          quantity?: number
          reference?: string | null
          unit_price?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_match_suggestions: {
        Row: {
          confidence: number
          created_at: string
          id: string
          invoice_id: string
          resolved_at: string | null
          resolved_by_user_id: string | null
          signals: Json
          status: string
          suggested_at: string
          transaction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence: number
          created_at?: string
          id?: string
          invoice_id: string
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          signals?: Json
          status?: string
          suggested_at?: string
          transaction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          id?: string
          invoice_id?: string
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          signals?: Json
          status?: string
          suggested_at?: string
          transaction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_match_suggestions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_match_suggestions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_transaction_matches: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          match_type: string
          matched_amount: number
          transaction_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          match_type?: string
          matched_amount?: number
          transaction_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          match_type?: string
          matched_amount?: number
          transaction_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_transaction_matches_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_transaction_matches_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          autoretefuente_amount: number | null
          autoretefuente_rate: number | null
          balance_pending: number | null
          buyer_name: string | null
          buyer_nit: string | null
          city: string | null
          confidence_score: number | null
          counterparty_name: string | null
          counterparty_nit: string | null
          created_at: string
          cufe: string | null
          dian_response: Json | null
          dian_validated_at: string | null
          dian_validation_status: string | null
          dias_credito: number | null
          display_name: string | null
          due_date: string | null
          extracted_data: Json | null
          id: string
          invoice_number: string
          issue_date: string
          iva_amount: number
          iva_rate: number
          notes: string | null
          number_int: number | null
          original_filename: string | null
          payment_method: string | null
          pdf_path: string | null
          prefix: string | null
          processing_error: string | null
          responsible_id: string | null
          retefuente_cliente_amount: number | null
          retefuente_cliente_rate: number | null
          reteica_amount: number | null
          reteica_rate: number | null
          seller_name: string | null
          seller_nit: string | null
          siigo_id: string | null
          source: string
          status: string
          storage_path: string | null
          subtotal_base: number
          total_amount: number
          type: string
          updated_at: string
          user_id: string
          void_type: string | null
          voided_amount: number | null
          voided_at: string | null
          voided_by_credit_note_id: string | null
          voided_by_credit_note_number: string | null
        }
        Insert: {
          autoretefuente_amount?: number | null
          autoretefuente_rate?: number | null
          balance_pending?: number | null
          buyer_name?: string | null
          buyer_nit?: string | null
          city?: string | null
          confidence_score?: number | null
          counterparty_name?: string | null
          counterparty_nit?: string | null
          created_at?: string
          cufe?: string | null
          dian_response?: Json | null
          dian_validated_at?: string | null
          dian_validation_status?: string | null
          dias_credito?: number | null
          display_name?: string | null
          due_date?: string | null
          extracted_data?: Json | null
          id?: string
          invoice_number: string
          issue_date: string
          iva_amount?: number
          iva_rate?: number
          notes?: string | null
          number_int?: number | null
          original_filename?: string | null
          payment_method?: string | null
          pdf_path?: string | null
          prefix?: string | null
          processing_error?: string | null
          responsible_id?: string | null
          retefuente_cliente_amount?: number | null
          retefuente_cliente_rate?: number | null
          reteica_amount?: number | null
          reteica_rate?: number | null
          seller_name?: string | null
          seller_nit?: string | null
          siigo_id?: string | null
          source?: string
          status?: string
          storage_path?: string | null
          subtotal_base?: number
          total_amount?: number
          type?: string
          updated_at?: string
          user_id: string
          void_type?: string | null
          voided_amount?: number | null
          voided_at?: string | null
          voided_by_credit_note_id?: string | null
          voided_by_credit_note_number?: string | null
        }
        Update: {
          autoretefuente_amount?: number | null
          autoretefuente_rate?: number | null
          balance_pending?: number | null
          buyer_name?: string | null
          buyer_nit?: string | null
          city?: string | null
          confidence_score?: number | null
          counterparty_name?: string | null
          counterparty_nit?: string | null
          created_at?: string
          cufe?: string | null
          dian_response?: Json | null
          dian_validated_at?: string | null
          dian_validation_status?: string | null
          dias_credito?: number | null
          display_name?: string | null
          due_date?: string | null
          extracted_data?: Json | null
          id?: string
          invoice_number?: string
          issue_date?: string
          iva_amount?: number
          iva_rate?: number
          notes?: string | null
          number_int?: number | null
          original_filename?: string | null
          payment_method?: string | null
          pdf_path?: string | null
          prefix?: string | null
          processing_error?: string | null
          responsible_id?: string | null
          retefuente_cliente_amount?: number | null
          retefuente_cliente_rate?: number | null
          reteica_amount?: number | null
          reteica_rate?: number | null
          seller_name?: string | null
          seller_nit?: string | null
          siigo_id?: string | null
          source?: string
          status?: string
          storage_path?: string | null
          subtotal_base?: number
          total_amount?: number
          type?: string
          updated_at?: string
          user_id?: string
          void_type?: string | null
          voided_amount?: number | null
          voided_at?: string | null
          voided_by_credit_note_id?: string | null
          voided_by_credit_note_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      label_counters: {
        Row: {
          last_seq: number
          product_id: string
          user_id: string
        }
        Insert: {
          last_seq?: number
          product_id: string
          user_id: string
        }
        Update: {
          last_seq?: number
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_counters_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
        ]
      }
      macro_indicators: {
        Row: {
          fetched_at: string
          id: string
          indicator_type: string
          metadata: Json | null
          period_date: string
          sector_code: string
          sector_name: string | null
          source: string | null
          unit: string | null
          value: number
        }
        Insert: {
          fetched_at?: string
          id?: string
          indicator_type: string
          metadata?: Json | null
          period_date: string
          sector_code?: string
          sector_name?: string | null
          source?: string | null
          unit?: string | null
          value: number
        }
        Update: {
          fetched_at?: string
          id?: string
          indicator_type?: string
          metadata?: Json | null
          period_date?: string
          sector_code?: string
          sector_name?: string | null
          source?: string | null
          unit?: string | null
          value?: number
        }
        Relationships: []
      }
      nico_agent_memory: {
        Row: {
          agent_key: string
          facts: Json
          id: string
          last_summarized_at: string | null
          message_count_at_summary: number
          summary: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_key: string
          facts?: Json
          id?: string
          last_summarized_at?: string | null
          message_count_at_summary?: number
          summary?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_key?: string
          facts?: Json
          id?: string
          last_summarized_at?: string | null
          message_count_at_summary?: number
          summary?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nico_knowledge_chunks: {
        Row: {
          agent_key: string
          content: string
          created_at: string | null
          embedding: string
          id: string
          metadata: Json | null
          source_lesson_id: string | null
        }
        Insert: {
          agent_key: string
          content: string
          created_at?: string | null
          embedding: string
          id?: string
          metadata?: Json | null
          source_lesson_id?: string | null
        }
        Update: {
          agent_key?: string
          content?: string
          created_at?: string | null
          embedding?: string
          id?: string
          metadata?: Json | null
          source_lesson_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nico_knowledge_chunks_source_lesson_id_fkey"
            columns: ["source_lesson_id"]
            isOneToOne: false
            referencedRelation: "nico_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      nico_lessons: {
        Row: {
          agent_key: string
          answer_summary: string
          created_at: string | null
          id: string
          like_count: number | null
          question_summary: string
          source_message_id: string | null
          user_id: string | null
        }
        Insert: {
          agent_key: string
          answer_summary: string
          created_at?: string | null
          id?: string
          like_count?: number | null
          question_summary: string
          source_message_id?: string | null
          user_id?: string | null
        }
        Update: {
          agent_key?: string
          answer_summary?: string
          created_at?: string | null
          id?: string
          like_count?: number | null
          question_summary?: string
          source_message_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nico_lessons_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "nico_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      nico_messages: {
        Row: {
          agent_key: string
          content: string
          created_at: string
          feedback: number | null
          feedback_at: string | null
          feedback_text: string | null
          id: string
          page_context: string | null
          role: string
          user_id: string
        }
        Insert: {
          agent_key?: string
          content: string
          created_at?: string
          feedback?: number | null
          feedback_at?: string | null
          feedback_text?: string | null
          id?: string
          page_context?: string | null
          role: string
          user_id: string
        }
        Update: {
          agent_key?: string
          content?: string
          created_at?: string
          feedback?: number | null
          feedback_at?: string | null
          feedback_text?: string | null
          id?: string
          page_context?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      nico_prompt_versions: {
        Row: {
          agent_key: string
          approved_at: string | null
          approved_by: string | null
          base_prompt: string
          changelog: string | null
          created_at: string | null
          evidence: Json | null
          id: string
          proposed_by: string | null
          status: string | null
          version: number
        }
        Insert: {
          agent_key: string
          approved_at?: string | null
          approved_by?: string | null
          base_prompt: string
          changelog?: string | null
          created_at?: string | null
          evidence?: Json | null
          id?: string
          proposed_by?: string | null
          status?: string | null
          version: number
        }
        Update: {
          agent_key?: string
          approved_at?: string | null
          approved_by?: string | null
          base_prompt?: string
          changelog?: string | null
          created_at?: string | null
          evidence?: Json | null
          id?: string
          proposed_by?: string | null
          status?: string | null
          version?: number
        }
        Relationships: []
      }
      operative_receivables: {
        Row: {
          amount: number
          created_at: string
          date: string
          description: string | null
          id: string
          responsible_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          date: string
          description?: string | null
          id?: string
          responsible_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          responsible_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operative_receivables_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operative_receivables_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_employee_events: {
        Row: {
          created_at: string
          dias: number | null
          employee_id: string
          fecha: string
          id: string
          monto: number | null
          notas: string | null
          tipo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dias?: number | null
          employee_id: string
          fecha?: string
          id?: string
          monto?: number | null
          notas?: string | null
          tipo: string
          user_id: string
        }
        Update: {
          created_at?: string
          dias?: number | null
          employee_id?: string
          fecha?: string
          id?: string
          monto?: number | null
          notas?: string | null
          tipo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_employee_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "payroll_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_employees: {
        Row: {
          activo: boolean
          arl_clase: number
          auxilio_transporte: boolean
          cargo: string | null
          created_at: string
          documento: string | null
          fecha_ingreso: string
          fecha_retiro: string | null
          id: string
          nombre: string
          notas: string | null
          salario_base: number
          tipo_contrato: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activo?: boolean
          arl_clase?: number
          auxilio_transporte?: boolean
          cargo?: string | null
          created_at?: string
          documento?: string | null
          fecha_ingreso: string
          fecha_retiro?: string | null
          id?: string
          nombre: string
          notas?: string | null
          salario_base: number
          tipo_contrato?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activo?: boolean
          arl_clase?: number
          auxilio_transporte?: boolean
          cargo?: string | null
          created_at?: string
          documento?: string | null
          fecha_ingreso?: string
          fecha_retiro?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          salario_base?: number
          tipo_contrato?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payroll_entries: {
        Row: {
          created_at: string
          employees_count: number | null
          id: string
          month: number
          notas: string | null
          parafiscales: number
          provision_prestaciones: number
          rates: Json
          salary_total: number
          seguridad_social: number
          total_costo_laboral: number
          transport_allowance: number
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          created_at?: string
          employees_count?: number | null
          id?: string
          month: number
          notas?: string | null
          parafiscales?: number
          provision_prestaciones?: number
          rates?: Json
          salary_total?: number
          seguridad_social?: number
          total_costo_laboral?: number
          transport_allowance?: number
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          created_at?: string
          employees_count?: number | null
          id?: string
          month?: number
          notas?: string | null
          parafiscales?: number
          provision_prestaciones?: number
          rates?: Json
          salary_total?: number
          seguridad_social?: number
          total_costo_laboral?: number
          transport_allowance?: number
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      petty_cash_closings: {
        Row: {
          closed_at: string
          computed_balance: number
          created_at: string
          declared_balance: number
          difference: number
          id: string
          movements_count: number
          notes: string | null
          period_end: string
          period_start: string
          saldos: Json | null
          status: string
          user_id: string
        }
        Insert: {
          closed_at?: string
          computed_balance?: number
          created_at?: string
          declared_balance?: number
          difference?: number
          id?: string
          movements_count?: number
          notes?: string | null
          period_end: string
          period_start: string
          saldos?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          closed_at?: string
          computed_balance?: number
          created_at?: string
          declared_balance?: number
          difference?: number
          id?: string
          movements_count?: number
          notes?: string | null
          period_end?: string
          period_start?: string
          saldos?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      petty_cash_movements: {
        Row: {
          amount: number
          cash_movement_id: string | null
          category_id: string | null
          closing_id: string | null
          concept: string | null
          created_at: string
          cuenta: string
          date: string
          id: string
          incluye_prestaciones_sociales: boolean
          kind: string
          notes: string | null
          numero_consecutivo: string | null
          numero_cuenta_cobro: string | null
          responsible_id: string | null
          retencion_amount: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          cash_movement_id?: string | null
          category_id?: string | null
          closing_id?: string | null
          concept?: string | null
          created_at?: string
          cuenta?: string
          date: string
          id?: string
          incluye_prestaciones_sociales?: boolean
          kind?: string
          notes?: string | null
          numero_consecutivo?: string | null
          numero_cuenta_cobro?: string | null
          responsible_id?: string | null
          retencion_amount?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          cash_movement_id?: string | null
          category_id?: string | null
          closing_id?: string | null
          concept?: string | null
          created_at?: string
          cuenta?: string
          date?: string
          id?: string
          incluye_prestaciones_sociales?: boolean
          kind?: string
          notes?: string | null
          numero_consecutivo?: string | null
          numero_cuenta_cobro?: string | null
          responsible_id?: string | null
          retencion_amount?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_movements_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_movements_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_movements_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_movements_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_movements_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_log: {
        Row: {
          actual: Json | null
          created_at: string
          hit: boolean | null
          id: string
          kind: string
          predicted: Json
          predicted_at: string
          resolve_after: string
          resolved_at: string | null
          subject_key: string
          subject_label: string
          user_id: string
        }
        Insert: {
          actual?: Json | null
          created_at?: string
          hit?: boolean | null
          id?: string
          kind: string
          predicted: Json
          predicted_at?: string
          resolve_after: string
          resolved_at?: string | null
          subject_key: string
          subject_label?: string
          user_id: string
        }
        Update: {
          actual?: Json | null
          created_at?: string
          hit?: boolean | null
          id?: string
          kind?: string
          predicted?: Json
          predicted_at?: string
          resolve_after?: string
          resolved_at?: string | null
          subject_key?: string
          subject_label?: string
          user_id?: string
        }
        Relationships: []
      }
      product_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          ref_siigo: string
          user_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          ref_siigo: string
          user_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          ref_siigo?: string
          user_id?: string
        }
        Relationships: []
      }
      product_master: {
        Row: {
          active: boolean
          created_at: string
          description: string
          id: string
          ref_local: string | null
          ref_proveedor_a: string | null
          ref_proveedor_b: string | null
          ref_proveedor_c: string | null
          ref_siigo: string
          system: string | null
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description: string
          id?: string
          ref_local?: string | null
          ref_proveedor_a?: string | null
          ref_proveedor_b?: string | null
          ref_proveedor_c?: string | null
          ref_siigo: string
          system?: string | null
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          ref_local?: string | null
          ref_proveedor_a?: string | null
          ref_proveedor_b?: string | null
          ref_proveedor_c?: string | null
          ref_siigo?: string
          system?: string | null
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      product_templates: {
        Row: {
          active: boolean
          apertura: string
          color: string | null
          created_at: string
          description: string | null
          desperdicio_pct: number
          id: string
          margen_pct: number
          name: string
          naves: number
          piezas: Json
          system: string | null
          tipo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          apertura?: string
          color?: string | null
          created_at?: string
          description?: string | null
          desperdicio_pct?: number
          id?: string
          margen_pct?: number
          name: string
          naves?: number
          piezas?: Json
          system?: string | null
          tipo?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          apertura?: string
          color?: string | null
          created_at?: string
          description?: string | null
          desperdicio_pct?: number
          id?: string
          margen_pct?: number
          name?: string
          naves?: number
          piezas?: Json
          system?: string | null
          tipo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      production_orders: {
        Row: {
          alto_m: number
          ancho_m: number
          cantidad: number
          consumo_aplicado: boolean
          costo_mano_obra: number
          costo_materiales: number
          costo_total: number | null
          created_at: string
          despiece: Json
          estado: string
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          notas: string | null
          produccion_aplicada: boolean
          producto_ref: string
          template_id: string | null
          template_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alto_m: number
          ancho_m: number
          cantidad: number
          consumo_aplicado?: boolean
          costo_mano_obra?: number
          costo_materiales?: number
          costo_total?: number | null
          created_at?: string
          despiece?: Json
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          notas?: string | null
          produccion_aplicada?: boolean
          producto_ref: string
          template_id?: string | null
          template_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alto_m?: number
          ancho_m?: number
          cantidad?: number
          consumo_aplicado?: boolean
          costo_mano_obra?: number
          costo_materiales?: number
          costo_total?: number | null
          created_at?: string
          despiece?: Json
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          notas?: string | null
          produccion_aplicada?: boolean
          producto_ref?: string
          template_id?: string | null
          template_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_orders_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "product_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          accounting_email: string | null
          aux_transporte_actual: number | null
          business_description: string | null
          business_employees_count: number | null
          business_logistics: string | null
          business_main_suppliers: string | null
          business_operation_days: string | null
          business_warehouse_location: string | null
          company_address: string | null
          company_city: string | null
          company_initial: string | null
          company_name: string | null
          company_nit: string | null
          company_phone: string | null
          created_at: string
          force_password_change: boolean
          full_name: string | null
          id: string
          letterhead_bottom_margin_mm: number
          letterhead_path: string | null
          letterhead_top_margin_mm: number
          onboarding_completed: boolean | null
          quote_labor_pct_default: number
          quote_terms_default: string | null
          quote_validity_days_default: number
          reteica_city: string | null
          reteica_rate: number | null
          smmlv_actual: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accounting_email?: string | null
          aux_transporte_actual?: number | null
          business_description?: string | null
          business_employees_count?: number | null
          business_logistics?: string | null
          business_main_suppliers?: string | null
          business_operation_days?: string | null
          business_warehouse_location?: string | null
          company_address?: string | null
          company_city?: string | null
          company_initial?: string | null
          company_name?: string | null
          company_nit?: string | null
          company_phone?: string | null
          created_at?: string
          force_password_change?: boolean
          full_name?: string | null
          id?: string
          letterhead_bottom_margin_mm?: number
          letterhead_path?: string | null
          letterhead_top_margin_mm?: number
          onboarding_completed?: boolean | null
          quote_labor_pct_default?: number
          quote_terms_default?: string | null
          quote_validity_days_default?: number
          reteica_city?: string | null
          reteica_rate?: number | null
          smmlv_actual?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accounting_email?: string | null
          aux_transporte_actual?: number | null
          business_description?: string | null
          business_employees_count?: number | null
          business_logistics?: string | null
          business_main_suppliers?: string | null
          business_operation_days?: string | null
          business_warehouse_location?: string | null
          company_address?: string | null
          company_city?: string | null
          company_initial?: string | null
          company_name?: string | null
          company_nit?: string | null
          company_phone?: string | null
          created_at?: string
          force_password_change?: boolean
          full_name?: string | null
          id?: string
          letterhead_bottom_margin_mm?: number
          letterhead_path?: string | null
          letterhead_top_margin_mm?: number
          onboarding_completed?: boolean | null
          quote_labor_pct_default?: number
          quote_terms_default?: string | null
          quote_validity_days_default?: number
          reteica_city?: string | null
          reteica_rate?: number | null
          smmlv_actual?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quotation_items: {
        Row: {
          area_m2: number
          color: string
          created_at: string
          description: string | null
          height_m: number
          id: string
          line_subtotal: number
          price_per_m2: number
          quantity: number
          quotation_id: string
          sort_order: number
          system: string
          template_id: string | null
          template_snapshot: Json | null
          width_m: number
        }
        Insert: {
          area_m2: number
          color: string
          created_at?: string
          description?: string | null
          height_m: number
          id?: string
          line_subtotal: number
          price_per_m2: number
          quantity?: number
          quotation_id: string
          sort_order?: number
          system: string
          template_id?: string | null
          template_snapshot?: Json | null
          width_m: number
        }
        Update: {
          area_m2?: number
          color?: string
          created_at?: string
          description?: string | null
          height_m?: number
          id?: string
          line_subtotal?: number
          price_per_m2?: number
          quantity?: number
          quotation_id?: string
          sort_order?: number
          system?: string
          template_id?: string | null
          template_snapshot?: Json | null
          width_m?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "product_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          accepted_at: string | null
          apply_iva: boolean
          apply_retefuente: boolean
          apply_reteica: boolean
          created_at: string
          id: string
          issue_date: string
          iva_amount: number
          iva_rate: number
          labor_amount: number
          labor_pct: number
          notes: string | null
          pdf_storage_path: string | null
          profit_amount: number
          profit_pct: number
          quote_number: string
          rejected_at: string | null
          responsible_id: string
          retefuente_amount: number
          retefuente_rate: number
          reteica_amount: number
          reteica_rate: number
          sent_at: string | null
          sent_email_to: string | null
          sent_whatsapp_to: string | null
          status: string
          subtotal_base: number
          total: number
          total_net: number
          total_with_iva: number
          updated_at: string
          user_id: string
          valid_until: string
        }
        Insert: {
          accepted_at?: string | null
          apply_iva?: boolean
          apply_retefuente?: boolean
          apply_reteica?: boolean
          created_at?: string
          id?: string
          issue_date?: string
          iva_amount?: number
          iva_rate?: number
          labor_amount?: number
          labor_pct?: number
          notes?: string | null
          pdf_storage_path?: string | null
          profit_amount?: number
          profit_pct?: number
          quote_number: string
          rejected_at?: string | null
          responsible_id: string
          retefuente_amount?: number
          retefuente_rate?: number
          reteica_amount?: number
          reteica_rate?: number
          sent_at?: string | null
          sent_email_to?: string | null
          sent_whatsapp_to?: string | null
          status?: string
          subtotal_base?: number
          total?: number
          total_net?: number
          total_with_iva?: number
          updated_at?: string
          user_id: string
          valid_until: string
        }
        Update: {
          accepted_at?: string | null
          apply_iva?: boolean
          apply_retefuente?: boolean
          apply_reteica?: boolean
          created_at?: string
          id?: string
          issue_date?: string
          iva_amount?: number
          iva_rate?: number
          labor_amount?: number
          labor_pct?: number
          notes?: string | null
          pdf_storage_path?: string | null
          profit_amount?: number
          profit_pct?: number
          quote_number?: string
          rejected_at?: string | null
          responsible_id?: string
          retefuente_amount?: number
          retefuente_rate?: number
          reteica_amount?: number
          reteica_rate?: number
          sent_at?: string | null
          sent_email_to?: string | null
          sent_whatsapp_to?: string | null
          status?: string
          subtotal_base?: number
          total?: number
          total_net?: number
          total_with_iva?: number
          updated_at?: string
          user_id?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotations_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_rules: {
        Row: {
          active: boolean | null
          amount_max: number | null
          amount_min: number | null
          auto_conciliate: boolean | null
          category_id: string | null
          category_name: string | null
          created_at: string | null
          day_max: number | null
          day_min: number | null
          description: string | null
          id: string
          keyword: string | null
          keyword_is_regex: boolean
          last_matched_at: string | null
          match_count: number | null
          movement_nature: string | null
          name: string
          pattern_ref: string | null
          responsible_id: string | null
          responsible_name: string | null
          tx_type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          active?: boolean | null
          amount_max?: number | null
          amount_min?: number | null
          auto_conciliate?: boolean | null
          category_id?: string | null
          category_name?: string | null
          created_at?: string | null
          day_max?: number | null
          day_min?: number | null
          description?: string | null
          id?: string
          keyword?: string | null
          keyword_is_regex?: boolean
          last_matched_at?: string | null
          match_count?: number | null
          movement_nature?: string | null
          name: string
          pattern_ref?: string | null
          responsible_id?: string | null
          responsible_name?: string | null
          tx_type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          active?: boolean | null
          amount_max?: number | null
          amount_min?: number | null
          auto_conciliate?: boolean | null
          category_id?: string | null
          category_name?: string | null
          created_at?: string | null
          day_max?: number | null
          day_min?: number | null
          description?: string | null
          id?: string
          keyword?: string | null
          keyword_is_regex?: boolean
          last_matched_at?: string | null
          match_count?: number | null
          movement_nature?: string | null
          name?: string
          pattern_ref?: string | null
          responsible_id?: string | null
          responsible_name?: string | null
          tx_type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_rules_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_rules_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      remision_invoices: {
        Row: {
          created_at: string | null
          id: string
          invoice_id: string
          remision_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invoice_id: string
          remision_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invoice_id?: string
          remision_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "remision_invoices_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remision_invoices_remision_id_fkey"
            columns: ["remision_id"]
            isOneToOne: false
            referencedRelation: "remisiones"
            referencedColumns: ["id"]
          },
        ]
      }
      remision_items: {
        Row: {
          created_at: string
          id: string
          product_name: string
          reference: string
          remision_id: string
          total_cost: number
          unit_cost: number
          units: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_name?: string
          reference?: string
          remision_id: string
          total_cost?: number
          unit_cost?: number
          units?: number
        }
        Update: {
          created_at?: string
          id?: string
          product_name?: string
          reference?: string
          remision_id?: string
          total_cost?: number
          unit_cost?: number
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "remision_items_remision_id_fkey"
            columns: ["remision_id"]
            isOneToOne: false
            referencedRelation: "remisiones"
            referencedColumns: ["id"]
          },
        ]
      }
      remision_payments: {
        Row: {
          amount_assigned: number
          created_at: string
          id: string
          notes: string | null
          payment_id: string
          payment_kind: string
          remision_id: string
          user_id: string
        }
        Insert: {
          amount_assigned: number
          created_at?: string
          id?: string
          notes?: string | null
          payment_id: string
          payment_kind: string
          remision_id: string
          user_id: string
        }
        Update: {
          amount_assigned?: number
          created_at?: string
          id?: string
          notes?: string | null
          payment_id?: string
          payment_kind?: string
          remision_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "remision_payments_remision_id_fkey"
            columns: ["remision_id"]
            isOneToOne: false
            referencedRelation: "remisiones"
            referencedColumns: ["id"]
          },
        ]
      }
      remisiones: {
        Row: {
          beneficiary: string
          created_at: string
          date: string
          id: string
          module_origin: string
          notes: string | null
          number: string
          quotation_id: string | null
          remision_type: string
          responsible_id: string | null
          status: string
          total_manual: number | null
          updated_at: string
          user_id: string
          verified_at: string | null
          verified_by: string | null
          verified_units: number | null
        }
        Insert: {
          beneficiary?: string
          created_at?: string
          date?: string
          id?: string
          module_origin?: string
          notes?: string | null
          number?: string
          quotation_id?: string | null
          remision_type?: string
          responsible_id?: string | null
          status?: string
          total_manual?: number | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
          verified_by?: string | null
          verified_units?: number | null
        }
        Update: {
          beneficiary?: string
          created_at?: string
          date?: string
          id?: string
          module_origin?: string
          notes?: string | null
          number?: string
          quotation_id?: string | null
          remision_type?: string
          responsible_id?: string | null
          status?: string
          total_manual?: number | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
          verified_by?: string | null
          verified_units?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "remisiones_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remisiones_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remisiones_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      responsible_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          responsible_id: string
          source: string
          user_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          responsible_id: string
          source?: string
          user_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          responsible_id?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "responsible_aliases_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "responsible_aliases_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
            referencedColumns: ["id"]
          },
        ]
      }
      responsibles: {
        Row: {
          active: boolean
          actividad_economica: string | null
          address: string | null
          ciudad: string | null
          created_at: string
          cupo_credito: number | null
          dias_credito: number | null
          dv: number | null
          email: string | null
          id: string
          name: string
          nit: string | null
          notas: string | null
          phone: string | null
          razon_social: string | null
          regimen: string | null
          responsible_type: string
          telefono: string | null
          tipo_documento: string | null
          tipo_persona: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          actividad_economica?: string | null
          address?: string | null
          ciudad?: string | null
          created_at?: string
          cupo_credito?: number | null
          dias_credito?: number | null
          dv?: number | null
          email?: string | null
          id?: string
          name: string
          nit?: string | null
          notas?: string | null
          phone?: string | null
          razon_social?: string | null
          regimen?: string | null
          responsible_type?: string
          telefono?: string | null
          tipo_documento?: string | null
          tipo_persona?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          actividad_economica?: string | null
          address?: string | null
          ciudad?: string | null
          created_at?: string
          cupo_credito?: number | null
          dias_credito?: number | null
          dv?: number | null
          email?: string | null
          id?: string
          name?: string
          nit?: string | null
          notas?: string | null
          phone?: string | null
          razon_social?: string | null
          regimen?: string | null
          responsible_type?: string
          telefono?: string | null
          tipo_documento?: string | null
          tipo_persona?: string | null
          user_id?: string
        }
        Relationships: []
      }
      subscription_charges: {
        Row: {
          amount_in_cents: number
          attempt_number: number
          attempted_at: string
          completed_at: string | null
          created_at: string
          id: string
          payment_method_id: string | null
          plan: string
          status: string
          user_id: string
          wompi_status: string | null
          wompi_status_message: string | null
          wompi_transaction_id: string | null
        }
        Insert: {
          amount_in_cents: number
          attempt_number?: number
          attempted_at?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          payment_method_id?: string | null
          plan: string
          status: string
          user_id: string
          wompi_status?: string | null
          wompi_status_message?: string | null
          wompi_transaction_id?: string | null
        }
        Update: {
          amount_in_cents?: number
          attempt_number?: number
          attempted_at?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          payment_method_id?: string | null
          plan?: string
          status?: string
          user_id?: string
          wompi_status?: string | null
          wompi_status_message?: string | null
          wompi_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_charges_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "user_payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_settings: {
        Row: {
          autoretefuente_rate: number
          created_at: string
          id: string
          is_autorretenedor: boolean
          retefuente_compra_rate: number
          reteica_city: string | null
          reteica_rate: number
          updated_at: string
          user_id: string
        }
        Insert: {
          autoretefuente_rate?: number
          created_at?: string
          id?: string
          is_autorretenedor?: boolean
          retefuente_compra_rate?: number
          reteica_city?: string | null
          reteica_rate?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          autoretefuente_rate?: number
          created_at?: string
          id?: string
          is_autorretenedor?: boolean
          retefuente_compra_rate?: number
          reteica_city?: string | null
          reteica_rate?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transaction_match_log: {
        Row: {
          id: string
          matched_at: string
          rule_id: string
          source: string
          transaction_id: string
          user_id: string
        }
        Insert: {
          id?: string
          matched_at?: string
          rule_id: string
          source: string
          transaction_id: string
          user_id: string
        }
        Update: {
          id?: string
          matched_at?: string
          rule_id?: string
          source?: string
          transaction_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_match_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_match_log_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number | null
          balance: number | null
          bank_code: string | null
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
          has_reteica: boolean | null
          id: string
          invoice_id: string | null
          iva_amount: number
          iva_rate: number
          iva_type: string | null
          movement_nature: string | null
          notes: string | null
          operational_type: string | null
          operative_receivable_assigned: boolean
          operative_responsible_id: string | null
          owner: string | null
          raw_line: string | null
          responsible_id: string | null
          retefuente_amount: number
          retefuente_rate: number
          reteica_amount: number | null
          statement_id: string
          sucursal: string | null
          transaction_type: string | null
          type: string | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          balance?: number | null
          bank_code?: string | null
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
          has_reteica?: boolean | null
          id?: string
          invoice_id?: string | null
          iva_amount?: number
          iva_rate?: number
          iva_type?: string | null
          movement_nature?: string | null
          notes?: string | null
          operational_type?: string | null
          operative_receivable_assigned?: boolean
          operative_responsible_id?: string | null
          owner?: string | null
          raw_line?: string | null
          responsible_id?: string | null
          retefuente_amount?: number
          retefuente_rate?: number
          reteica_amount?: number | null
          statement_id: string
          sucursal?: string | null
          transaction_type?: string | null
          type?: string | null
          user_id: string
        }
        Update: {
          amount?: number | null
          balance?: number | null
          bank_code?: string | null
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
          has_reteica?: boolean | null
          id?: string
          invoice_id?: string | null
          iva_amount?: number
          iva_rate?: number
          iva_type?: string | null
          movement_nature?: string | null
          notes?: string | null
          operational_type?: string | null
          operative_receivable_assigned?: boolean
          operative_responsible_id?: string | null
          owner?: string | null
          raw_line?: string | null
          responsible_id?: string | null
          retefuente_amount?: number
          retefuente_rate?: number
          reteica_amount?: number | null
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
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_operative_responsible_id_fkey"
            columns: ["operative_responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_operative_responsible_id_fkey"
            columns: ["operative_responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
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
            foreignKeyName: "transactions_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles_with_sales_flag"
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
      user_dian_credentials: {
        Row: {
          connection_status: string
          consent_signed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          last_login_at: string | null
          last_verification_at: string | null
          muisca_password_encrypted: string
          nit: string
          proactive_alerts_enabled: boolean
          rl_doc_number: string
          rl_doc_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_status?: string
          consent_signed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_login_at?: string | null
          last_verification_at?: string | null
          muisca_password_encrypted: string
          nit: string
          proactive_alerts_enabled?: boolean
          rl_doc_number: string
          rl_doc_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_status?: string
          consent_signed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_login_at?: string | null
          last_verification_at?: string | null
          muisca_password_encrypted?: string
          nit?: string
          proactive_alerts_enabled?: boolean
          rl_doc_number?: string
          rl_doc_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_payment_methods: {
        Row: {
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last_four: string | null
          created_at: string
          id: string
          last_error: string | null
          last_used_at: string | null
          status: string
          updated_at: string
          user_id: string
          wompi_customer_email: string | null
          wompi_payment_source_id: string
        }
        Insert: {
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last_four?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_used_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          wompi_customer_email?: string | null
          wompi_payment_source_id: string
        }
        Update: {
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last_four?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_used_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          wompi_customer_email?: string | null
          wompi_payment_source_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_siigo_credentials: {
        Row: {
          connection_status: string
          created_at: string
          id: string
          last_error: string | null
          last_invoice_pulled_at: string | null
          last_products_pulled_at: string | null
          last_sync_at: string | null
          partner_id: string
          siigo_access_key_encrypted: string
          siigo_username: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_status?: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_invoice_pulled_at?: string | null
          last_products_pulled_at?: string | null
          last_sync_at?: string | null
          partner_id?: string
          siigo_access_key_encrypted: string
          siigo_username: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_status?: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_invoice_pulled_at?: string | null
          last_products_pulled_at?: string | null
          last_sync_at?: string | null
          partner_id?: string
          siigo_access_key_encrypted?: string
          siigo_username?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          bank_accounts_count: number
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          pdf_uploads_this_month: number
          pdf_uploads_total: number
          plan: Database["public"]["Enums"]["subscription_plan"]
          plan_expires_at: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          trial_checklist: Json | null
          trial_started_at: string | null
          updated_at: string
          user_id: string
          wompi_transaction_id: string | null
        }
        Insert: {
          bank_accounts_count?: number
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          pdf_uploads_this_month?: number
          pdf_uploads_total?: number
          plan?: Database["public"]["Enums"]["subscription_plan"]
          plan_expires_at?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_checklist?: Json | null
          trial_started_at?: string | null
          updated_at?: string
          user_id: string
          wompi_transaction_id?: string | null
        }
        Update: {
          bank_accounts_count?: number
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          pdf_uploads_this_month?: number
          pdf_uploads_total?: number
          plan?: Database["public"]["Enums"]["subscription_plan"]
          plan_expires_at?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_checklist?: Json | null
          trial_started_at?: string | null
          updated_at?: string
          user_id?: string
          wompi_transaction_id?: string | null
        }
        Relationships: []
      }
      year_closing_lines: {
        Row: {
          closing_id: string
          created_at: string
          difference: number
          id: string
          real_amount: number
          responsible_id: string | null
          responsible_name: string | null
          rubro: string
          suggested_amount: number
          user_id: string
        }
        Insert: {
          closing_id: string
          created_at?: string
          difference?: number
          id?: string
          real_amount?: number
          responsible_id?: string | null
          responsible_name?: string | null
          rubro: string
          suggested_amount?: number
          user_id: string
        }
        Update: {
          closing_id?: string
          created_at?: string
          difference?: number
          id?: string
          real_amount?: number
          responsible_id?: string | null
          responsible_name?: string | null
          rubro?: string
          suggested_amount?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "year_closing_lines_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "year_closings"
            referencedColumns: ["id"]
          },
        ]
      }
      year_closings: {
        Row: {
          closed_at: string
          created_at: string
          fiscal_year: number
          id: string
          notes: string | null
          period_end: string
          period_start: string
          prev_state_snapshot: Json | null
          rolled_forward: boolean
          total_diferencia: number
          total_real: number
          total_sugerido: number
          user_id: string
        }
        Insert: {
          closed_at?: string
          created_at?: string
          fiscal_year: number
          id?: string
          notes?: string | null
          period_end: string
          period_start: string
          prev_state_snapshot?: Json | null
          rolled_forward?: boolean
          total_diferencia?: number
          total_real?: number
          total_sugerido?: number
          user_id: string
        }
        Update: {
          closed_at?: string
          created_at?: string
          fiscal_year?: number
          id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          prev_state_snapshot?: Json | null
          rolled_forward?: boolean
          total_diferencia?: number
          total_real?: number
          total_sugerido?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      imports_liquidation: {
        Row: {
          abonos_count: number | null
          import_id: string | null
          liquidada: boolean | null
          monto_total_usd: number | null
          proveedor_nombre: string | null
          saldo_pendiente_usd: number | null
          total_pagado_cop: number | null
          total_pagado_usd: number | null
          trm_promedio_ponderada: number | null
          user_id: string | null
        }
        Relationships: []
      }
      responsibles_with_sales_flag: {
        Row: {
          active: boolean | null
          address: string | null
          ciudad: string | null
          created_at: string | null
          email: string | null
          has_sales_history: boolean | null
          id: string | null
          name: string | null
          nit: string | null
          phone: string | null
          responsible_type: string | null
          telefono: string | null
          tipo_documento: string | null
          tipo_persona: string | null
          user_id: string | null
        }
        Insert: {
          active?: boolean | null
          address?: string | null
          ciudad?: string | null
          created_at?: string | null
          email?: string | null
          has_sales_history?: never
          id?: string | null
          name?: string | null
          nit?: string | null
          phone?: string | null
          responsible_type?: string | null
          telefono?: string | null
          tipo_documento?: string | null
          tipo_persona?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean | null
          address?: string | null
          ciudad?: string | null
          created_at?: string | null
          email?: string | null
          has_sales_history?: never
          id?: string | null
          name?: string | null
          nit?: string | null
          phone?: string | null
          responsible_type?: string | null
          telefono?: string | null
          tipo_documento?: string | null
          tipo_persona?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_match_learning_stats: {
        Row: {
          confirm_pct: number | null
          confirmed: number | null
          rejected: number | null
          signal: string | null
          total: number | null
          user_decisions_total: number | null
          user_id: string | null
          value: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      allocate_label_seq: {
        Args: { p_count: number; p_product_id: string }
        Returns: number
      }
      apply_pending_rules_for_user: {
        Args: { p_limit?: number; p_source?: string; p_user_id?: string }
        Returns: Json
      }
      apply_production_order: {
        Args: { p_action: string; p_order_id: string }
        Returns: Json
      }
      apply_reconciliation_rules_to_tx: {
        Args: { p_source?: string; p_tx_id: string }
        Returns: string
      }
      apply_variant_stock_delta: {
        Args: { p_delta: number; p_variant_id: string }
        Returns: number
      }
      apply_year_closing_opening: {
        Args: { p_closing_id: string }
        Returns: Json
      }
      auto_match_bank_payment: { Args: { p_tx_id: string }; Returns: Json }
      backfill_running_balance: {
        Args: { p_user_id: string }
        Returns: {
          updated_count: number
        }[]
      }
      cerrar_importacion: { Args: { p_import_id: string }; Returns: Json }
      check_pdf_upload_limit: { Args: { p_user_id: string }; Returns: Json }
      cleanup_expired_trial_data: { Args: never; Returns: undefined }
      close_fiscal_year: {
        Args: {
          p_fiscal_year: number
          p_lines: Json
          p_notes?: string
          p_total_real: number
          p_total_sugerido: number
        }
        Returns: string
      }
      close_petty_cash_period:
        | {
            Args: {
              p_declared_balance: number
              p_notes?: string
              p_period_end: string
              p_period_start: string
              p_user_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_declarados_por_cuenta?: Json
              p_declared_balance: number
              p_notes?: string
              p_period_end: string
              p_period_start: string
              p_user_id: string
            }
            Returns: string
          }
      cuadrar_inventario_teorico: { Args: never; Returns: number }
      current_data_owner: { Args: never; Returns: string }
      discard_petty_cash_closing: {
        Args: { p_closing_id: string }
        Returns: Json
      }
      expire_plans: { Args: never; Returns: undefined }
      find_duplicate_transactions: {
        Args: { p_candidates: Json; p_user_id: string }
        Returns: {
          candidate_index: number
          matched_amount: number
          matched_date: string
          matched_description: string
          matched_statement_id: string
          matched_tx_id: string
        }[]
      }
      fix_transaction_dates_for_statement: {
        Args: { p_statement_id: string }
        Returns: number
      }
      forecast_cashflow: {
        Args: { p_horizon_days?: number; p_user_id?: string }
        Returns: {
          confidence: number
          cumulative_balance: number
          expected_inflows: number
          expected_outflows: number
          fecha: string
          inflow_sources: Json
          net: number
          outflow_sources: Json
        }[]
      }
      forecast_cashflow_monthly: {
        Args: { p_months_ahead?: number; p_user_id?: string }
        Returns: {
          avg_confidence: number
          closing_balance: number
          month_label: string
          month_start: string
          net: number
          total_inflows: number
          total_outflows: number
        }[]
      }
      get_user_learning_adjustment: {
        Args: { p_signals: Json; p_user_id: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_pdf_upload: { Args: { p_user_id: string }; Returns: undefined }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      kardex_movimiento: {
        Args: {
          p_afecta_fisico?: boolean
          p_cantidad: number
          p_costo_unitario?: number
          p_notas?: string
          p_origen_id?: string
          p_origen_tipo?: string
          p_reference: string
          p_tipo: string
        }
        Returns: Json
      }
      mark_collaborator_active: { Args: never; Returns: undefined }
      merge_responsibles: {
        Args: { p_canonical_id: string; p_legacy_id: string }
        Returns: undefined
      }
      normalize_client_name: { Args: { s: string }; Returns: string }
      petty_cash_saldos_por_cuenta: {
        Args: { p_closing_id: string; p_declarados: Json }
        Returns: Json
      }
      promote_petty_cash_to_cash_movement: {
        Args: { p_movement_id: string }
        Returns: Json
      }
      prune_old_auth_failed_attempts: { Args: never; Returns: undefined }
      reabrir_importacion: { Args: { p_import_id: string }; Returns: Json }
      recalc_import_anticipo_usd: {
        Args: { p_import_id: string }
        Returns: undefined
      }
      reclose_petty_cash_closing: {
        Args: {
          p_closing_id: string
          p_declarados_por_cuenta?: Json
          p_declared_balance: number
          p_notes?: string
        }
        Returns: Json
      }
      recompute_catalog_cost: {
        Args: { p_catalog_ids: string[] }
        Returns: undefined
      }
      reconciliation_rule_specificity: {
        Args: {
          rule_row: Database["public"]["Tables"]["reconciliation_rules"]["Row"]
        }
        Returns: number
      }
      reopen_fiscal_year: { Args: { p_closing_id: string }; Returns: Json }
      reopen_petty_cash_closing: {
        Args: { p_closing_id: string }
        Returns: Json
      }
      reset_monthly_pdf_counts: { Args: never; Returns: undefined }
      revert_year_closing_opening: {
        Args: { p_closing_id: string }
        Returns: Json
      }
      run_bank_matching_for_user: {
        Args: { p_limit?: number; p_user_id?: string }
        Returns: Json
      }
      search_nico_chunks: {
        Args: {
          match_count?: number
          query_embedding: string
          target_agent_key: string
        }
        Returns: {
          chunk_id: string
          content: string
          similarity: number
        }[]
      }
      suggest_invoice_matches_for_tx: {
        Args: { p_tx_id: string }
        Returns: {
          confidence: number
          invoice_id: string
          signals: Json
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
      bank_statement_period_type: "monthly_close" | "weekly" | "custom"
      collaborator_role: "contadora" | "colaborador"
      module_access_level: "none" | "view" | "edit"
      subscription_plan: "demo" | "basico" | "empresarial" | "pro"
      subscription_status:
        | "active"
        | "canceled"
        | "past_due"
        | "trialing"
        | "inactive"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "user"],
      bank_statement_period_type: ["monthly_close", "weekly", "custom"],
      collaborator_role: ["contadora", "colaborador"],
      module_access_level: ["none", "view", "edit"],
      subscription_plan: ["demo", "basico", "empresarial", "pro"],
      subscription_status: [
        "active",
        "canceled",
        "past_due",
        "trialing",
        "inactive",
      ],
      transaction_simple_type: ["ingreso", "egreso", "transferencia"],
    },
  },
} as const
