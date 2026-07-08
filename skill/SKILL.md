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
  homepage: "https://github.com/dewdad/google-multiworkspace-cli"
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
| `127` (or "command not found") | `gwcli` itself not installed | `npm install -g github:dewdad/google-multiworkspace-cli`, then re-run |

> **These are distinct from runtime exit codes** (1, 2) emitted by `gws` API calls. See [`references/troubleshooting.md`](references/troubleshooting.md) for the full table.

**Do NOT announce preflight to the user.** Only speak if remediation is needed.

## Step 0a — First-time install (only if `gwcli` is not on PATH)

```bash
npm install -g github:dewdad/google-multiworkspace-cli
gwcli setup    # installs gws, creates config dirs, verifies versions
```

`gwcli setup` is idempotent — safe to re-run. Add `--json` for machine-readable output.

> `gwcli` is distributed via GitHub (npm clones + builds on install — requires git on PATH). It is not currently published to the npm registry.

## Account Setup (first-time or new account)

Agents MUST know the user's Google accounts. Check existing profiles first:

```bash
gwcli profiles list --format json
```

If no profiles or user requests a new account:

1. **Ask the user** for: account nickname (e.g. `work`, `personal`) and which services they need
2. The user must provide an OAuth client secret JSON from Google Cloud Console — see `@references/oauth-bootstrap.md` (Google deprecated post-creation secret retrieval; one-shot capture).
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
1. Runtime exit `2` → auth expired → see "Re-authenticating expired tokens" below
2. Runtime exit `1` → gws printed error to stderr, inspect it
3. Preflight exit `63`/`64` → run `gwcli setup` or add a profile (see Step 0)
4. Run `gwcli doctor` for systematic diagnosis

→ Full reference: `@references/troubleshooting.md`

## Re-authenticating expired tokens (the shared-CDP flow)

When `gwcli profiles status --strict` exits non-zero or any API call returns
`invalid_grant: Token has been expired or revoked`, the profile needs a fresh
OAuth round-trip. **This is interactive — the user has to log in to Google in a
real browser.** The clean way to run it with a Hermes agent in the loop:

### Why the simple "just call `gwcli profiles auth <name>`" doesn't work for agents

- `gws auth login` (the underlying Rust binary) **always shows a TUI scope
  picker first** (Ink-style ratatui menu, "Enter to Confirm"). Even if you
  pass `--scopes gmail,calendar,...` to `gwcli profiles auth`, the picker
  still appears. It needs a real `\r` from a real keyboard — agent `write`/
  `submit` over a PTY produces `\n`, which the picker reads as Down-Arrow.
- After Confirm, gws prints the OAuth URL and starts a localhost callback
  server on a **dynamic port** (e.g. `127.0.0.1:36767`).
- gws **does not auto-open the URL** — it only prints "Open this URL in your
  browser to authenticate:". So even on a graphical machine, the user has to
  copy/paste it somewhere.

### The right workflow

```
┌──────────────┐      ┌─────────────────┐      ┌────────────────┐
│ User's       │      │ User runs       │      │ Agent driving  │
│ terminal A   │      │ gwcli auth      │      │ cloak-cdp      │
│ (CLI Hermes) │ ───▶ │ in terminal B   │ ───▶ │ browser via    │
│              │      │ (real TTY)      │      │ browser_navi.. │
└──────────────┘      └─────────────────┘      └────────────────┘
       │                      │                         │
       │                      │ prints OAuth URL        │
       │   user pastes URL    ▼                         │
       │ ◀────────────────────────────────────────────  │
       │                                                │
       │   agent navigates the URL in shared window     ▼
       │ ──────────────────────────────────────────▶ user logs in
                                                    Google → 127.0.0.1:<port>
                                                    callback fires → done
```

### Step-by-step

**1. Ensure shared browser is running** (so user + agent see the same window):
```bash
cloak-cdp                # ~/.local/bin/cloak-cdp — idempotent
```

