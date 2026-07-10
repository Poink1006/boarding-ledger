-- Per-tenant utility allowance: each tenant's rent is assumed to cover up to
-- this much electricity/water usage. If an apartment's actual utility bill
-- exceeds (allowance * current occupant count), the excess is split evenly
-- across the apartment's current occupants and added to what each owes
-- (see src/lib/balance.ts).

alter table public.app_settings
  add column electricity_allowance_per_tenant numeric(10,2) not null default 500,
  add column water_allowance_per_tenant numeric(10,2) not null default 200;
