-- Receipts + statements of account. Adds editable organization header info
-- and a stable, gapless-ish sequential receipt number per payment.

-- ----------------------------------------------------------------------------
-- editable header details that print on every receipt / statement
-- ----------------------------------------------------------------------------
alter table public.app_settings add column if not exists business_name text not null default 'Victoria Residence';
alter table public.app_settings add column if not exists business_address text;
alter table public.app_settings add column if not exists business_contact text;

-- ----------------------------------------------------------------------------
-- receipt numbers: a never-resetting sequence, assigned when a payment is
-- created and stored on the row so reprints always show the same number.
-- ----------------------------------------------------------------------------
create sequence if not exists public.receipt_seq;

alter table public.payments
  add column if not exists receipt_no bigint;

-- backfill existing payments in creation order so they each get a number
do $$
declare
  r record;
begin
  for r in select id from public.payments where receipt_no is null order by created_at, id loop
    update public.payments set receipt_no = nextval('public.receipt_seq') where id = r.id;
  end loop;
end $$;

-- new payments get the next number automatically
alter table public.payments
  alter column receipt_no set default nextval('public.receipt_seq');
