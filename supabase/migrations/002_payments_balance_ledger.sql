-- Converts `payments` from per-month due/paid rows into a running balance
-- ledger of payment transactions. Run this once in the Supabase SQL editor
-- against an existing project that already has the old `payments` schema.
--
-- This drops the payments table (and any rows in it — fine for test data;
-- back up first if you've logged real payments already).

drop table if exists public.payments;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
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

create policy "payments_insert_any_authenticated"
  on public.payments for insert to authenticated
  with check (true);

create policy "payments_update_any_authenticated"
  on public.payments for update to authenticated
  using (true) with check (true);

create policy "payments_delete_admin_only"
  on public.payments for delete to authenticated
  using (public.is_admin());

create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
