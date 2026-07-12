-- ============================================================================
-- Victoria Residence — Supabase schema + RLS
-- Roles: 'admin' (full control) and 'user' (front-desk staff)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- profiles: one row per auth user, carries the role used by every RLS policy
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- helper: is the current JWT's user an admin? SECURITY DEFINER so it can read
-- profiles without recursing through the profiles RLS policy it's used in.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- signup trigger: auto-create a profile row (always role='user'; admins are
-- promoted manually via `update profiles set role='admin' where id=...`
-- run with the service role, never exposed to the client)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- profiles policies: everyone can read all profiles (needed to show "logged
-- by" names); users may update their own full_name but never their own role;
-- only admins may change anyone's role.
create policy "profiles_select_all"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_self_no_role_change"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

create policy "profiles_update_admin"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- app_settings: singleton row holding default shared/private rate per pax
-- ----------------------------------------------------------------------------
create table public.app_settings (
  id boolean primary key default true,
  default_shared_rate_per_pax numeric(10,2) not null default 5000,
  default_private_rate_per_pax numeric(10,2) not null default 8000,
  -- per-tenant utility allowance included in rent; overage beyond
  -- (allowance * current occupant count) is split across the apartment's
  -- current occupants — see src/lib/balance.ts
  electricity_allowance_per_tenant numeric(10,2) not null default 500,
  water_allowance_per_tenant numeric(10,2) not null default 200,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  constraint app_settings_singleton check (id)
);

insert into public.app_settings (id) values (true);

alter table public.app_settings enable row level security;

create policy "app_settings_select_all"
  on public.app_settings for select
  to authenticated
  using (true);

create policy "app_settings_update_admin_only"
  on public.app_settings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- apartments
-- ----------------------------------------------------------------------------
create table public.apartments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.apartments enable row level security;

create policy "apartments_select_all"
  on public.apartments for select to authenticated using (true);

create policy "apartments_write_admin_only"
  on public.apartments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- room_price_groups: a named shared+private rate pair applied to many rooms
-- at once (e.g. "Apt 1-6 · Rooms A/B"). Priority when resolving a room's
-- effective rate: custom_rate_per_pax > price group > global default (see
-- src/lib/rooms.ts effectiveRate()).
-- ----------------------------------------------------------------------------
create table public.room_price_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shared_rate_per_pax numeric(10,2) not null,
  private_rate_per_pax numeric(10,2) not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.room_price_groups enable row level security;

create policy "room_price_groups_select_all"
  on public.room_price_groups for select to authenticated using (true);

create policy "room_price_groups_write_admin_only"
  on public.room_price_groups for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- rooms
-- ----------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  label text not null,                          -- e.g. "Room 1"
  capacity int not null check (capacity > 0),    -- normal (shared) capacity
  private_capacity int,                          -- effective capacity when mode='private'
  mode text not null default 'shared' check (mode in ('shared', 'private')),
  custom_rate_per_pax numeric(10,2),             -- highest-priority override, null = use price group or default
  price_group_id uuid references public.room_price_groups(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint rooms_private_capacity_valid
    check (private_capacity is null or (private_capacity > 0 and private_capacity <= capacity))
);

create index rooms_apartment_id_idx on public.rooms(apartment_id);

alter table public.rooms enable row level security;

create policy "rooms_select_all"
  on public.rooms for select to authenticated using (true);

-- regular users may NOT insert/update/delete rooms (structure + pricing = admin only)
create policy "rooms_write_admin_only"
  on public.rooms for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- tenants
-- ----------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  tenant_number text not null unique,            -- e.g. "0726-001"

  -- personal
  first_name text not null,
  last_name text not null,
  birthdate date,
  contact_number text,
  email text,
  address text,

  -- emergency contact
  emergency_name text,
  emergency_relationship text,
  emergency_phone text,

  -- school
  school text,
  course text,
  year_level text,

  -- room / bed assignment
  room_id uuid references public.rooms(id) on delete set null,
  bed_index int,

  -- booking
  monthly_rate numeric(10,2) not null default 0,
  date_applied date not null default current_date,
  move_in_date date,
  duration_months int check (duration_months > 0),
  move_out_date date,
  -- pending: bed reserved, deposit not yet sufficient; active: confirmed resident;
  -- inactive: moved out, bed freed
  status text not null default 'pending' constraint tenants_status_check check (status in ('pending', 'active', 'inactive')),

  -- security/damage deposit — separate from rent (payments table). refunded
  -- covers full/partial/zero return; deposit_returned_amount + deposit_notes
  -- capture any deduction for damages.
  deposit_amount numeric(10,2) not null default 0,
  deposit_status text not null default 'unpaid' check (deposit_status in ('unpaid', 'held', 'refunded')),
  deposit_collected_date date,
  deposit_returned_amount numeric(10,2),
  deposit_returned_date date,
  deposit_notes text,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index tenants_room_id_idx on public.tenants(room_id);
create index tenants_status_idx on public.tenants(status);

alter table public.tenants enable row level security;

create policy "tenants_select_all"
  on public.tenants for select to authenticated using (true);

-- both roles can create tenants
create policy "tenants_insert_any_authenticated"
  on public.tenants for insert to authenticated
  with check (true);

-- both roles can update tenants (edits, move-outs); admin can update anything too
create policy "tenants_update_any_authenticated"
  on public.tenants for update to authenticated
  using (true) with check (true);

-- only admin can delete a tenant
create policy "tenants_delete_admin_only"
  on public.tenants for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- tenant_rate_changes: tracks a tenant's monthly rate over time so past
-- billing cycles keep the rate that actually applied then, instead of a
-- rate change (e.g. from a Move) silently recoloring already-billed months.
-- ----------------------------------------------------------------------------
create table public.tenant_rate_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  monthly_rate numeric(10,2) not null,
  effective_date date not null,  -- cycles anchored on/after this date use this rate
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create index tenant_rate_changes_tenant_id_idx on public.tenant_rate_changes(tenant_id);

alter table public.tenant_rate_changes enable row level security;

create policy "tenant_rate_changes_select_all"
  on public.tenant_rate_changes for select to authenticated using (true);

create policy "tenant_rate_changes_insert_any_authenticated"
  on public.tenant_rate_changes for insert to authenticated
  with check (true);

create policy "tenant_rate_changes_delete_admin_only"
  on public.tenant_rate_changes for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- payments — a running balance ledger, not per-month due/paid rows.
-- Each row is a payment a tenant made (a "top-up"). How many months that
-- covers is derived in the app from tenant.monthly_rate + move_in_date vs.
-- the sum of a tenant's payments — no month field, no scheduled job needed.
-- ----------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  -- rent top-ups and utility-overage payments are tracked as independent
  -- pools — a rent payment never covers a utility charge or vice versa
  payment_type text not null default 'rent' check (payment_type in ('rent', 'utility')),
  date_paid date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index payments_tenant_id_idx on public.payments(tenant_id);
create index payments_date_paid_idx on public.payments(date_paid);

alter table public.payments enable row level security;

create policy "payments_select_all"
  on public.payments for select to authenticated using (true);

-- both roles can log payments
create policy "payments_insert_any_authenticated"
  on public.payments for insert to authenticated
  with check (true);

-- both roles can edit payments (fix typos); admin included implicitly
create policy "payments_update_any_authenticated"
  on public.payments for update to authenticated
  using (true) with check (true);

-- only admin can delete a payment
create policy "payments_delete_admin_only"
  on public.payments for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- utility_bills — per-apartment water/electricity billing. Staff enter usage
-- + total cost for a billing period; the ₱/unit rate is computed in the app
-- (total_cost / usage), not stored, so it's always consistent.
-- ----------------------------------------------------------------------------
create table public.utility_bills (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  utility_type text not null check (utility_type in ('water', 'electricity')),
  billing_month date not null,                   -- stored as first-of-month, e.g. 2026-07-01
  usage numeric(10,2) not null check (usage > 0), -- kWh for electricity, cubic meters for water
  total_cost numeric(10,2) not null check (total_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index utility_bills_apartment_id_idx on public.utility_bills(apartment_id);
create index utility_bills_billing_month_idx on public.utility_bills(billing_month);

alter table public.utility_bills enable row level security;

create policy "utility_bills_select_all"
  on public.utility_bills for select to authenticated using (true);

create policy "utility_bills_insert_any_authenticated"
  on public.utility_bills for insert to authenticated
  with check (true);

create policy "utility_bills_update_any_authenticated"
  on public.utility_bills for update to authenticated
  using (true) with check (true);

create policy "utility_bills_delete_admin_only"
  on public.utility_bills for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_set_updated_at before update on public.tenants
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger utility_bills_set_updated_at before update on public.utility_bills
  for each row execute function public.set_updated_at();
create trigger room_price_groups_set_updated_at before update on public.room_price_groups
  for each row execute function public.set_updated_at();