Then attach Hermes's `browser_*` toolset to that window. Two options:

- **CLI session**: user types `/browser connect` in their Hermes prompt
  (slash command, NOT dispatched through gateways/Telegram/Discord/etc.).
- **Any context (gateway, cron, agent-driven)**: agent runs
  `hermes config set browser.cdp_url http://127.0.0.1:9222`
  (or edits `~/.hermes/config.yaml`). Picks up on next `browser_*` call.
  Confirm by checking the `browser_navigate` response includes
  `stealth_features: ["cdp_override"]` and `browser_console` returns a UA
  with `Chrome/146` (real) instead of `HeadlessChrome/<version>` (default).

See skill `playwright-cli` § "Interactive flows shared with the user" for
the full pitfall list.

**2. Start the auth flow.** Two paths — pick based on whether the agent has
terminal access:

- **Agent-driven (preferred when agent has `terminal` tool)**: invoke the
  bundled driver script. It spawns gwcli in a properly-sized PTY, gets past
  the Ink scope picker by sending `\r` (CR — `\n` is Down-Arrow due to
  cooked-mode line discipline!), captures the OAuth URL, and keeps the gws
  callback server alive until completion.
  ```bash
  drive_gwcli_auth.py <name>     # backgrounded — log to /tmp/gwauth.log
  # then grep "URL_CAPTURED" /tmp/gwauth.log for the URL,
  # navigate cloak-cdp browser to it, watch for "AUTH_SUCCESS"
  ```
  See `@scripts/drive_gwcli_auth.py` — install with `cp` to `~/.local/bin/`
  (the script docstring includes the full pitfall list and rationale).

- **User-driven (fallback when no terminal access)**: ask the user to run it
  in a real interactive terminal:
  ```bash
  gwcli profiles auth <name>
  # At the scope picker: press Enter to confirm.
  # gws prints: "Open this URL in your browser to authenticate: https://..."
  ```
  User pastes URL back to the agent.

**4. Agent navigates the shared browser to that URL:**
```
browser_navigate(<oauth-url>)
```
The user sees the Google account picker / consent screen in the cloak-cdp
window. They click their account; if Google shows **"Google hasn't verified
this app"**, click `Advanced` → `Go to <app> (unsafe)`. Then approve consent.

**5. Google redirects to `http://127.0.0.1:<port>/?code=...`** — that's
gws's callback server. It captures the code, exchanges for tokens, prints
"Authentication successful. Encrypted credentials saved.", and exits.

**6. Verify (real API call, not just `profiles status`):**
```bash
gwcli profiles status --format json --strict <name>   # token_valid:true
gwcli --profile <name> agenda --days 1                # actually hits API
```
Note: `gwcli profiles status` returns `authenticated: true` even with revoked
tokens — only the `details.token_valid` field reflects real grant state.
Always check that field or run a smoke API call.

### Pitfalls

- **`browser_*` tools must be attached to the visible window before step 4.**
  Otherwise `browser_navigate` opens the URL in headless agent-browser the
  user can't see → flow stalls. Use `hermes config set browser.cdp_url
  http://127.0.0.1:9222` (any context) or `/browser connect` (CLI only).
- **PTY EOF ≠ child death.** When the gwcli node wrapper finishes its UI
  work, the PTY master may see EOF while gws still listens on the callback
  port. A naive driver that bails on first empty `read()` will kill gws
  before the callback fires, leaving credentials.enc untouched. The bundled
  `drive_gwcli_auth.py` handles this (checks `waitpid WNOHANG` before bailing).
- **`\r` vs `\n` to Ink TUIs.** The gws scope picker accepts CR as Confirm
  but treats LF as Down-Arrow. `process(action='submit')` and most agent
  PTY APIs send LF — won't work. Drive via raw `os.write(fd, b'\r')`.
