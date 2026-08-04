# src/commands — native mgws commands

## Purpose

The native command surface handled by mgws itself (not passed through to `gws`). Covers profile management and the small set of agent-facing lifecycle/health commands.

## Ownership

- `profiles.ts` — `registerProfilesCommands`: `list`, `add`, `remove`, `rename`, `set-default`, `auth`, `status`, `reauth`, `rescope`.
- `onboard.ts` — shared onboarding core: `resolveScopeList` (CLI opts → service list / full sentinel), `addAndAuthProfile` (scaffold + auth + rollback-on-failure), and `resolveClientForScopeCap` (the preemptive scope-cap OAuth-client gate). Used by `profiles add`, `init`, and `profiles rescope`.
- `oauth-client-walkthrough.ts` — interactive walkthrough (`promptForCapExemptClient`) that guides the user to a cap-exempt (Internal Workspace / verified) OAuth client when a scope set exceeds the testing-mode cap. TTY-only; returns `null` in non-TTY so the caller surfaces `SCOPE_CAP_EXCEEDED` instead of hanging.
- `init.ts` — `runInit`: one-step onboarding orchestrator (ensure gws → create profile → auth → auto-default).
- `reauth.ts` — `runReauth`: serial bulk re-auth (`--stale-only` probes `gws auth status`) + pure `isTokenStale`.
- `rescope.ts` — `runRescope`: change a profile's scopes via remove + re-add + re-auth (preserves display name & custom client) + pure `computeRescope`.
- `agenda.ts` — native "what's on my calendar" shortcut.
- `doctor.ts` — detailed health report.
- `preflight.ts` — fast dependency check for agents.
- `setup.ts` — install gws + create config dirs. Exports `ensureSetup` (no-output, no-exit) for orchestrators; `runSetup` wraps it with output + exit.
- `migrate.ts` — v1 → current profile-layout migration.

## Local Contracts

- **Registration is two-sided.** Every native command must appear in `index.ts`'s `NATIVE_COMMANDS` set AND be registered on the Commander program, or it falls through to gws passthrough.
- **Preflight exit codes are mgws-namespaced (60–69)** (`preflight.ts` `PREFLIGHT_EXIT`): `0` ready, `63` gws missing/outdated, `64` no profiles. Silent on success; `--json` emits a machine-readable diagnosis on stderr. These are deliberately distinct from gws runtime codes (`1` general, `2` auth) so agents can route remediation unambiguously. Keep this table in sync with `multi-gws/references/troubleshooting.md` and `multi-gws/SKILL.md`.
- **`agenda` is implemented natively**, composing `calendar events list` over a `[now, now+days]` window — it does not depend on a gws `+agenda` shortcut. Validates `--days > 0` (`INVALID_AGENDA_DAYS`) and `--max > 0` (`INVALID_AGENDA_MAX`). No `--fields` mask (gws 0.22.x removed it; trim client-side).
- **`setup` is idempotent**: verifies package availability, installs `@googleworkspace/cli`, enforces `MIN_GWS_VERSION` (`0.20.0`), creates config dirs. Safe to re-run. The step logic lives in `ensureSetup` (returns `{success, steps}`, never exits) so `init` can reuse it.
- **Onboarding goes through `onboard.ts`**, not duplicated per-command. `addAndAuthProfile` scaffolds, runs auth, and on auth failure removes the profile then throws `MgwsError('AUTH_FAILED')` (callers print the message/suggestion). Auto-default is inherited from `addProfile` — never re-implement the "first profile becomes default" rule in a command.
- **Preemptive scope-cap gate** (`addAndAuthProfile` → `resolveClientForScopeCap`): before scaffolding, if `auth` is on, no `--client` was given, no `MGWS_CLIENT_ID` override is set, and `willExceedScopeCap(scopes, fullAccess)` is true, the built-in testing-mode client can't grant the request. In a TTY it runs `promptForCapExemptClient` (guidance + prompt on **stderr**) and uses the returned client; if cancelled — or in non-TTY (agent/CI), where it never blocks — it throws `MgwsError('SCOPE_CAP_EXCEEDED')` telling the caller to pass `--client` or narrow `--scopes`. Covers `add`/`init`/`rescope` automatically (all route through `addAndAuthProfile`). The prompt is injectable via `AddAndAuthOptions.promptForCapClient` for tests.
- **`init` is the agent-first one-step path**: `ensureSetup` → resolve name → `addAndAuthProfile`. Non-interactive by default; only prompts when `process.stdin.isTTY` AND not `--yes`/`--json`. In a non-TTY with no name it throws `INIT_NEEDS_NAME` (never hangs on a prompt). Idempotent: an existing profile is re-authed (if unauthenticated) rather than recreated. `--json` emits a summary and suppresses human prose.
- **`reauth` serializes** (never parallel — each auth grabs its own callback port + the shared browser, and the file keyring races on concurrent same-profile writes). `--stale-only` uses `isTokenStale` over `gws auth status` (`token_valid !== true` ⇒ stale; missing payload ⇒ stale). Re-uses each profile's stored scopes/full grant, so no interactive picker.
- **`rescope` treats scopes as immutable** (remove + re-add + re-auth). `computeRescope` is pure: `--full` wins; else base = `--set` or current (sentinel stripped), then `--add` unioned / `--remove` subtracted; throws `RESCOPE_NO_OPS` / `RESCOPE_EMPTY`. A custom `client_secret.json` is copied to a temp file and restored across the rebuild; display name is preserved. On auth failure the profile stays removed (tokens were already discarded by the rebuild).
- **`migrate` detects v1 profiles** as directories with `credentials.json` but no `gws/` subdir; migration requires `--client <path>` unless `--no-auth`.
- **`profiles add` rolls back on auth failure** (removes the scaffolded profile dir) to avoid orphaning a name that blocks retries. Supports `--json`: suppresses prose, emits a success summary (`{success, profile, created, authenticated, email, isDefault}`) on stdout, or a structured error on failure.
- **Structured JSON errors** (`onboard.ts` `emitJsonError`): in `--json` mode, `profiles add` and `init` emit a failed `MgwsError` as `{success:false, error:<code>, message, suggestion?}` on **stdout** (stable `error` = `MgwsError.code`, e.g. `SCOPE_CAP_EXCEEDED`) so agents route deterministically. Non-`--json` errors still flow to the top-level stderr handler.
- **`profiles auth` non-TTY guard:** without explicit/stored scopes and no TTY, refuse early (gws would render an interactive picker and hang). Full-access mode is exempt.
- **Error handling:** each command action catches `MgwsError`, prints `message` + `suggestion` to stderr, `process.exit(1)`. Native output honors `--format` (auto: JSON when piped, table when interactive).

## Verification

- `agenda.test.ts`, `preflight.test.ts`, `setup.test.ts`, `onboard.test.ts`, `init.test.ts`, `reauth.test.ts`, `rescope.test.ts` (vitest).
