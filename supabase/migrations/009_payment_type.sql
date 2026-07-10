-- Splits rent payments from utility payments so a tenant's rent top-up
-- pool and utility-overage pool are tracked independently instead of one
-- combined ledger. Existing rows default to 'rent' — utility billing didn't
-- exist as a payable charge until now, so all historical payments were rent.

alter table public.payments
  add column payment_type text not null default 'rent' check (payment_type in ('rent', 'utility'));
