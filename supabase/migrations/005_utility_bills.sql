-- Per-apartment utility billing (water/electricity). Staff enter usage +
-- total cost for a billing period; the ₱/unit rate is computed in the app
-- (total_cost / usage), not stored, so it's always consistent.

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

-- both roles can log utility bills
create policy "utility_bills_insert_any_authenticated"
  on public.utility_bills for insert to authenticated
  with check (true);

create policy "utility_bills_update_any_authenticated"
  on public.utility_bills for update to authenticated
  using (true) with check (true);

-- only admin can delete a utility bill
create policy "utility_bills_delete_admin_only"
  on public.utility_bills for delete to authenticated
  using (public.is_admin());

create trigger utility_bills_set_updated_at before update on public.utility_bills
  for each row execute function public.set_updated_at();
