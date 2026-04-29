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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
          pattern_type: string
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
          pattern_type: string
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
          pattern_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          responsible_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
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
        ]
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
      inventory_movements: {
        Row: {
          created_at: string
          id: string
          invoice_id: string | null
          movement_date: string
          movement_type: string
          notes: string | null
          product_id: string
          quantity: number
          source_id: string | null
          source_type: string | null
          total_cost: number
          unit_cost: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          movement_date?: string
          movement_type?: string
          notes?: string | null
          product_id: string
          quantity?: number
          source_id?: string | null
          source_type?: string | null
          total_cost?: number
          unit_cost?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          movement_date?: string
          movement_type?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          source_id?: string | null
          source_type?: string | null
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
          min_stock: number
          name: string | null
          reference: string
          sale_price: number
          siigo_id: string | null
          source: string
          stock_physical: number | null
          stock_system: number
          unit: string
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
          min_stock?: number
          name?: string | null
          reference: string
          sale_price?: number
          siigo_id?: string | null
          source?: string
          stock_physical?: number | null
          stock_system?: number
          unit?: string
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
          min_stock?: number
          name?: string | null
          reference?: string
          sale_price?: number
          siigo_id?: string | null
          source?: string
          stock_physical?: number | null
          stock_system?: number
          unit?: string
          updated_at?: string
          user_id?: string
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
          buyer_name: string | null
          buyer_nit: string | null
          city: string | null
          confidence_score: number | null
          counterparty_name: string | null
          counterparty_nit: string | null
          created_at: string
          cufe: string | null
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
        }
        Insert: {
          autoretefuente_amount?: number | null
          autoretefuente_rate?: number | null
          buyer_name?: string | null
          buyer_nit?: string | null
          city?: string | null
          confidence_score?: number | null
          counterparty_name?: string | null
          counterparty_nit?: string | null
          created_at?: string
          cufe?: string | null
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
        }
        Update: {
          autoretefuente_amount?: number | null
          autoretefuente_rate?: number | null
          buyer_name?: string | null
          buyer_nit?: string | null
          city?: string | null
          confidence_score?: number | null
          counterparty_name?: string | null
          counterparty_nit?: string | null
          created_at?: string
          cufe?: string | null
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
        }
        Relationships: [
          {
            foreignKeyName: "invoices_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
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
      nico_messages: {
        Row: {
          agent_key: string
          content: string
          created_at: string
          id: string
          page_context: string | null
          role: string
          user_id: string
        }
        Insert: {
          agent_key?: string
          content: string
          created_at?: string
          id?: string
          page_context?: string | null
          role: string
          user_id: string
        }
        Update: {
          agent_key?: string
          content?: string
          created_at?: string
          id?: string
          page_context?: string | null
          role?: string
          user_id?: string
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
        ]
      }
      petty_cash_movements: {
        Row: {
          amount: number
          category_id: string | null
          concept: string | null
          created_at: string
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
          category_id?: string | null
          concept?: string | null
          created_at?: string
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
          category_id?: string | null
          concept?: string | null
          created_at?: string
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
            foreignKeyName: "petty_cash_movements_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_movements_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          accounting_email: string | null
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
          reteica_city: string | null
          reteica_rate: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accounting_email?: string | null
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
          reteica_city?: string | null
          reteica_rate?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accounting_email?: string | null
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
          reteica_city?: string | null
          reteica_rate?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          last_matched_at: string | null
          match_count: number | null
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
          last_matched_at?: string | null
          match_count?: number | null
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
          last_matched_at?: string | null
          match_count?: number | null
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
      remisiones: {
        Row: {
          beneficiary: string
          created_at: string
          date: string
          id: string
          module_origin: string
          notes: string | null
          number: string
          remision_type: string
          responsible_id: string | null
          status: string
          total_manual: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          beneficiary?: string
          created_at?: string
          date?: string
          id?: string
          module_origin?: string
          notes?: string | null
          number?: string
          remision_type?: string
          responsible_id?: string | null
          status?: string
          total_manual?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          beneficiary?: string
          created_at?: string
          date?: string
          id?: string
          module_origin?: string
          notes?: string | null
          number?: string
          remision_type?: string
          responsible_id?: string | null
          status?: string
          total_manual?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "remisiones_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "responsibles"
            referencedColumns: ["id"]
          },
        ]
      }
      responsibles: {
        Row: {
          active: boolean
          ciudad: string | null
          created_at: string
          id: string
          name: string
          nit: string | null
          responsible_type: string
          telefono: string | null
          tipo_documento: string | null
          tipo_persona: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          ciudad?: string | null
          created_at?: string
          id?: string
          name: string
          nit?: string | null
          responsible_type?: string
          telefono?: string | null
          tipo_documento?: string | null
          tipo_persona?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          ciudad?: string | null
          created_at?: string
          id?: string
          name?: string
          nit?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_pdf_upload_limit: { Args: { p_user_id: string }; Returns: Json }
      cleanup_expired_trial_data: { Args: never; Returns: undefined }
      expire_plans: { Args: never; Returns: undefined }
      fix_transaction_dates_for_statement: {
        Args: { p_statement_id: string }
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
      prune_old_auth_failed_attempts: { Args: never; Returns: undefined }
      reset_monthly_pdf_counts: { Args: never; Returns: undefined }
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
  graphql_public: {
    Enums: {},
  },
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
