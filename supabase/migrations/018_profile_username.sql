-- Username-based login. Supabase Auth is email-based, so each account is given
-- an internal "synthetic" email (username@victoria.local); staff only ever type
-- their username, and the app maps it to that address behind the scenes. The
-- username is stored on the profile so admins can see and manage it.
--
-- REQUIRES "Confirm email" to be OFF in the project's auth settings
-- (Authentication -> Providers -> Email), since the synthetic domain can't
-- receive a confirmation message. Existing email logins keep working — anything
-- the user types that contains "@" is treated as a real email.

alter table public.profiles add column if not exists username text unique;

-- extend the signup trigger to also store the username passed in signup metadata
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'username'
  );
  return new;
end;
$$;

insert into public.schema_migrations (version) values ('018') on conflict do nothing;
