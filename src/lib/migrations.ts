// The database migrations this build of the app expects to have been applied.
// The app compares this list against the schema_migrations table on launch and
// warns an admin if any are missing, so a feature never fails silently against
// an out-of-date schema.
//
// WHEN YOU ADD A MIGRATION: add its version here AND make the migration's SQL
// end with `insert into public.schema_migrations (version) values ('NNN') on
// conflict do nothing;` — the two must stay in lockstep or this check will
// report false positives/negatives. Migration 016 introduced the registry, so
// the check only becomes meaningful once 016 has been run.
export const EXPECTED_MIGRATIONS = [
  '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012',
  '013', '014', '015', '016', '017',
] as const
