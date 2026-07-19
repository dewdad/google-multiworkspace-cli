---
name: google-workspace
description: |
  Google Workspace access for AI agents — Gmail, Calendar, Drive, Docs, Sheets, Keep, Tasks.
  Multi-account profiles (personal, work, client-X). Auto-installs dependencies.

  Use when: reading/sending email, managing calendar events, searching Drive,
  accessing Google Docs/Sheets, or any Google Workspace task for a specific user account.
argument-hint: "[service] [action] [--profile name] [--format json]"
metadata:
  version: "2.3.0"
  tags: "google, workspace, gmail, calendar, drive, docs, sheets, keep, tasks, multi-account"
  requires-bins: "node, gwcli"
  homepage: "https://github.com/dewdad/google-multiworkspace-cli"
  license: "MIT"
  self-improving: true
---

# Google Workspace

## Operating principle — the binary is the source of truth

This skill is a **fast path with a self-healing escape hatch**, not a frozen
spec. When the documented surface and the installed binary disagree, **the
binary wins.** Follow this hierarchy:

1. **Fast path:** use the documented command/example directly — that's what the
   examples are for. Don't shell out to `--help` before routine calls.
2. **Self-heal on mismatch:** if a command errors with `unexpected argument`,
   an unknown flag, or otherwise behaves unlike the docs, run
   `gwcli <cmd> --help` (and/or `gwcli setup` to update `gws`) and **trust its
   output over this document.** Adjust and proceed — then, per the
   `self-improving` protocol, fix the doc.
3. **Live state, not memory:** for facts about the system — which profiles
   exist, auth validity, versions, readiness — **query the CLI**
   (`gwcli profiles list --format json`, `profiles status --strict`,
   `preflight --json`, `doctor`) rather than assuming. These are authoritative
   and self-updating; prose goes stale.

What this doc still owns (the CLI can **not** self-report these — don't expect
`--help` to reveal them): **operational gotchas** (e.g. `--upload` is CWD-only,
the keyring line on stderr, same-profile parallelism corrupts the token cache,
Keep 403s on @gmail.com), the **interactive OAuth / shared-browser flow**, and
**decision policy** (draft-vs-send, cross-account safety). Treat the gotcha and
policy sections as canonical; treat the flag/command surface as a cached hint
that `--help` can override.

> **`gws` passthrough output is JSON by default.** Native gwcli commands (`profiles list`, `profiles status`) emit JSON when stdout is piped, table when interactive — pass `--format json` to force JSON unconditionally.
>
> **Parsing output (important).** The JSON payload is written to **stdout**; a
> `Using keyring backend: file` line is written to **stderr**. When a caller
> merges the two streams (`2>&1`, some subprocess wrappers), that line prefixes
> the JSON and naive `JSON.parse` / `json.loads` fails on
> `Expecting value: line 1 column 1`. Fix: capture **stdout only** (or append
> `2>/dev/null`), or strip any leading non-JSON line before parsing.

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
| `63` | `gws` binary missing/outdated | `gwcli setup` (installs/upgrades `gws` to latest by default) |
| `64` | no profiles configured | see "Account Setup" below |
| `127` (or "command not found") | `gwcli` itself not installed | `npm install -g github:dewdad/google-multiworkspace-cli`, then re-run |

> **These are distinct from runtime exit codes** (1, 2) emitted by `gws` API calls. See [`references/troubleshooting.md`](references/troubleshooting.md) for the full table.

**Do NOT announce preflight to the user.** Only speak if remediation is needed.

## Step 0a — Install & keep current (activation step)

On **first activation** (or whenever preflight returns `63`/`127`):

```bash
# Only if `gwcli` itself is missing from PATH:
npm install -g github:dewdad/google-multiworkspace-cli

# Install/repair config dirs AND pull the LATEST `gws` binary (default behavior).
# Run this as part of skill activation so `gws` never drifts behind the docs.
gwcli setup               # idempotent; installs latest gws. Add --json for machine output.
# Pin a specific version if ever needed: gwcli setup --gws-version <version>
```

`gwcli setup` is idempotent — safe to re-run. It installs the **latest** `gws`
release by default (pin with `--gws-version <version>`); run it on activation
and any time preflight flags `gws` as outdated (exit `63`) so the binary stays
current with these docs. Confirm with `gwcli doctor`, which prints both `gwcli`
and `gws` versions.

> **Version hygiene.** The reference examples are written against **gws 0.22.x**.
> If a command errors with `unexpected argument` for a documented flag, first
> run `gwcli setup` (installs latest) and re-check `<command> --help` — the flag surface
> is the source of truth. (Body = `--json`; there is no `--body`/`--fields`
> flag; field masks live inside `--params`.)

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

All commands follow: `gwcli [--profile <name>] <service> <resource> <action> --params '<json>' [--json '<request-body>'] [--upload <path> --upload-content-type <mime>]`

> **Flag surface (gws 0.22.x — verified via `--help`).** Query/URL params →
> **`--params`**. Request **body** → **`--json`** (there is NO `--body` flag).
> **Field masks** go **inside** `--params` as a `"fields"` key (there is NO
> `--fields` flag). Binary content (attachments/uploads) → **`--upload`** +
> `--upload-content-type`; note `--upload` accepts only a **relative path inside
> the current working directory** (cd first). If a documented flag errors with
> `unexpected argument`, run `gwcli setup` to update `gws` and check `--help`.

