# CLI Interface

## Command Structure

```
gwcli [global-flags] <command> [args...]
```

### Global Flags

| Flag | Short | Env Var | Description |
|------|-------|---------|-------------|
| `--profile <name>` | `-p` | `GWCLI_PROFILE` | Select profile for this invocation |
| `--format <fmt>` | `-f` | `GWCLI_FORMAT` | Output format: json, table, yaml, csv |
| `--verbose` | `-v` | `GWCLI_VERBOSE=1` | Show debug info (profile resolution, gws command) |
| `--dry-run` | | | Pass `--dry-run` to `gws` only if the pinned `gws` version supports it |

### Command Groups

```
gwcli profiles <subcommand>     ← Profile management (gwcli-native)
gwcli doctor                    ← Health check (gwcli-native)
gwcli version                   ← Version info (gwcli-native)
gwcli migrate                   ← v1 profile migration helper (gwcli-native)
gwcli <anything-else>           ← Passthrough to gws
```

## Profile Commands (Native)

These are handled entirely by gwcli — they never invoke gws (except during auth flows).

```bash
gwcli profiles add <name> --client <path> [--scopes <list>] [--display-name <str>]
gwcli profiles remove <name> [--force]
gwcli profiles list [--format json|table]
gwcli profiles rename <old> <new>
gwcli profiles set-default <name>
gwcli profiles auth <name> [--scopes <list>]
gwcli profiles add-scopes <name> --scopes <list>
gwcli profiles status [<name>]
gwcli profiles export <name> --output <path>
gwcli profiles import <path> --name <name>
```

## Passthrough Commands (Everything Else)

Any command that isn't `profiles`, `doctor`, or `version` is passed directly to gws with the profile's config dir injected.

```bash
# What the user/agent types:
gwcli --profile work gmail +triage

# What gwcli executes:
GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gwcli/profiles/work/gws/ gws gmail +triage

# What the user/agent types:
gwcli -p personal keep notes list --params '{"pageSize": 10}'

# What gwcli executes:
GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gwcli/profiles/personal/gws/ gws keep notes list --params '{"pageSize": 10}'
```

### Passthrough Rules

1. **Native command detection happens first** — `profiles`, `doctor`, `version`, `migrate`, and `completion` are handled by gwcli.
2. **Only gwcli global flags are parsed by gwcli** — `--profile/-p`, `--format/-f`, `--verbose/-v`, and any future gwcli-only global flags.
3. **Everything after the passthrough command is preserved** — gws flags are gws flags; gwcli does not parse or validate them.
4. **Unknown passthrough options must not be rejected by Commander** — implementation must use an argv parser shape that preserves unknown args for `gws`.
5. **`--` is supported** — `gwcli -p work -- gmail users messages list --params ...` always treats the right side as `gws` args.
6. **stdout/stderr stream directly by default** — no buffering in passthrough mode, which supports large outputs and NDJSON streaming.
7. **Exit code forwarded** — gwcli exits with gws's exit code.

### Format Flag Interaction

If `--format` is specified on gwcli:
- It is translated to gws's `--format` flag and appended to the gws args only when the passthrough args do not already contain `--format` or `-f`.
- If the user specifies `--format` in the passthrough args, that explicit gws flag wins and gwcli does not inject another format flag.

```bash
gwcli -f table -p work drive files list
# → gws drive files list --format table
```

## Doctor Command

```bash
gwcli doctor
```

Checks:
1. `gws` binary found on PATH → version
2. Config directory accessible
3. All profiles: credentials present, auth healthy
4. Network connectivity (optional: attempt a lightweight API call)

**Output:**
```
gwcli v2.0.0
gws   v0.22.5  (/usr/local/bin/gws)

Profiles:
  ✓ personal  (me@gmail.com) — authenticated, 7 scopes
  ✓ work      (jdoe@acme.com) — authenticated, 5 scopes
  ✗ client-x  — credentials expired, run: gwcli profiles auth client-x

Config: ~/.config/gwcli/
```

## Agent Integration Patterns

### JSON-First Design

Default output is JSON (matching gws default). Agents parse structured data:

```bash
# Agent reads emails
gwcli -p work gmail +triage
# Returns JSON array of unread messages

# Agent creates calendar event
gwcli -p work calendar events insert \
  --params '{"calendarId": "primary"}' \
  --json '{"summary": "Team standup", "start": {"dateTime": "2025-07-15T09:00:00-07:00"}, "end": {"dateTime": "2025-07-15T09:30:00-07:00"}}'

# Agent reads Google Keep notes
gwcli -p personal keep notes list

# Agent searches Drive
gwcli -p work drive files list \
  --params '{"q": "name contains \"Q3 Report\"", "pageSize": 5}' \
  --fields "files(id,name,mimeType,modifiedTime)"
```

### Exit Codes

| Code | Meaning | Agent Action |
|------|---------|--------------|
| 0 | Success | Parse stdout as response |
| 1 | General error | Read stderr for details |
| 2 | Usage error (bad args) | Fix command syntax |
| 4 | Auth error | Run `gwcli profiles auth <profile>` |
| 5 | Permission denied | Scope insufficient, add scopes |
| 130 | Interrupted (SIGINT) | Retry or abort |

