# src/commands — native gwcli commands

## Purpose

The native command surface handled by gwcli itself (not passed through to `gws`). Covers profile management and the small set of agent-facing lifecycle/health commands.

## Ownership

- `profiles.ts` — `registerProfilesCommands`: `list`, `add`, `remove`, `rename`, `set-default`, `auth`, `status`.
- `agenda.ts` — native "what's on my calendar" shortcut.
- `doctor.ts` — detailed health report.
- `preflight.ts` — fast dependency check for agents.
- `setup.ts` — install gws + create config dirs.
- `migrate.ts` — v1 → current profile-layout migration.

## Local Contracts

- **Registration is two-sided.** Every native command must appear in `index.ts`'s `NATIVE_COMMANDS` set AND be registered on the Commander program, or it falls through to gws passthrough.
- **Preflight exit codes are gwcli-namespaced (60–69)** (`preflight.ts` `PREFLIGHT_EXIT`): `0` ready, `63` gws missing/outdated, `64` no profiles. Silent on success; `--json` emits a machine-readable diagnosis on stderr. These are deliberately distinct from gws runtime codes (`1` general, `2` auth) so agents can route remediation unambiguously. Keep this table in sync with `skill/references/troubleshooting.md` and `skill/SKILL.md`.
- **`agenda` is implemented natively**, composing `calendar events list` over a `[now, now+days]` window — it does not depend on a gws `+agenda` shortcut. Validates `--days > 0` (`INVALID_AGENDA_DAYS`) and `--max > 0` (`INVALID_AGENDA_MAX`). No `--fields` mask (gws 0.22.x removed it; trim client-side).
- **`setup` is idempotent**: verifies package availability, installs `@googleworkspace/cli`, enforces `MIN_GWS_VERSION` (`0.20.0`), creates config dirs. Safe to re-run.
- **`migrate` detects v1 profiles** as directories with `credentials.json` but no `gws/` subdir; migration requires `--client <path>` unless `--no-auth`.
- **`profiles add` rolls back on auth failure** (removes the scaffolded profile dir) to avoid orphaning a name that blocks retries.
- **`profiles auth` non-TTY guard:** without explicit/stored scopes and no TTY, refuse early (gws would render an interactive picker and hang). Full-access mode is exempt.
- **Error handling:** each command action catches `GwcliError`, prints `message` + `suggestion` to stderr, `process.exit(1)`. Native output honors `--format` (auto: JSON when piped, table when interactive).

## Verification

- `agenda.test.ts`, `preflight.test.ts`, `setup.test.ts` (vitest).
