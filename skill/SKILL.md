---
name: google-workspace
description: |
  Google Workspace access for AI agents — Gmail, Calendar, Drive, Docs, Sheets, Keep, Tasks.
  Multi-account profiles (personal, work, client-X). Auto-installs dependencies.

  Use when: reading/sending email, managing calendar events, searching Drive,
  accessing Google Docs/Sheets, or any Google Workspace task for a specific user account.
argument-hint: "[service] [action] [--profile name] [--format json]"
metadata:
  version: "2.0.0"
  tags: "google, workspace, gmail, calendar, drive, docs, sheets, keep, tasks, multi-account"
  requires-bins: "node"
  homepage: "https://github.com/ianpatrickhines/google-workspace-cli"
  license: "MIT"
  self-improving: true
---

# Google Workspace

> **All output is JSON by default.** Structured for agent parsing.

## Step 0 — Preflight (MANDATORY, every invocation)

```bash
node "$SKILL_DIR/scripts/preflight.mjs"
```

Exit 0 + no output = ready. On non-zero:

| Exit | Meaning | Action |
|------|---------|--------|
| `1` | Node.js < 18 | Ask user to update Node |
| `2` | `gwcli` not installed | Run: `node "$SKILL_DIR/scripts/setup.mjs"` |
| `3` | `gws` binary missing/outdated | Run: `node "$SKILL_DIR/scripts/setup.mjs"` |
| `4` | No profiles configured | See "Account Setup" below |

**Do NOT announce preflight to the user.** Only speak if remediation is needed.

## Account Setup (first-time or new account)

Agents MUST know the user's Google accounts. Check existing profiles first:

```bash
gwcli profiles list --format json
```

If no profiles or user requests a new account:

1. **Ask the user** for: account nickname (e.g. `work`, `personal`) and which services they need
2. The user must provide an OAuth client secret JSON from Google Cloud Console
3. Run:
```bash
gwcli profiles add <name> --client <path-to-client-secret.json> --scopes gmail,calendar,drive
```
4. This opens a browser — the user authenticates. Tokens are stored locally.
5. Set default if first profile: `gwcli profiles set-default <name>`

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
gwcli calendar +agenda --days 7
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
gwcli profiles add <name> --client <path> [--scopes gmail,calendar,drive,keep,tasks]
gwcli profiles remove <name>
gwcli profiles set-default <name>
gwcli profiles auth <name>              # Re-authenticate
gwcli doctor                            # Full health check
```
→ Full reference: `@references/profiles.md`

## Error Recovery

On any command failure:
1. Check exit code 2 → auth expired → `gwcli profiles auth <profile>`
2. Check exit code 1 → gws printed error to stderr, inspect it
3. Run `gwcli doctor` for systematic diagnosis

→ Full reference: `@references/troubleshooting.md`

## Self-Improvement Protocol

When encountering issues or discovering better patterns:
1. Log the issue: append to `$SKILL_DIR/.feedback/issues.jsonl`
2. If you fix the skill files, append to `$SKILL_DIR/.feedback/changes.jsonl`

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
