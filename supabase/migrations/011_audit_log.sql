-- Audit log: an append-only record of who changed what and when across the
-- money/sensitive tables. Captured by database triggers, so it records every
-- write regardless of how it happened (even a direct API call can't skip it),
-- and no client — admin included — can edit or delete entries (no UPDATE/DELETE
-- policy; the trigger inserts via SECURITY DEFINER).

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id text,                 -- text so it fits every table's id type (uuid, boolean, …)
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid,                  -- auth.uid() of who made the change
  actor_name text,                -- their profile name at the time (denormalized so it survives)
  old_data jsonb,                 -- row before (UPDATE/DELETE)
  new_data jsonb,                 -- row after (INSERT/UPDATE)
  created_at timestamptz not null default now()
);

create index audit_log_created_at_idx on public.audit_log(created_at desc);
create index audit_log_table_name_idx on public.audit_log(table_name);

alter table public.audit_log enable row level security;

-- only admins can read the log; nobody can write to it through the API
-- (inserts happen only via the SECURITY DEFINER trigger below)
create policy "audit_log_select_admin_only"
  on public.audit_log for select to authenticated
  using (public.is_admin());

-- generic trigger: records the change with the actor and full before/after rows
create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
begin
  select full_name into v_actor_name from public.profiles where id = v_actor;

  if (tg_op = 'DELETE') then
    insert into public.audit_log(table_name, record_id, action, actor_id, actor_name, old_data, new_data)
    values (tg_table_name, (old.id)::text, tg_op, v_actor, v_actor_name, to_jsonb(old), null);
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into public.audit_log(table_name, record_id, action, actor_id, actor_name, old_data, new_data)
    values (tg_table_name, (new.id)::text, tg_op, v_actor, v_actor_name, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_log(table_name, record_id, action, actor_id, actor_name, old_data, new_data)
    values (tg_table_name, (new.id)::text, tg_op, v_actor, v_actor_name, null, to_jsonb(new));
    return new;
  end if;
end;
$$;

-- attach to the sensitive tables (money, tenants, pricing, structure)
create trigger audit_tenants
  after insert or update or delete on public.tenants
  for each row execute function public.audit_trigger();

create trigger audit_payments
  after insert or update or delete on public.payments
  for each row execute function public.audit_trigger();

create trigger audit_utility_bills
  after insert or update or delete on public.utility_bills
  for each row execute function public.audit_trigger();

create trigger audit_tenant_rate_changes
  after insert or update or delete on public.tenant_rate_changes
  for each row execute function public.audit_trigger();

create trigger audit_rooms
  after insert or update or delete on public.rooms
  for each row execute function public.audit_trigger();

create trigger audit_apartments
  after insert or update or delete on public.apartments
  for each row execute function public.audit_trigger();

create trigger audit_room_price_groups
  after insert or update or delete on public.room_price_groups
  for each row execute function public.audit_trigger();

create trigger audit_app_settings
  after insert or update or delete on public.app_settings
  for each row execute function public.audit_trigger();
