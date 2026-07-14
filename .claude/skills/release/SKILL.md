---
name: release
description: >-
  Publish a new version of the Victoria Residence desktop app to GitHub Releases
  so installed copies auto-update. Use this whenever the user asks to "release",
  "publish", "ship", "push a new version", "bump the version", "put out an
  update", or otherwise get changes onto their downloaded app. It handles the
  full flow — version bump, commit, build, publish with the GitHub token, and
  the checks that have bitten this project before (draft releases, missing
  token, un-run migrations). Prefer this over running the raw npm/electron
  commands by hand, because the manual path has repeatedly failed in ways this
  skill guards against.
---

# Release a new version

This app auto-updates via `electron-updater` + GitHub Releases
(`Poink1006/boarding-ledger`, public). When you publish a release, every
installed copy detects it on next launch and shows the in-app update banner.
Getting a release wrong (draft, missing asset, wrong token) means users silently
never get the update — so the checks below matter more than the happy path.

## Before you start — decide the version

Ask the user what to bump to if they didn't say. Versions are `0.1.x`; the
convention here is a patch bump per user-visible change (0.1.4 → 0.1.5). The
version lives in `package.json` (`"version"`), and `npm run electron:release`
derives the git tag `vX.Y.Z` and the release from it.

## Steps

### 1. Confirm the working tree is in the state you want to ship
```bash
git status --short
```
Everything the user wants in this release must already be committed (or commit
it now). The build ships whatever is on disk; the release tag will point at the
resulting commit. If there are unrelated uncommitted changes, stop and ask.

### 2. Bump the version
Edit `package.json` → `"version"`. This is the single source of truth — the
installer filename, git tag, and update feed all derive from it. Don't tag or
name anything manually.

### 3. Typecheck (this repo's only check)
```bash
npm run build
```
`npm run build` runs `tsc -b && vite build` — there is no separate
typecheck/lint/test. `electron:release` runs this again, but doing it now
catches a type error before you spend minutes packaging. If it fails, fix it
before releasing — a broken build must never be published.

### 4. Commit the bump and push
```bash
git add package.json
git commit -F <message-file>   # message: "Bump version to X.Y.Z" + the Co-Authored-By trailer
git push origin master
```
Commit with `-F <file>` (or a heredoc), never inline `-m` with apostrophes —
commit messages in this project have broken on apostrophes before. Push to
`master`; the release tag is created off the pushed commit.

### 5. Build and publish with the GitHub token
The installed `gh` CLI does **not** support `gh auth token`, so read the stored
OAuth token inline without printing it, and pass it as `GH_TOKEN`:
```bash
GH_TOKEN=$(grep -m1 'oauth_token:' "$APPDATA/GitHub CLI/hosts.yml" | sed 's/.*oauth_token:[[:space:]]*//') npm run electron:release
```
This builds the renderer + Electron, packages the NSIS installer, and uploads
the installer `.exe`, `latest.yml`, and `.exe.blockmap` to a new GitHub release.
`latest.yml` is what `electron-updater` reads to detect the update; the
`.blockmap` enables differential downloads. All three must be present or
auto-update won't work. Packaging takes a few minutes — let it finish.

### 6. Verify the release is live and NOT a draft
```bash
GH_TOKEN=$(grep -m1 'oauth_token:' "$APPDATA/GitHub CLI/hosts.yml" | sed 's/.*oauth_token:[[:space:]]*//') gh release view vX.Y.Z --repo Poink1006/boarding-ledger --json tagName,isDraft,assets
```
This is the check that matters most. An early release once shipped as a **draft**
(electron-builder's old default), which `electron-updater` cannot see, so no one
got the update. Confirm `isDraft: false` and that `assets` includes the `.exe`,
`latest.yml`, and `.blockmap`. `package.json`'s `releaseType: release` should
publish live, but verify every time. If it did publish as a draft, un-draft it:
```bash
GH_TOKEN=... gh release edit vX.Y.Z --repo Poink1006/boarding-ledger --draft=false
```

## After publishing — remind about migrations

Database migrations in `supabase/migrations/` are **run manually by the operator
in the Supabase SQL editor** — publishing the app does not run them. If this
release depends on a migration that may not be run yet (the most recent
un-confirmed one has been `013_receipts_org_info.sql`), tell the user explicitly
that the new feature won't work until they run that SQL. A released app pointing
at a schema that's missing a column fails silently for the user.

## Report back

Tell the user: the version published, that it's live (not a draft), which assets
uploaded, and that installed copies will update on next launch — plus any
migration reminder from the step above.
