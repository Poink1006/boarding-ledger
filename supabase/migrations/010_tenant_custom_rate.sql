-- Move the "custom rate override" from the room level to the tenant level.
-- Before: a room could carry custom_rate_per_pax, which flowed down to every
-- tenant assigned there. Now each tenant can carry their own override, so one
-- person can get a special rate without repricing the whole room.

-- 1. new per-tenant override column. null = follow the room's group/default
--    rate (grandfathered via monthly_rate + tenant_rate_changes, as before).
alter table public.tenants
  add column if not exists custom_rate_per_pax numeric(10,2);

-- 2. preserve existing room overrides: copy each room's custom rate onto the
--    tenants currently occupying it, so their override intent survives. Their
--    monthly_rate already equals this value (it was snapshotted at move-in),
--    so nobody's actual rate changes.
update public.tenants t
set custom_rate_per_pax = r.custom_rate_per_pax
from public.rooms r
where t.room_id = r.id
  and r.custom_rate_per_pax is not null
  and t.status <> 'inactive';

-- 3. rooms.custom_rate_per_pax is now unused by the app (kept, not dropped, to
--    avoid a destructive change on live data). Room pricing is group/default
--    only going forward.
