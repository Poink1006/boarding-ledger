-- Room pricing groups: a named shared+private rate pair that can be applied
-- to many rooms at once (e.g. "Apt 1-6 · Rooms A/B"), instead of setting
-- custom_rate_per_pax on each room individually. Priority when resolving a
-- room's effective rate: custom_rate_per_pax > price group > global default
-- (see src/lib/rooms.ts effectiveRate()).

create table public.room_price_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shared_rate_per_pax numeric(10,2) not null,
  private_rate_per_pax numeric(10,2) not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.room_price_groups enable row level security;

create policy "room_price_groups_select_all"
  on public.room_price_groups for select to authenticated using (true);

create policy "room_price_groups_write_admin_only"
  on public.room_price_groups for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create trigger room_price_groups_set_updated_at before update on public.room_price_groups
  for each row execute function public.set_updated_at();

alter table public.rooms
  add column price_group_id uuid references public.room_price_groups(id) on delete set null;

-- unused (never queried by the app) and would now be stale since it doesn't
-- know about price groups — dropping it rather than maintaining dead code
drop view if exists public.room_pricing;
