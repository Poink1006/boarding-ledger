-- Tracks a tenant's monthly rate over time so past billing cycles keep the
-- rate that actually applied then, instead of a rate change (e.g. from a
-- Move) silently recoloring already-billed months. See src/lib/balance.ts.

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

-- backfill: give every existing tenant an initial history entry matching
-- their current rate, so the monthly breakdown works immediately for them
insert into public.tenant_rate_changes (tenant_id, monthly_rate, effective_date)
select id, monthly_rate, move_in_date
from public.tenants
where move_in_date is not null;
