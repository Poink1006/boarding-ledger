-- Security/damage deposit tracking, kept fully separate from the rent
-- balance ledger (payments table) — it's collateral, not rent.
--
-- Lifecycle: unpaid -> held -> refunded. "refunded" covers full, partial,
-- or zero return — deposit_returned_amount + deposit_notes capture any
-- deduction for damages rather than needing a separate "forfeited" state.

alter table public.tenants
  add column deposit_amount numeric(10,2) not null default 0,
  add column deposit_status text not null default 'unpaid' check (deposit_status in ('unpaid', 'held', 'refunded')),
  add column deposit_collected_date date,
  add column deposit_returned_amount numeric(10,2),
  add column deposit_returned_date date,
  add column deposit_notes text;
