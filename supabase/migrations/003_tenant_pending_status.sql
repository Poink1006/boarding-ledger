-- Adds a 'pending' tenant status: a bed reserved for a tenant whose deposit
-- hasn't cleared yet. Bed still counts as occupied (reserved) — only
-- 'inactive' frees it. New tenants now default to 'pending' instead of
-- 'active'; staff explicitly activate them once the deposit is sufficient.

alter table public.tenants alter column status set default 'pending';

alter table public.tenants drop constraint if exists tenants_status_check;

alter table public.tenants
  add constraint tenants_status_check check (status in ('pending', 'active', 'inactive'));
