---
name: google-workspace
description: |
  Google Workspace access for AI agents — Gmail, Calendar, Drive, Docs, Sheets, Keep, Tasks.
  Multi-account profiles (personal, work, client-X). Auto-installs dependencies.

  Use when: reading/sending email, managing calendar events, searching Drive,
  accessing Google Docs/Sheets, or any Google Workspace task for a specific user account.
argument-hint: "[service] [action] [--profile name] [--format json]"
metadata:
  version: "2.1.0"
  tags: "google, workspace, gmail, calendar, drive, docs, sheets, keep, tasks, multi-account"
  requires-bins: "node, gwcli"
  homepage: "https://github.com/ianpatrickhines/google-workspace-cli"
  license: "MIT"
  self-improving: true
---

# Google Workspace

> **`gws` passthrough output is JSON by default.** Native gwcli commands (`profiles list`, `profiles status`) emit JSON when stdout is piped, table when interactive — pass `--format json` to force JSON unconditionally.

## Step 0 — Preflight (MANDATORY, every invocation)

```bash
gwcli preflight
```

Exit `0` + silent = ready. On non-zero, gwcli writes nothing — re-run with `--json` for a machine-readable diagnosis:

```bash
gwcli preflight --json
```

### Preflight exit codes (gwcli-namespaced, range 60–69)

| Exit | Meaning | Action |
|------|---------|--------|
| `0` | ready | proceed |
| `63` | `gws` binary missing/outdated | `gwcli setup` |
| `64` | no profiles configured | see "Account Setup" below |
| `127` (or "command not found") | `gwcli` itself not installed | `npm install -g google-workspace-cli`, then re-run |

> **These are distinct from runtime exit codes** (1, 2) emitted by `gws` API calls. See [`references/troubleshooting.md`](references/troubleshooting.md) for the full table.

**Do NOT announce preflight to the user.** Only speak if remediation is needed.

## Step 0a — First-time install (only if `gwcli` is not on PATH)

```bash
npm install -g google-workspace-cli
gwcli setup    # installs gws, creates config dirs, verifies versions
```

`gwcli setup` is idempotent — safe to re-run. Add `--json` for machine-readable output.

## Account Setup (first-time or new account)

Agents MUST know the user's Google accounts. Check existing profiles first:

```bash
gwcli profiles list --format json
```

If no profiles or user requests a new account:

1. **Ask the user** for: account nickname (e.g. `work`, `personal`) and which services they need
2. The user must provide an OAuth client secret JSON from Google Cloud Console
3. Run (omit `--scopes` to grant all supported services):
```bash
# All services (recommended for general agents)
gwcli profiles add <name> --client <path-to-client-secret.json>

# Or restrict scopes — pick from: gmail, calendar, drive, docs, sheets, keep, tasks
gwcli profiles add <name> --client <path-to-client-secret.json> --scopes gmail,calendar,drive,docs,sheets,keep,tasks
```
4. This opens a browser — the user authenticates. Tokens are stored locally.
5. Set default if first profile: `gwcli profiles set-default <name>`

> **Scopes are immutable on a profile.** To add a scope later, you must `profiles remove` then `profiles add` with the new scope set. `profiles auth` re-uses the existing scope set.

**Profile selection priority:** `--profile` flag > `GWCLI_PROFILE` env > configured default.

## Command Router

All commands follow: `gwcli [--profile <name>] <service> <resource> <action> --params '<json>'`

### Gmail
```bash
gwcli gmail users messages list --params '{"userId":"me","maxResults":20}'
gwcli gmail users messages get --params '{"userId":"me","id":"<msg-id>"}'
gwcli gmail users messages send --params '{"userId":"me"}' --body '{"raw":"<base64>"}'
gwcli gmail users drafts create --params '{"userId":"me"}' --body '<json>'
```
→ Full reference: `@references/gmail.md`

### Calendar
```bash
gwcli calendar events list --params '{"calendarId":"primary","timeMin":"<ISO>","timeMax":"<ISO>"}'
gwcli calendar events insert --params '{"calendarId":"primary"}' --body '<event-json>'
gwcli agenda --days 7                                    # native shortcut: events for next N days
gwcli --profile work agenda --days 1                     # today's work events
```
→ Full reference: `@references/calendar.md`

### Drive
```bash
gwcli drive files list --params '{"pageSize":20}'
gwcli drive files get --params '{"fileId":"<id>"}'
gwcli drive files export --params '{"fileId":"<id>","mimeType":"text/plain"}'
```
→ Full reference: `@references/drive.md`

### Keep
```bash
gwcli keep notes list --params '{"pageSize":25}'
gwcli keep notes get --params '{"name":"notes/<note-id>"}'
gwcli keep notes create --body '{"title":"Note Title","body":{"text":{"text":"Content"}}}'
gwcli keep notes delete --params '{"name":"notes/<note-id>"}'
```
→ Full reference: `@references/keep.md`

### Tasks
```bash
gwcli tasks tasklists list --params '{"maxResults":20}'
gwcli tasks tasks list --params '{"tasklist":"@default","showCompleted":false}'
gwcli tasks tasks insert --params '{"tasklist":"@default"}' --body '{"title":"New task","due":"<ISO>"}'
gwcli tasks tasks patch --params '{"tasklist":"<id>","task":"<id>"}' --body '{"status":"completed"}'
```
→ Full reference: `@references/tasks.md`

### Profile Management
```bash
gwcli profiles list --format json
gwcli profiles add <name> --client <path>                                # all 7 services
gwcli profiles add <name> --client <path> --scopes gmail,calendar,drive  # restricted
gwcli profiles remove <name> --force      # --force is REQUIRED (non-interactive)
gwcli profiles set-default <name>
gwcli profiles auth <name>                # re-authenticate (re-uses existing scopes)
gwcli profiles status --format json --strict   # exits 2 if ANY profile unauthenticated
gwcli doctor                              # full health check
gwcli migrate --client <path>             # migrate v1 profiles to v2 layout
```
→ Full reference: `@references/profiles.md`

## Concurrency

- **Cross-profile parallelism is safe.** Each profile gets an isolated `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` per spawn, so commands against different profiles can fan out freely.
- **Same-profile commands must be serialized.** The file-keyring backend stores tokens as plain JSON; concurrent same-profile invocations can race during token refresh and corrupt the cache.
- For bulk same-profile work, batch via field masks and pagination, not parallel spawns.

## Error Recovery

On any command failure:
1. Runtime exit `2` → auth expired → `gwcli profiles auth <profile>`
2. Runtime exit `1` → gws printed error to stderr, inspect it
3. Preflight exit `63`/`64` → run `gwcli setup` or add a profile (see Step 0)
4. Run `gwcli doctor` for systematic diagnosis

→ Full reference: `@references/troubleshooting.md`

## Self-Improvement Protocol

If you discover an inaccuracy in this skill (wrong command, missing flag, broken example), edit the relevant file directly using your file-editing tools. Keep changes minimal and run `gwcli doctor` to confirm the change doesn't break anything.

→ Full reference: `@references/self-improvement.md`

## Token Budget Guide

- **Quick email check**: Use this SKILL.md only (~150 lines)
- **Complex Gmail workflow**: Load `@references/gmail.md`
- **Calendar operations**: Load `@references/calendar.md`
- **Drive/Docs/Sheets**: Load `@references/drive.md`
- **Notes and Keep**: Load `@references/keep.md`
- **Task management**: Load `@references/tasks.md`
- **First-time setup**: Load `@references/profiles.md`
- **Debugging**: Load `@references/troubleshooting.md`
- **Never load all references at once** — load only what's needed for the current task
