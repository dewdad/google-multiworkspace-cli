# Plan: Install & Bootstrap Fixes

## Status: Implemented

> **All 11 issues resolved.** Issues 2–10 landed in commit `7f43324` (full
> code/docs sweep). Issue 11 (`package.json` upstream attribution) shipped
> earlier in `4e848e3`. Issue 1 was the open release-decision item; we picked
> **Option B (GitHub install)** — `npm install -g
> github:dewdad/google-multiworkspace-cli` — and a `prepare: tsc` script in
> `package.json` so the install builds `dist/` automatically. Switching to the
> npm registry (Option A) is still on the table later; the install string is
> the only thing that needs to change.

## Context

This plan captures every defect / friction point uncovered while installing the
`google-workspace` skill from `dewdad/google-multiworkspace-cli` via `skillshare`
on a clean Windows host (PowerShell 7) and bootstrapping three personal Google
accounts (`avitalbennatan`, `avitalidit`, `haavital`) end-to-end.

End state achieved despite the issues:

- skill installed (tracked) → synced to opencode
- `gwcli` 2.1.0 + `gws` 0.22.5 on PATH
- 1 OAuth client (`gws-cli`, Desktop) in GCP project `automated-project-470321`
- 3 authenticated profiles, gmail + calendar API smoke-tested per profile

The session's takeaway: **the documented bootstrap path in `skill/SKILL.md` does
not run cleanly without operator intervention**. Most issues are 1–10 line fixes;
two (TUI hang, npm publish) need design decisions.

## Goals

1. A user (or AI agent) following `SKILL.md` step-by-step **must succeed** without
   trial-and-error, on Windows / macOS / Linux.
2. The bootstrap must work in **non-TTY** environments (CI, agent automation,
   `Start-Process`-style spawns).
3. After auth, `profiles list` / `profiles status` must reflect actual identity
   (email) without an extra API call.
4. Failure paths leave **no orphaned state** (profiles, secrets, processes).

## Non-Goals

