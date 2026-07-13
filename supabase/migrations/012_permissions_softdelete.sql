-- 1) Database-level enforcement of the "non-admins can't edit identity or
--    pricing" rule — previously only the UI enforced this, so a determined
--    user could bypass it with a raw API call. A BEFORE UPDATE trigger turns
--    that "please don't" into a "can't".
-- 2) Soft delete for tenants and payments: rows are archived (deleted_at set)
--    instead of destroyed, so mistakes are recoverable and history survives.

-- ----------------------------------------------------------------------------
-- soft-delete columns
-- ----------------------------------------------------------------------------
alter table public.tenants  add column if not exists deleted_at timestamptz;
alter table public.payments add column if not exists deleted_at timestamptz;

-- ----------------------------------------------------------------------------
-- tenants: column-level permission rules for non-admins
-- ----------------------------------------------------------------------------
create or replace function public.enforce_tenant_permissions()
returns trigger
language plpgsql
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  -- identity is locked
  if new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name
     or new.tenant_number is distinct from old.tenant_number then
    raise exception 'Only an admin can change a tenant''s name or number.';
  end if;

  -- per-tenant custom rate is a pricing decision — admin only
  if new.custom_rate_per_pax is distinct from old.custom_rate_per_pax then
    raise exception 'Only an admin can change a tenant''s custom rate.';
  end if;

  -- monthly rate may only change as part of a room move (rate re-syncs to the
  -- new room); a rate change without a move is a pricing edit — admin only
  if new.monthly_rate is distinct from old.monthly_rate
     and new.room_id is not distinct from old.room_id then
    raise exception 'Only an admin can change a tenant''s monthly rate.';
  end if;

  -- deposit amount may only be set when none exists yet (the "add security
  -- deposit" flow); changing an existing deposit amount is admin only
  if new.deposit_amount is distinct from old.deposit_amount
     and old.deposit_amount <> 0 then
    raise exception 'Only an admin can change an existing security deposit amount.';
  end if;

  -- archiving / restoring is admin only
  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'Only an admin can archive or restore a tenant.';
  end if;

  return new;
end;
$$;

drop trigger if exists tenants_enforce_permissions on public.tenants;
create trigger tenants_enforce_permissions
  before update on public.tenants
  for each row execute function public.enforce_tenant_permissions();

-- ----------------------------------------------------------------------------
-- payments: non-admins may edit a payment but not archive/restore it
-- (matches the existing rule that deleting payments is admin only)
-- ----------------------------------------------------------------------------
create or replace function public.enforce_payment_permissions()
returns trigger
language plpgsql
as $$
begin
  if not public.is_admin()
     and new.deleted_at is distinct from old.deleted_at then
    raise exception 'Only an admin can archive or restore a payment.';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_enforce_permissions on public.payments;
create trigger payments_enforce_permissions
  before update on public.payments
  for each row execute function public.enforce_payment_permissions();