### Gmail
```bash
gwcli gmail users messages list --params '{"userId":"me","maxResults":20}'
gwcli gmail users messages get --params '{"userId":"me","id":"<msg-id>"}'
gwcli gmail users messages send --params '{"userId":"me"}' --json '{"raw":"<base64>"}'
gwcli gmail users drafts create --params '{"userId":"me"}' --json '<request-body>'
```
→ Full reference: `@references/gmail.md`

### Calendar
```bash
gwcli calendar events list --params '{"calendarId":"primary","timeMin":"<ISO>","timeMax":"<ISO>"}'
gwcli calendar events insert --params '{"calendarId":"primary"}' --json '<event-json>'
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
> **Keep requires a Google Workspace identity.** On a personal `@gmail.com`
> account the Keep API is gated and returns 403; `gwcli` auto-drops the `keep`
> scope at auth time for such accounts. Treat Keep as available only for
> Workspace (managed-domain) profiles.
```bash
gwcli keep notes list --params '{"pageSize":25}'
gwcli keep notes get --params '{"name":"notes/<note-id>"}'
gwcli keep notes create --json '{"title":"Note Title","body":{"text":{"text":"Content"}}}'
gwcli keep notes delete --params '{"name":"notes/<note-id>"}'
```
→ Full reference: `@references/keep.md`

### Tasks
```bash
gwcli tasks tasklists list --params '{"maxResults":20}'
gwcli tasks tasks list --params '{"tasklist":"@default","showCompleted":false}'
gwcli tasks tasks insert --params '{"tasklist":"@default"}' --json '{"title":"New task","due":"<ISO>"}'
gwcli tasks tasks patch --params '{"tasklist":"<id>","task":"<id>"}' --json '{"status":"completed"}'
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

### What `gwcli profiles auth <name>` actually does (and why agents still need a shared browser)

- **No interactive scope picker in this flow.** `gwcli profiles auth`
  resolves the profile's stored scopes (or an explicit `--scopes`) and passes
  them to gws as `--services`, which skips gws's interactive scope picker
  entirely. gwcli also *refuses* to run without scopes in a non-TTY
  environment (a clear error, not a silent hang), so an agent never lands on a
  picker that needs a keyboard `\r`. The auth flow is non-interactive on the
  terminal side right up to the browser hand-off.
- **gwcli auto-launches the OS default browser** (incognito, isolated
  per-launch) the moment it detects the OAuth URL. On a human's graphical
  machine that is the whole point. **For an agent it is useless or
  counterproductive:** the agent has no OS GUI session it controls, so that
  auto-opened tab is a dead window. The agent's job is to grab the URL that
  gwcli *also tees to the terminal* and drive it in the **shared cloak-cdp
  window** instead — then ignore (or close) the stray OS tab.
- gws still prints the URL and holds a localhost callback server on a
  **dynamic port** (e.g. `127.0.0.1:36767`) until the flow completes, so the
  hand-off target is the same regardless of which browser opens it.

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

- **Agent-driven (preferred when agent has `terminal` tool)**: run the auth
  command directly and capture the URL from its output. Because scopes are
  passed via `--services`, there is no picker to confirm — the command runs to
  the URL hand-off with zero keystrokes, then blocks on the localhost callback
  until you finish OAuth in the shared browser.
  ```bash
  gwcli profiles auth <name> > /tmp/gwauth.log 2>&1 &   # backgrounded
  # grep the printed consent URL, then drive cloak-cdp to it:
  grep -o 'https://accounts.google.com/o/oauth2/[^ ]*' /tmp/gwauth.log
  # gwcli also auto-opens an OS browser tab — ignore/close it; it is NOT the
  # shared window. Watch the log for "Authentication successful".
  ```
  An optional convenience wrapper, `@scripts/drive_gwcli_auth.py <name>`,
  captures the URL on a `[driver] URL_CAPTURED ` line and holds the process
  open for a fixed 10-minute window. It is **not required to get past a
  picker** (there is none for a scoped profile) — use it only if you want the
  tagged-line capture or the fixed deadline. Install with `cp` to
  `~/.local/bin/`.

- **User-driven (fallback when no terminal access)**: ask the user to run it
  in a real terminal:
  ```bash
  gwcli profiles auth <name>
  # No picker prompt. It prints "Open this URL in your browser to
  # authenticate: https://..." and auto-opens the OS browser.
  ```
  User pastes the URL back to the agent (or, if they prefer their own
  browser, just completes the login in the auto-opened window).

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
- **Ignore the auto-opened OS browser tab.** gwcli opens the consent URL in
  the OS default browser (incognito) as soon as it detects it. In the
  agent/shared-cdp flow that tab is a dead end the agent can't see — drive the
  captured URL in the cloak-cdp window instead and close/ignore the OS tab.
  Don't confuse it with the shared window.
- **PTY EOF ≠ child death (only relevant if you use `drive_gwcli_auth.py`).**
  When the gwcli wrapper finishes its foreground output the PTY master can see
  EOF while gws still listens on the callback port. A naive driver that bails
  on the first empty `read()` would kill gws before the callback fires,
  leaving credentials.enc untouched. The bundled script guards against this
  (checks `waitpid WNOHANG` before bailing).
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
  # no picker — grab the printed URL, drive the shared browser, log in, repeat
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