- Re-implementing Keep on consumer accounts (Google's server-side gate; not fixable here).
- Rewriting `gws` upstream behavior (e.g. removing the TUI picker). We adapt around it.
- Migrating credential storage to OS keyrings beyond what `gws` already supports.

## Issue Inventory

| #   | Issue                                                              | Severity | Effort | Layer        |
|-----|--------------------------------------------------------------------|----------|--------|--------------|
| 1   | `npm install -g google-workspace-cli` returns 404 (not published)  | **HIGH** | M      | publish/docs |
| 2   | `gwcli profiles auth` hangs in non-TTY (TUI stdin)                 | **HIGH** | M      | gwcli        |
| 3   | `gwcli profiles add` half-commits on OAuth failure                 | Med      | S      | gwcli        |
| 4   | `gwcli agenda --days N` passes deprecated `--fields` → `gws` 400   | Med      | S      | gwcli        |
| 5   | `gwcli calendar events list` deprecated but still in `SKILL.md`    | Med      | S      | docs         |
| 6   | OAuth `client_secret` JSON download is single-shot, automation-hostile | Med  | M      | docs/wrapper |
| 7   | `profiles list` / `status` show `email: null` after auth           | Med      | S      | gwcli        |
| 8   | `keep` scope granted by default, but API 403s on all `@gmail.com`  | Low      | S      | gwcli        |
| 9   | `profiles status` JSON schema diverges from `profiles list`        | Low      | S      | gwcli        |
| 10  | `profiles add` dotted-name error has no remediation hint           | Low      | XS     | gwcli        |
| 11  | `package.json` `homepage` / `repository.url` point to upstream     | Low      | XS     | meta         |

Severities: **HIGH** = blocks a fresh install entirely · Med = blocks a documented
flow / requires manual workaround · Low = surface UX / diagnostics.
Effort: XS ≤ 15 min · S ≤ 1 h · M ≤ half-day · L > half-day.

---

## Issue 1 — `npm install -g google-workspace-cli` is 404

**Severity:** HIGH. First gate in [`skill/SKILL.md` Step 0a](../../skill/SKILL.md#step-0a---first-time-install-only-if-gwcli-is-not-on-path).

**Repro (clean machine):**
```powershell
npm install -g google-workspace-cli
# npm error 404 Not Found - GET https://registry.npmjs.org/google-workspace-cli
```

**Root cause:** `package.json` declares `"name": "google-workspace-cli"` but the
package is not published to the npm registry. `gwcli setup` separately verifies
`@googleworkspace/cli` (the *gws* binary, npm-named differently) and succeeds —
but `gwcli` itself has no install vector for outsiders.

**Fix options (pick one — A is recommended):**

- **A. Publish to npm under a unique name.**
  - Rename to `@dewdad/google-workspace-cli` (scoped) or `gwcli-multiprofile`.
  - Add `"publishConfig": { "access": "public" }`.
  - Wire a `release` GitHub Action (see PR breakdown below).
  - Update `SKILL.md` step 0a accordingly.
- **B. Install from GitHub directly.** Replace `SKILL.md` step 0a with:
  ```bash
  npm install -g github:dewdad/google-multiworkspace-cli
  ```
  Cheaper but slower (no semver, no audit).
- **C. Ship via `skillshare extras` as a hosted binary.** Heaviest; only worth it
  if we want to drop the npm dependency entirely.

**Verification:** `npm install -g <chosen>` from a clean shell produces
`gwcli` on PATH; `gwcli --version` prints `2.1.0` (or current).

---

## Issue 2 — `gwcli profiles auth` hangs in non-TTY

**Severity:** HIGH. Root cause of three failed attempts during this session and
the reason we had to spawn visible `cmd.exe` windows from PowerShell.

**Repro:**
```powershell
# Hangs forever:
$env:STDIN_REDIRECTED = '1'
Start-Process gwcli -ArgumentList 'profiles','auth','avitalbennatan' `
  -RedirectStandardOutput out.log -RedirectStandardError err.log -Wait
```
Stdout shows the gws "Select OAuth scopes" TUI (9/9 selected, ↑↓/Space/a/Enter
keybindings) being rendered into the captured pipe — never advances past Enter.

**Root cause:** `gwcli profiles auth` shells out to `gws auth login` without
passing `--scopes` (or `--full`). `gws` then renders an interactive ratatui-style
scope picker and reads keystrokes from the controlling TTY. With redirected
stdin there is no keystroke source, so the picker waits indefinitely.

`gwcli profiles add` does NOT trigger this because the create flow stores the
chosen scopes and passes them through — re-auth re-prompts.

**Fix:**

1. **Primary:** in the `auth` command, read the profile's stored
   `scopes` array and pass it explicitly as `gws auth login --scopes <csv>`.
   This bypasses the picker entirely. (gws's `--scopes` accepts the same names
   already used in `gwcli`'s default scopes list.)
2. **Defensive:** detect non-TTY (`!stdin.isTTY` in Node) and refuse to invoke
   the picker — print a clear error pointing to `gwcli profiles auth <name>
   --scopes ...` instead.
3. **Docs:** add a `references/troubleshooting.md` entry documenting the "visible
   terminal window" workaround for environments where (1) cannot be applied
   (e.g. an old gws version with no `--scopes` support).

**Verification:**
```powershell
# Must complete (browser opens, user authenticates) without hanging
echo "" | gwcli profiles auth avitalbennatan
# Or in CI:
gwcli profiles auth avitalbennatan --scopes gmail,calendar,drive,docs,sheets,tasks
```

---

## Issue 3 — `profiles add` half-commits on auth failure

**Severity:** Med. Caused user-visible "already exists" loops in our session.

**Repro:**
```powershell
gwcli profiles add p1 --client client.json
# (timeout / browser closed before consenting)
gwcli profiles add p1 --client client.json
# Error: Profile 'p1' already exists.
```
The profile directory + `client_secret.json` are created **before** the OAuth
callback is awaited. On failure the directory persists; the user must
`profiles remove --force` and retry.

**Fix:** make `add` transactional.

```ts
// src/commands/profiles.ts (sketch)
async function addProfile(name, opts) {
  const tmpDir = mkdtempSync(...)
  try {
    await scaffoldProfile(tmpDir, opts)
    if (!opts.noAuth) await runAuth(tmpDir, opts.scopes)
    renameSync(tmpDir, finalProfileDir(name))
  } catch (e) {
    rmSync(tmpDir, { recursive: true, force: true })
    throw e
  }
}
```

**Alternative (lighter):** keep current behavior, but if `add` fails after
scaffolding, prompt:
```
OAuth failed. Keep partial profile 'p1' for retry with `gwcli profiles auth p1`?
[y/N]
```
With `-y` flag for non-interactive. Roll back on `N`.

**Verification:** abort an OAuth flow mid-way → `profiles list` returns `[]`.

---

## Issue 4 — `gwcli agenda --days N` 400s with `--fields`

**Severity:** Med. Top-level alias is broken; only the longer
`gwcli calendar +agenda` path works.

**Repro:**
```powershell
gwcli --profile avitalbennatan agenda --days 7
# "error: unexpected argument '--fields' found"
```

**Root cause:** the wrapper for the top-level `agenda` command builds a `gws
events list --fields ...` call. `gws` 0.22.5 removed/renamed `--fields`; the
nested `gwcli calendar +agenda` helper uses the up-to-date flags.

**Fix:**

1. Locate the wrapper (likely `src/commands/agenda.ts` or referenced from
   `src/index.ts`).
2. Either drop `--fields` (fields can be filtered post-response in JS) or
   rename to whatever replaced it in `gws` 0.22.x. Verify against `gws events
   list --help`.
3. Add a unit test that asserts the constructed argv doesn't include any flags
   `gws --help` doesn't recognize.

**Verification:** `gwcli --profile <p> agenda --days 7` returns the same JSON
shape as `gwcli --profile <p> calendar +agenda --days 7` for all three test
profiles.

---

## Issue 5 — `gwcli calendar events list` deprecation message in `SKILL.md`

**Severity:** Med. Agents copy/paste from `SKILL.md` and immediately get a
deprecation warning, eroding trust.

**Repro:** the example in [`SKILL.md` line 99](../../skill/SKILL.md#calendar):
```bash
gwcli calendar events list --params '{"calendarId":"primary",...}'
```
emits:
```
⚠ Deprecated syntax: 'gwcli calendar events' → use native gws syntax.
  New: gwcli calendar +agenda --days 7
```

**Fix:**

1. Update `skill/SKILL.md` Calendar examples to either:
   - the `+agenda` helper for read flows, or
   - the canonical `gwcli --profile <p> calendar events list --params ...` form
     **without** the deprecated nesting (verify which form survives).
2. Apply the same scrub to `skill/references/calendar.md`.
3. If the wrapper is intentional (just renamed), remove the deprecation warning.

**Verification:** every command block in `SKILL.md` and `references/*.md` runs
without a `Deprecated` banner against `gwcli` 2.1.0 + `gws` 0.22.5.

---

## Issue 6 — `client_secret` JSON capture is hostile to automation

**Severity:** Med. Once-per-user, but high friction when it bites.

**Observation:** Google deprecated post-creation viewing/downloading of OAuth
client secrets. The secret is *only* available:

- in the modal dialog immediately after **Create OAuth client ID** (single
  Download JSON button, no fallback), or
- in the **Add client secret** dialog (with a leaked accessibility label that
  exposes the secret in the DOM — what we used).

Playwright (and most headless automations) intercept downloads via the
`download` event; without an explicit `accept_downloads` + `path` hookup the
file never lands on disk. Operators end up creating a second secret to capture
one and orphaning the first (which we did this session — `****pwGs`).

**Fix options:**

- **A. Document explicitly.** Add a `references/oauth-bootstrap.md` that walks
  through Cloud Console manually with screenshots, and warns that automated
  browsers will silently swallow the download. Best ROI.
- **B. Ship a `gwcli setup --create-client` that uses `gcloud`.** Detects
  `gcloud` on PATH; if present, runs `gcloud iap oauth-clients create ...` (or
  the Apps Script API equivalent), pulls the JSON via `gcloud secrets`, and
  feeds it directly into `profiles add`. Heaviest path; high value for
  Workspace admins.
- **C. Add a `gwcli profiles bootstrap` interactive helper** that opens the
  Cloud Console URL, polls for the client to appear in the user's project, and
  prompts the user to paste `client_id` + `client_secret` if they have them.

**Verification:** an external user can complete the OAuth client step in <10
minutes from a cold start, without making the same orphan-secret mistake we
did.

---

## Issue 7 — `email: null` in `profiles list` / `profiles status`

**Severity:** Med. Operators can't tell which Google identity is bound to which
profile without making an API call.

**Repro:**
```bash
gwcli profiles list --format json
# every entry has "email": null even when authenticated
```
Yet `gwcli --profile <p> gmail users getProfile --params '{"userId":"me"}'`
returns the email immediately — the token works.

**Fix:** in `src/profiles/config.ts` (or wherever profile metadata is
serialized), after a successful `auth login`:

1. Call `userinfo.get` (the `openid email profile` scopes are already granted
   per the URL we observed: `…&scope=…openid…userinfo.email…`).
2. Persist `email` and (optionally) `displayName` to the profile metadata.
3. Lazily refresh on `profiles status` if `email` is null and the profile is
   authenticated (cheap one-off backfill).

**Verification:** post-auth, `profiles list --format json | jq '.[].email'`
returns the matching `@gmail.com` for each of the three test profiles.

---

## Issue 8 — `keep` scope granted by default but always 403s on `@gmail.com`

**Severity:** Low (documented in `references/keep.md`) but confusing in practice.

**Behavior:** the default `--scopes` list in `profiles add` is
`gmail,calendar,drive,docs,sheets,keep,tasks`. Consumer accounts authorize the
`keep` scope happily; every API call returns:

```json
{ "error": { "code": 403, "message": "Request had insufficient authentication scopes." } }
```

**Fix options:**

- **A. Conditionally drop `keep`.** After fetching `userinfo.hd` (the hosted-
  domain field — present on Workspace, absent on `@gmail.com`), if missing,
  silently exclude `keep` from the scope set and emit a warning.
- **B. Pre-flight every `gwcli keep …` call.** Detect `hd` on first use; if
  absent, return a clear error that links to
  [`references/keep.md`](../../skill/references/keep.md).
- **C. Change default scope list to exclude `keep`.** Users on Workspace add it
  explicitly with `--scopes gmail,calendar,…,keep`.

**Recommendation:** A + B in tandem. A cleans the consent screen for personal
users; B catches users who explicitly opt in but still on `@gmail.com`.

**Verification:** OAuth consent screen for an `@gmail.com` profile no longer
asks for the Keep scope; `gwcli keep notes list` returns a friendly diagnostic,
not a raw 403.

---

## Issue 9 — `profiles status` JSON schema diverges from `profiles list`

**Severity:** Low. Functional but inconsistent.

```jsonc
// profiles list --format json
[ { "name": "p", "email": null, "authenticated": true, ... } ]

// profiles status --format json (no name)
{ "profiles": [...], "allAuthenticated": true, "count": 3 }

// profiles status <name> --format json
{ "profile": "p", "status": { "auth_method": "...", "client_config": "...", ... } }
```

Three different shapes for the same conceptual entity.

**Fix:** pick one shape and align all three commands. Recommended:

```jsonc
{ "profile": "p", "email": "...", "authenticated": true, "isDefault": false,
  "scopes": [...], "lastUsed": "...", "details": { /* auth_method, paths, ... */ } }
