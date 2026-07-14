# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Victoria Residence** (package name `boarding-ledger`) — a desktop app for managing a dormitory / boarding house (~8 apartments, 34+ rooms). Electron shell + Vite/React/TypeScript renderer + Supabase (Postgres, Auth, RLS) backend. The primary user is a non-technical operator with trusted staff; two roles exist: **admin** and regular **user**.

## Commands

```bash
npm run dev              # Vite dev server + Electron (hot reload) — port 5173
npm run build            # tsc -b && vite build  (also the typecheck — there is no separate typecheck/lint/test script)
npm run electron:build   # build + package installer locally (no publish)
npm run electron:release # build + package + publish to GitHub Releases (needs GH_TOKEN)
```

- **Typecheck = `npm run build`** (`tsc -b`). There is no test suite, linter, or standalone typecheck command.
- **Publishing a release** requires a GitHub token. `gh auth token` is not available in the installed gh version — read the token inline without printing it:
  ```bash
  GH_TOKEN=$(grep -m1 'oauth_token:' "$APPDATA/GitHub CLI/hosts.yml" | sed 's/.*oauth_token:[[:space:]]*//') npm run electron:release
  ```
- After publishing, confirm the GitHub release is **not a draft** (`gh release view vX.Y.Z --json isDraft`). `releaseType: release` in package.json should publish live, but verify.
- Windows LF→CRLF git warnings in this repo are normal/benign.

## Release flow (repeated often)

1. Bump `version` in `package.json`.
2. Commit + push to `master`.
3. `npm run electron:release` with the inline `GH_TOKEN` (above).
4. Verify the release isn't a draft; assets should include the installer `.exe`, `latest.yml`, and `.blockmap`.

Auto-update is wired via `electron-updater` + GitHub Releases (`Poink1006/boarding-ledger`, public repo so the client needs no embedded token). `electron/main.ts` checks for updates on launch and pushes `update:available` / `update:downloaded` IPC events to the renderer; `UpdateBanner.tsx` shows an in-app banner and sends `update:restart` back to install. Only packaged builds auto-update (`app.isPackaged` guard).

## Architecture

### Layers
- **`electron/main.ts`** — window (fullscreen, brand icon/title), auto-updater, IPC. **`electron/preload.ts`** exposes `onUpdateAvailable`/`onUpdateDownloaded`/`restartToUpdate` to the renderer. Vite bundles both via `vite-plugin-electron/simple` into `dist-electron/`.
- **Renderer** — React Router SPA. `App.tsx` wires providers (`ToastProvider` → `AuthProvider`) and routes. `ProtectedRoute` gates auth; `AdminRoute` gates `/settings` to admins.
- **`src/lib/supabase.ts`** — the single Supabase client, typed by `database.types.ts`. Reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from `.env` (git-ignored; only the public anon key ships — never the service_role key).

### Permission model — read before touching anything role-related
**RLS + Postgres triggers are the real enforcement; the UI only mirrors it.** Do not rely on hiding a button to protect data.
- `AuthContext` exposes `isAdmin`, `isRealAdmin`, and a **UI-only** `viewingAsUser` toggle that lets an admin preview the user experience (`isAdmin = isRealAdmin && !viewingAsUser`). This does not change the real role or RLS.
- `is_admin()` is a security-definer SQL helper. `BEFORE UPDATE` triggers (`enforce_tenant_permissions`, `enforce_payment_permissions`, migration `012`) block non-admins from changing tenant identity (name/number), `custom_rate_per_pax`, `monthly_rate` (except as part of a room move), an existing `deposit_amount`, and `deleted_at` (archive/restore). Any UI change to these rules must be matched in the trigger, or the app and DB will disagree.
- Auto-logout after 30 min of inactivity (shared front-desk machine) lives in `AuthContext`.
- Deletes are **soft** (`deleted_at` timestamp); all list queries filter `.is('deleted_at', null)`. Never hard-delete tenants/payments.

### Balance ledger — the money core (`src/lib/balance.ts`)
This is the highest-risk code. `computeTenantBalance()` is recomputed fresh on every page load — **there is no scheduled billing job**.
- **Rent and utilities are independent pools.** A rent payment never covers a utility charge or vice versa. Payments carry `payment_type` (`'rent'` | `'utility'`); balances are computed separately (`rentBalance`, `utilityBalance`).
- **Balance = a running number.** Payments are top-up transactions; the balance is `paid − due`. Positive = credit, negative = owed.
- **Rent billing cycles** anchor to the tenant's `move_in_date` (move-in, +1mo, +2mo…). A cycle is "billed" once its anchor date arrives. The per-cycle rate comes from `tenant_rate_changes` history (`rateForCycle`) — **rates are grandfathered**: an existing tenant's rate only re-syncs on a room Move, never retroactively. Tenants with no rate history fall back to flat `tenant.monthly_rate`.
- **Utilities** — each apartment's water/electricity bill beyond `(allowance_per_tenant × current headcount)` is split evenly among current occupants and added to what each owes (`computeUtilityShares`). Uses the *current* roster as a simplification (bills assumed entered soon after their month).
- Payments are FIFO-allocated (oldest first) across cycles / utility charges **only for the monthly breakdown display** (`cycles`, `utilityCharges`); the underlying balance is still one sum.
- A tenant with enough credit for a month auto-activates (no manual "Activate" button).

### Data model quirks
- **Tenant numbers**: `YY-NNN` (2-digit year + running count within that year, e.g. `26-001`). Generated in `Tenants.tsx` (`previewTenantNumber` / insert-with-retry).
- **Tenant status** (`tenantStatus.ts`): `pending` (labeled "Reserved"), `active`, `inactive` ("Moved out"). `occupiesBed()` — pending and active both hold their bed; only inactive frees it.
- **Room rate priority**: room price group → room base rate; a per-tenant `custom_rate_per_pax` override (admin-only) supersedes for that tenant. (Override moved from room-level to tenant-level; see migrations 010.)
- Dates use local getters, never `toISOString()`, to avoid timezone drift (`src/lib/format.ts`).

### Documents / printing
- Receipts and statements render as HTML (`src/components/documents.tsx`), shown in `PrintModal.tsx`, printed via `window.print()` scoped by `@media print` to `.doc-sheet`.
- Statements are **per-type** (a Rent statement and a Utility statement are separate documents), each a **per-month** breakdown, not a summary.
- Receipt numbers come from a Postgres sequence (`receipt_seq`) via migration `013`.

## Database migrations

`supabase/migrations/*.sql` are **run manually by the operator in the Supabase SQL editor** — there is no automated migration runner. When adding a migration:
- A feature that needs a migration will not work until the operator runs it. Always call out an un-run migration explicitly.
- Verify a migration ran by checking column existence via the anon client (a select that returns empty + no error means the column exists).
- `database.types.ts` is hand-maintained to match — update it alongside any schema change.

## Conventions
- Client-side caching: `src/lib/cache.ts` (`getCached`/`setCached`/`hasCached`) with `Skeleton*` components for loading states.
- Tabs come in two styles: `.tab-bar-segmented` (segmented control) and `.tab-bar` (underline).
- Dropdowns use the portal-based `ActionMenu` (fixed position, viewport-clamped) so they aren't clipped by table rows.
- Design tokens and all component styling live in `src/styles/global.css`; `.btn-ghost` needs light-on-dark overrides wherever it sits on a dark surface (sidebar, print toolbar).
