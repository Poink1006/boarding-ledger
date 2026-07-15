-- Payment instructions (e.g. GCash number, bank details) shown to tenants in
-- rent-reminder messages so they know where to send money. Free text, edited in
-- Settings > Organization alongside the other business header details.

alter table public.app_settings add column if not exists payment_instructions text;