```

`list` returns an array of these. `status` returns the same shape filtered by
name (or by `--filter authenticated=false`).

**Verification:** `jq` queries that work on `list` work on `status`.

---

## Issue 10 — Dotted profile names: error message lacks remediation

**Severity:** Trivial.

```
Error: Invalid profile name 'avital.bennatan'.
Profile names must: start with a lowercase letter, contain only lowercase
letters/digits/hyphens, and be 1-63 characters.
```

**Fix:** suggest a sanitized alternative in the message:

```
Error: Invalid profile name 'avital.bennatan'.
       Try `--name avital-bennatan` (dots → hyphens).
       Rules: lowercase letter start, [a-z0-9-]{1,63}.
```

---

## Issue 11 — `package.json` points to upstream

**Severity:** Trivial / cosmetic.

```jsonc
"author": "Ian Hines",
"repository": { "url": "https://github.com/ianpatrickhines/google-workspace-cli.git" },
// SKILL.md:  homepage: "https://github.com/ianpatrickhines/google-workspace-cli"
```

This is a fork (`dewdad/google-multiworkspace-cli`). `gwcli setup` reads
`homepage` for "check for updates" links.

**Fix:** update both files to point at this fork (or to a vendor-neutral name
once the rename in Issue 1 lands). Keep `author` in `contributors[]` for credit.

---

## Suggested PR breakdown

To keep changes reviewable and revert-friendly:

| PR | Issues | Theme | Approx LOC |
|----|--------|-------|-----------:|
| 1 | 4, 5, 10, 11 | "low-risk doc + flag scrubs" | ~80 |
| 2 | 7, 9 | profile metadata: persist email, unify schemas | ~150 |
| 3 | 2 | non-TTY auth: pass `--scopes` + TTY guard | ~120 |
| 4 | 3 | transactional `profiles add` rollback | ~80 |
| 5 | 8 | conditional `keep` scope + helpful 403 handling | ~100 |
| 6 | 6 | `references/oauth-bootstrap.md` (manual) | docs only |
| 7 | 1 | npm publish + `SKILL.md` step 0a rewrite | infra + docs |

PR 1 should land first — it is pure docs/string changes and unblocks copy-paste
flows for new users immediately.

PRs 2–5 are independent and can land in parallel.

PR 6 is purely additive docs.

PR 7 is the highest-impact but needs a publishing decision (scoped npm vs
GitHub install vs hosted binary).

## Verification matrix (after all PRs land)

A clean Windows / macOS / Linux host without `gwcli`, `gws`, or any GCP project,
following only `skill/SKILL.md` verbatim, must be able to:

- [ ] Install `gwcli` (Issue 1)
- [ ] Run `gwcli setup` to acquire `gws` (no change)
- [ ] Bootstrap an OAuth client without losing the secret (Issue 6 docs)
- [ ] `gwcli profiles add p --client …` for 1+ profiles, **including in CI/non-TTY** (Issues 2, 3)
- [ ] See real `email` in `profiles list` / `status` immediately (Issue 7, 9)
- [ ] Run `gwcli --profile p agenda --days 7` (Issue 4) and every command in
      `SKILL.md` without deprecation warnings (Issue 5)
- [ ] Avoid the Keep scope on consumer accounts; receive a clear diagnostic if
      they hit it (Issue 8)
- [ ] Get a remediation hint when picking a bad profile name (Issue 10)
- [ ] See correct fork attribution in `--version` / `--help` output (Issue 11)

## Out of scope / future work

- **Keep on consumer accounts** is not solvable here (Google's server-side
  gate). The skill could optionally drive `keep.google.com` via Playwright as a
  scraping fallback, but that's a separate "consumer-keep-scrape" plan.
- **gws agenda flag rename** in upstream `gws` could land any release; the fix
  in Issue 4 should be defensive (whitelist supported flags from `gws --help`
  rather than hard-code).
- **Passwordless / device-flow auth.** `gws` exposes `auth setup` which
  provisions GCP via gcloud; worth considering as a `gwcli setup --bootstrap`
  flow for fully unattended onboarding (Issue 6 option B). Tracked separately.
- **Cross-profile concurrency.** `gws` listens on a fixed-ish localhost port
  during `auth login`; concurrent profile auth from a single host is
  serialized. Acceptable for now; revisit if multi-tenant flows become a
  priority.

## References

- Live session that uncovered these: opencode session `2026-05-19/20`
- Skill source: [`skill/SKILL.md`](../../skill/SKILL.md)
- Skill troubleshooting: [`skill/references/troubleshooting.md`](../../skill/references/troubleshooting.md)
- Existing design doc: [`plans/gws-multiprofile/README.md`](../gws-multiprofile/README.md)
- Upstream `gws`: https://github.com/googleworkspace/cli
- OAuth client_secret deprecation: https://support.google.com/cloud/answer/15549257#client-secret-hashing
- Keep API restriction: https://developers.google.com/keep/api/reference/rest