- **The picker needs window-size.** Without `TIOCSWINSZ` (or COLUMNS/LINES
  env), Ink stays mute and gws prints nothing. Naive `pty.fork()` setups
  will hang silently.
- **The callback port is dynamic** — extract from the URL gws prints, don't
  hardcode 8080/9090.
- **CSRF state token is single-use.** If the URL expires (user too slow,
  multi-tab confusion), re-run `gwcli profiles auth <name>` to mint a fresh URL.
- **Persistent profile speeds up subsequent auths.** After first OAuth, the
  cloak-cdp profile remembers the Google session — re-authing the same
  account skips password+2FA, often skips consent too.
- **Unverified-app warning** ("Google hasn't verified this app") appears for
  user-created OAuth clients on every fresh consent. Click `Advanced` →
  `Go to <app> (unsafe)`. Skill `google-workspace` deliberately doesn't
  hide this — confirm with the user before clicking.
- **Multiple browser tabs confuse `browser_console`.** Hermes's CDP tab
  selection isn't deterministic when multiple pages exist. To find which
  tab has the OAuth flow, use `curl http://127.0.0.1:9222/json` — it lists
  all tabs with URLs and titles.
- **Driver deadline.** `drive_gwcli_auth.py` has a 10-minute deadline. For
  accounts requiring fresh password+2FA+passkey (especially "Use another
  account" flows), 2 minutes was insufficient and silently killed gws
  before callback. Bump it further if needed for slow 2FA paths.
- **Bulk re-auth: serialize, don't parallelize.** Each `gwcli profiles auth`
  spawns its own callback port and consumes the visible browser window.

### Quick command for the user

When several profiles need re-auth at once (token expiry often hits every
profile on the same client simultaneously). List your profiles with
`gwcli profiles list --format json`, then serialize the re-auth:
```bash
for p in profile-a profile-b profile-c; do   # your profile names
  echo "=== $p ==="
  gwcli profiles auth "$p"
  # press Enter on the picker, paste URL to agent, log in, repeat
done
```

## Token longevity & monitoring

### Why refresh tokens die

Refresh tokens are *not* killed by lack of use within reasonable timeframes.
They die when:

| Cause | Trigger | Fix |
|-------|---------|-----|
| OAuth client in **"Testing"** publishing status | every 7 days | publish app to "In production" |
| Test user authorization in Testing mode | every 7 days | move to In production OR add test users |
| Refresh token unused for **6 months** | wall-clock idle | use it occasionally |
| User changed Google password | event-driven | re-auth, no preventive fix |
| User revoked from myaccount.google.com/permissions | event-driven | re-auth |
| **>50 refresh tokens** outstanding for one client+account | rotation | older tokens get revoked silently |
| `gws auth logout` ran | explicit revoke | re-auth |

**Diagnosing your own setup**: check your OAuth client's publishing status in
the Google Cloud console. If it's already **"In production"**, the 7-day
testing-mode expiry is NOT your cause — the most likely remaining culprit is
rotation past the 50-token cap (re-issuing creds many times during iteration).
To mitigate, avoid spurious `gwcli profiles auth` runs unless necessary.

Polling the API does NOT keep refresh tokens alive — the access-token
refresh that happens silently on every API call is unrelated to the
factors that revoke refresh tokens. A "ping cron" is wasted compute.

### Health-check cron (recommended pattern)

Set up a weekly silent watchdog that runs `gwcli profiles status --strict`
across your profiles and only speaks up when a profile's `token_valid` flips
false — delivering the exact remediation command (`gwcli profiles auth <name>`)
when it does. Silent on success keeps it noise-free. Schedule it for a time you
can act on the alert (e.g. Monday morning), since re-auth needs an interactive
browser login.

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
- **OAuth client creation**: Load `@references/oauth-bootstrap.md`
- **Debugging**: Load `@references/troubleshooting.md`
- **Never load all references at once** — load only what's needed for the current task
