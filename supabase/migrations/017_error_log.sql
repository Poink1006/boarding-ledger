-- Error log: a record of runtime errors the app hits (render crashes, uncaught
-- exceptions, unhandled promise rejections), so the owner can actually see when
-- something broke for a staff member instead of hearing "it stopped working"
-- with no detail. Written best-effort by the client; read only by admins.

create table if not exists public.error_log (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  stack text,
  context text,             -- where it came from: render / window.onerror / etc.
  user_id uuid,             -- auth.uid() at the time, if signed in
  user_name text,           -- their profile name, denormalized so it survives
  created_at timestamptz not null default now()
);

create index error_log_created_at_idx on public.error_log(created_at desc);

alter table public.error_log enable row level security;

-- any signed-in client may record an error; only admins may read them; there is
-- no update/delete policy, so entries can't be altered through the API
create policy "error_log_insert_any_authenticated"
  on public.error_log for insert to authenticated with check (true);
create policy "error_log_select_admin_only"
  on public.error_log for select to authenticated using (public.is_admin());

insert into public.schema_migrations (version) values ('017') on conflict do nothing;
