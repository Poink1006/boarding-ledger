-- Operating expenses (money going out) so the owner can see net income, not
-- just gross collections. Categories cover the recurring costs: staff salary,
-- internet, cleaning materials, and a miscellaneous bucket.
--
-- Apartment utility costs are deliberately NOT stored here — they already live
-- in utility_bills and are summed into the expenses view live in the app, so
-- there's a single source of truth and no double entry.
--
-- Expenses include employee salaries, so this table is admin-only at the RLS
-- level (not merely hidden in the UI): regular staff cannot read it even with a
-- direct API call. Deletes are soft (deleted_at), matching tenants/payments.

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('salary', 'internet', 'cleaning', 'miscellaneous')),
  label text,                                    -- optional short description, e.g. employee name
  amount numeric(12,2) not null check (amount >= 0),
  expense_month date not null,                   -- first-of-month, e.g. 2026-07-01
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index expenses_month_idx on public.expenses(expense_month);

alter table public.expenses enable row level security;

-- admin-only for every operation — salaries are sensitive
create policy "expenses_select_admin_only"
  on public.expenses for select to authenticated using (public.is_admin());
create policy "expenses_insert_admin_only"
  on public.expenses for insert to authenticated with check (public.is_admin());
create policy "expenses_update_admin_only"
  on public.expenses for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "expenses_delete_admin_only"
  on public.expenses for delete to authenticated using (public.is_admin());

create trigger expenses_set_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

-- record every change in the audit log, like the other money tables
create trigger audit_expenses
  after insert or update or delete on public.expenses
  for each row execute function public.audit_trigger();