### Context Window Efficiency

Agents should ALWAYS use `--fields` to limit response size:

```bash
# BAD: Returns entire email objects (huge)
gwcli -p work gmail users messages list --params '{"userId": "me", "maxResults": 10}'

# GOOD: Only fields the agent needs
gwcli -p work gmail users messages list \
  --params '{"userId": "me", "maxResults": 10}' \
  --fields "messages(id,threadId,snippet,internalDate)"
```

### Schema Discovery

Agents can introspect APIs before calling them:

```bash
# What parameters does this method accept?
gwcli -p work schema calendar.events.insert

# What fields are in the response?
gwcli -p work schema drive.files.list
```

### Dry Run for Safety

Agents should use `--dry-run` for mutating operations only after `gwcli doctor` confirms the installed `gws` supports dry-run for the target command:

```bash
# Validate the payload without sending, when supported by gws
gwcli -p work --dry-run gmail users messages send \
  --params '{"userId": "me"}' \
  --json '{"raw": "..."}'
# Returns: validation result from gws, if that command supports dry-run

# If valid, execute for real
gwcli -p work gmail users messages send \
  --params '{"userId": "me"}' \
  --json '{"raw": "..."}'
```

### Multi-Account Workflows

Agent orchestrates across accounts:

```bash
# Check work email
work_emails=$(gwcli -p work gmail +triage)

# Check personal calendar
personal_events=$(gwcli -p personal calendar +agenda --days 1)

# Copy a file from personal to work drive
file_content=$(gwcli -p personal drive files get --params '{"fileId": "abc123"}' --output /tmp/report.pdf)
gwcli -p work drive files create --upload /tmp/report.pdf --json '{"name": "Shared Report.pdf"}'
```

## Skill File for LLM Agents

The project ships a skill file that agents load for command reference:

```yaml
---
name: gwcli
description: "Multi-account Google Workspace CLI. Manages Gmail, Calendar, Drive, Keep, Docs, Sheets, Tasks, Chat, Meet across multiple Google accounts via named profiles."
metadata:
  requires:
    bins:
      - gwcli
      - gws
---
```

### Skill Content Structure

```markdown
# gwcli — Multi-Account Google Workspace CLI

## Quick Reference

### Profile Selection
- `--profile <name>` or `-p <name>` — use specific profile
- `GWCLI_PROFILE=<name>` — via env var
- Default profile used if neither specified

### Common Patterns

#### Email
gwcli -p <profile> gmail +triage                    # Unread inbox summary
gwcli -p <profile> gmail +read <msg-id>             # Read specific email
gwcli -p <profile> gmail +send --to X --subject Y --body Z
gwcli -p <profile> gmail +reply <msg-id> --body "..."

#### Calendar
gwcli -p <profile> calendar +agenda [--days N]      # Upcoming events
gwcli -p <profile> calendar +insert "Title" --start "2025-01-15 10:00" --end "2025-01-15 11:00"

#### Drive
gwcli -p <profile> drive files list --fields "files(id,name)" --params '{"pageSize":10}'
gwcli -p <profile> drive files get --params '{"fileId":"ID"}' --output ./file.pdf

#### Keep
gwcli -p <profile> keep notes list
gwcli -p <profile> keep notes create --json '{"title":"Todo","body":{"text":{"text":"Buy milk"}}}'

#### Docs
gwcli -p <profile> docs +write <doc-id> --body "Append this text"
gwcli -p <profile> docs documents get --params '{"documentId":"ID"}'

#### Sheets
gwcli -p <profile> sheets +read --spreadsheet <id> --range "Sheet1!A1:D10"
gwcli -p <profile> sheets +append --spreadsheet <id> --range "Sheet1!A1" --values '["col1","col2"]'

### Safety
- Use `--dry-run` before mutating operations only when `gwcli doctor` confirms support for the target command
- Use `--fields` to limit response size
- Use `gws schema <resource.method>` to discover API structure
```

## Version Command

```bash
gwcli version
```

Output:
```json
{
  "gwcli": "2.0.0",
  "gws": "0.22.5",
  "gwsPath": "/usr/local/bin/gws",
  "configDir": "~/.config/gwcli",
  "profileCount": 3,
  "node": "v22.1.0"
}
```

## Shell Completion

Generate completions that include:
- Profile names (for `--profile`)
- Subcommands from `profiles` group
- Passthrough to gws completions for service commands

```bash
gwcli completion bash >> ~/.bashrc
gwcli completion zsh >> ~/.zshrc
gwcli completion fish >> ~/.config/fish/completions/gwcli.fish
gwcli completion powershell >> $PROFILE
```

## Non-Interactive Mode

For agent/CI usage, non-auth commands must work without TTY:
- `profiles add --service-account <path>` creates a non-interactive service-account profile, if Phase 0 confirms the `gws` service-account path
- `profiles import <bundle> --name <name> --no-auth` imports metadata/client config without launching browser auth
- `profiles remove --force` → no confirmation prompt
- All output to stdout (parseable), errors to stderr
- No spinner, progress bar, or color when `NO_COLOR=1` or stdout is not TTY
- OAuth user auth (`profiles add --client`, `profiles auth`) remains interactive unless a future `gws` non-interactive credential import flow is verified and documented
