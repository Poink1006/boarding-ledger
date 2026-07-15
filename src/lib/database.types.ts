// Hand-written to match supabase/schema.sql. Regenerate/adjust manually if
// the schema changes (or swap in `supabase gen types typescript` output once
// the Supabase CLI is wired up).

export type UserRole = 'admin' | 'user'
export type RoomMode = 'shared' | 'private'
export type TenantStatus = 'pending' | 'active' | 'inactive'
export type DepositStatus = 'unpaid' | 'held' | 'refunded'
export type UtilityType = 'water' | 'electricity'
export type PaymentType = 'rent' | 'utility'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string
          role: UserRole
          created_at: string
        }
        Insert: {
          id: string
          full_name?: string
          role?: UserRole
          created_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          role?: UserRole
          created_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: boolean
          default_shared_rate_per_pax: number
          default_private_rate_per_pax: number
          electricity_allowance_per_tenant: number
          water_allowance_per_tenant: number
          business_name: string
          business_address: string | null
          business_contact: string | null
          payment_instructions: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          default_shared_rate_per_pax?: number
          default_private_rate_per_pax?: number
          electricity_allowance_per_tenant?: number
          water_allowance_per_tenant?: number
          business_name?: string
          business_address?: string | null
          business_contact?: string | null
          payment_instructions?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          default_shared_rate_per_pax?: number
          default_private_rate_per_pax?: number
          electricity_allowance_per_tenant?: number
          water_allowance_per_tenant?: number
          business_name?: string
          business_address?: string | null
          business_contact?: string | null
          payment_instructions?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      apartments: {
        Row: {
          id: string
          name: string
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          sort_order?: number
          created_at?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          id: string
          apartment_id: string
          label: string
          capacity: number
          private_capacity: number | null
          mode: RoomMode
          custom_rate_per_pax: number | null
          price_group_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          apartment_id: string
          label: string
          capacity: number
          private_capacity?: number | null
          mode?: RoomMode
          custom_rate_per_pax?: number | null
          price_group_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          apartment_id?: string
          label?: string
          capacity?: number
          private_capacity?: number | null
          mode?: RoomMode
          custom_rate_per_pax?: number | null
          price_group_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      room_price_groups: {
        Row: {
          id: string
          name: string
          shared_rate_per_pax: number
          private_rate_per_pax: number
          created_at: string
          created_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          shared_rate_per_pax: number
          private_rate_per_pax: number
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          shared_rate_per_pax?: number
          private_rate_per_pax?: number
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          id: string
          tenant_number: string
          first_name: string
          last_name: string
          birthdate: string | null
          contact_number: string | null
          email: string | null
          address: string | null
          emergency_name: string | null
          emergency_relationship: string | null
          emergency_phone: string | null
          school: string | null
          course: string | null
          year_level: string | null
          room_id: string | null
          bed_index: number | null
          monthly_rate: number
          custom_rate_per_pax: number | null
          date_applied: string
          move_in_date: string | null
          duration_months: number | null
          move_out_date: string | null
          status: TenantStatus
          deposit_amount: number
          deposit_status: DepositStatus
          deposit_collected_date: string | null
          deposit_returned_amount: number | null
          deposit_returned_date: string | null
          deposit_notes: string | null
          deleted_at: string | null
          created_at: string
          created_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_number: string
          first_name: string
          last_name: string
          birthdate?: string | null
          contact_number?: string | null
          email?: string | null
          address?: string | null
          emergency_name?: string | null
          emergency_relationship?: string | null
          emergency_phone?: string | null
          school?: string | null
          course?: string | null
          year_level?: string | null
          room_id?: string | null
          bed_index?: number | null
          monthly_rate?: number
          custom_rate_per_pax?: number | null
          date_applied?: string
          move_in_date?: string | null
          duration_months?: number | null
          move_out_date?: string | null
          status?: TenantStatus
          deposit_amount?: number
          deposit_status?: DepositStatus
          deposit_collected_date?: string | null
          deposit_returned_amount?: number | null
          deposit_returned_date?: string | null
          deposit_notes?: string | null
          deleted_at?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_number?: string
          first_name?: string
          last_name?: string
          birthdate?: string | null
          contact_number?: string | null
          email?: string | null
          address?: string | null
          emergency_name?: string | null
          emergency_relationship?: string | null
          emergency_phone?: string | null
          school?: string | null
          course?: string | null
          year_level?: string | null
          room_id?: string | null
          bed_index?: number | null
          monthly_rate?: number
          custom_rate_per_pax?: number | null
          date_applied?: string
          move_in_date?: string | null
          duration_months?: number | null
          move_out_date?: string | null
          status?: TenantStatus
          deposit_amount?: number
          deposit_status?: DepositStatus
          deposit_collected_date?: string | null
          deposit_returned_amount?: number | null
          deposit_returned_date?: string | null
          deposit_notes?: string | null
          deleted_at?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tenant_rate_changes: {
        Row: {
          id: string
          tenant_id: string
          monthly_rate: number
          effective_date: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          monthly_rate: number
          effective_date: string
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          monthly_rate?: number
          effective_date?: string
          created_at?: string
          created_by?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          id: string
          tenant_id: string
          amount: number
          payment_type: PaymentType
          date_paid: string
          notes: string | null
          receipt_no: number | null
          deleted_at: string | null
          created_at: string
          created_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          amount: number
          payment_type?: PaymentType
          date_paid?: string
          notes?: string | null
          receipt_no?: number | null
          deleted_at?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          amount?: number
          payment_type?: PaymentType
          date_paid?: string
          notes?: string | null
          receipt_no?: number | null
          deleted_at?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      utility_bills: {
        Row: {
          id: string
          apartment_id: string
          utility_type: UtilityType
          billing_month: string
          usage: number
          total_cost: number
          notes: string | null
          created_at: string
          created_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          apartment_id: string
          utility_type: UtilityType
          billing_month: string
          usage: number
          total_cost: number
          notes?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          apartment_id?: string
          utility_type?: UtilityType
          billing_month?: string
          usage?: number
          total_cost?: number
          notes?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          table_name: string
          record_id: string | null
          action: 'INSERT' | 'UPDATE' | 'DELETE'
          actor_id: string | null
          actor_name: string | null
          old_data: Record<string, unknown> | null
          new_data: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          table_name: string
          record_id?: string | null
          action: 'INSERT' | 'UPDATE' | 'DELETE'
          actor_id?: string | null
          actor_name?: string | null
          old_data?: Record<string, unknown> | null
          new_data?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          id?: string
          table_name?: string
          record_id?: string | null
          action?: 'INSERT' | 'UPDATE' | 'DELETE'
          actor_id?: string | null
          actor_name?: string | null
          old_data?: Record<string, unknown> | null
          new_data?: Record<string, unknown> | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: {
        Args: Record<string, never>
        Returns: boolean
      }
    }
  }
}
