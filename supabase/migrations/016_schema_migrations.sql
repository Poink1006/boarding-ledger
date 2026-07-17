-- A registry of which migrations have been applied, so the app can detect a
-- database that's behind the code and tell the operator to run the missing SQL
-- — instead of a new feature failing silently against an old schema.
--
-- The app bundles the list of migrations it expects (src/lib/migrations.ts) and
-- compares it against the rows here on launch. EVERY future migration must end
-- with an insert of its own version (see the last line of this file for the
-- pattern), or the app will keep reporting it as missing.

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

alter table public.schema_migrations enable row level security;

-- readable by any signed-in user (the launch check); no write policy, so the
-- table can only be changed from the SQL editor when running a migration
create policy "schema_migrations_select_all"
  on public.schema_migrations for select to authenticated using (true);

-- backfill everything applied up to and including this migration
insert into public.schema_migrations (version) values
  ('002'), ('003'), ('004'), ('005'), ('006'), ('007'), ('008'), ('009'),
  ('010'), ('011'), ('012'), ('013'), ('014'), ('015'), ('016')
on conflict (version) do nothing;
