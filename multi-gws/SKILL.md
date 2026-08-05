---
name: multi-gws
description: |
  Google Workspace access for AI agents — Gmail, Calendar, Drive, Docs, Sheets,
  Slides, Tasks, Keep, People/Contacts, Chat, Meet, Forms (plus opt-in Classroom
  & Admin Reports). Multi-account profiles (personal, work, client-X). Auto-installs dependencies.

  Use when: reading/sending email, managing calendar events, searching Drive,
  accessing Google Docs/Sheets/Slides, contacts, Chat, Meet, or Forms, or any
  Google Workspace task for a specific user account.
argument-hint: "[service] [action] [--profile name] [--format json]"
license: MIT
metadata:
  version: "2.5.0"
  tags: "google, workspace, gmail, calendar, drive, docs, sheets, slides, keep, tasks, people, contacts, chat, meet, forms, classroom, admin-reports, multi-account"
  requires-bins: "node, mgws"
  homepage: "https://github.com/dewdad/multi-gws"
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
   `mgws <cmd> --help` (and/or `mgws setup` to update `gws`) and **trust its
   output over this document.** Adjust and proceed — then, per the
   `self-improving` protocol, fix the doc.
3. **Live state, not memory:** for facts about the system — which profiles
   exist, auth validity, versions, readiness — **query the CLI**
   (`mgws profiles list --format json`, `profiles status --strict`,
   `preflight --json`, `doctor`) rather than assuming. These are authoritative
   and self-updating; prose goes stale.

What this doc still owns (the CLI can **not** self-report these — don't expect
`--help` to reveal them): **operational gotchas** (e.g. `--upload` is CWD-only,
the keyring line on stderr, same-profile parallelism corrupts the token cache,
Keep 403s on @gmail.com), the **interactive OAuth / shared-browser flow**, and
**decision policy** (draft-vs-send, cross-account safety). Treat the gotcha and
policy sections as canonical; treat the flag/command surface as a cached hint
that `--help` can override.

> **`gws` passthrough output is JSON by default.** Native mgws commands (`profiles list`, `profiles status`) emit JSON when stdout is piped, table when interactive — pass `--format json` to force JSON unconditionally.
>
> **Parsing output (important).** The JSON payload is written to **stdout**; a
> `Using keyring backend: file` line is written to **stderr**. When a caller
> merges the two streams (`2>&1`, some subprocess wrappers), that line prefixes
> the JSON and naive `JSON.parse` / `json.loads` fails on
> `Expecting value: line 1 column 1`. Fix: capture **stdout only** (or append
> `2>/dev/null`), or strip any leading non-JSON line before parsing.

## Step 0 — Preflight (MANDATORY, every invocation)

```bash
mgws preflight
```

Exit `0` + silent = ready. On non-zero, mgws writes nothing — re-run with `--json` for a machine-readable diagnosis:

```bash
mgws preflight --json
```

### Preflight exit codes (mgws-namespaced, range 60–69)

| Exit | Meaning | Action |
|------|---------|--------|
| `0` | ready | proceed |
| `63` | `gws` binary missing/outdated | `mgws setup` (installs/upgrades `gws` to latest by default) |
| `64` | no profiles configured | see "Account Setup" below |
| `127` (or "command not found") | `mgws` itself not installed | `npm install -g github:dewdad/multi-gws`, then re-run |

> **These are distinct from runtime exit codes** (1, 2) emitted by `gws` API calls. See [`references/troubleshooting.md`](references/troubleshooting.md) for the full table.

**Do NOT announce preflight to the user.** Only speak if remediation is needed.

## Step 0a — Install & keep current (activation step)

On **first activation** (or whenever preflight returns `63`/`127`):

```bash
# Only if `mgws` itself is missing from PATH:
npm install -g github:dewdad/multi-gws

# Install/repair config dirs AND pull the LATEST `gws` binary (default behavior).
# Run this as part of skill activation so `gws` never drifts behind the docs.
mgws setup               # idempotent; installs latest gws. Add --json for machine output.
# Pin a specific version if ever needed: mgws setup --gws-version <version>
```

`mgws setup` is idempotent — safe to re-run. It installs the **latest** `gws`
release by default (pin with `--gws-version <version>`); run it on activation
and any time preflight flags `gws` as outdated (exit `63`) so the binary stays
current with these docs. Confirm with `mgws doctor`, which prints both `mgws`
and `gws` versions.

> **Version hygiene.** The reference examples are written against **gws 0.22.x**.
> If a command errors with `unexpected argument` for a documented flag, first
> run `mgws setup` (installs latest) and re-check `<command> --help` — the flag surface
> is the source of truth. (Body = `--json`; there is no `--body`/`--fields`
> flag; field masks live inside `--params`.)

> `mgws` is distributed via GitHub (npm clones + builds on install — requires git on PATH). It is not currently published to the npm registry.

## Account Setup (first-time or new account)

Agents MUST know the user's Google accounts. Check existing profiles first:

```bash
mgws profiles list --format json
```

If no profiles or user requests a new account:

1. **Ask the user** for: account nickname (e.g. `work`, `personal`) and which services they need
2. A custom OAuth client secret JSON is **optional** — `mgws` ships a built-in Desktop client, so onboarding works with no `--client`. Provide `--client <path>` only to use your own / verified OAuth app — see `@references/oauth-bootstrap.md` (Google deprecated post-creation secret retrieval; one-shot capture).
3. **Preferred one-step path — `mgws init`.** It ensures `gws` is installed, creates the profile, authenticates, and auto-sets it as default when it's the first. It is non-interactive in a non-TTY (agent/CI): pass a name and flags; it never hangs on a prompt. Add `--json` for a machine-readable summary.
```bash
# One command: ensure gws → create profile → authenticate → set default (built-in client, default services)
mgws init <name>

# Non-interactive with an explicit scope set + JSON summary (agent/CI)
mgws init <name> --scopes gmail,calendar,drive --json --yes

# Your own OAuth client / full access
mgws init <name> --client <path-to-client-secret.json>
mgws init <name> --full
```
   Equivalent lower-level path if `gws` is already installed (`profiles add` skips the setup pre-check):
```bash
# Default services (gmail, calendar, drive, docs, sheets, slides, tasks, keep, people, chat, meet, forms), built-in client
mgws profiles add <name>
mgws profiles add <name> --client <path-to-client-secret.json>   # your own OAuth client
mgws profiles add <name> --scopes gmail,calendar,drive           # restrict scopes (+ opt-in: classroom, admin-reports)
mgws profiles add <name> --full                                  # ALL scopes (incl. Pub/Sub + Cloud Platform)
```
4. This opens a browser — the user authenticates. Tokens are stored locally.
5. **The first profile is auto-set as default** by both `init` and `profiles add`. Only run `mgws profiles set-default <name>` to change the default later.

> **⚠ Testing-mode scope limit — pick the auth strategy BEFORE choosing scopes.** An unverified OAuth app (consent screen in "Testing") is capped by Google at **~25 OAuth scopes**. Each service maps to several scopes, so the built-in client can only safely grant roughly the default set; more than the default, any `classroom`/`admin-reports`, or `--full` will exceed the cap and consent fails. `mgws` now checks this **before** attempting consent (`willExceedScopeCap`) and gates accordingly. Route by account type:
>
> | Account | Broad / `--full` scopes? | Do this |
> |---------|--------------------------|---------|
> | Personal `@gmail.com` | not possible on the built-in client | keep to the default or a narrowed `--scopes`; **do not** use `--full` (consent will fail — the app can't be made Internal) |
> | Workspace (managed domain) | yes | use an existing **Internal** OAuth client via `--client <path>` or `MGWS_CLIENT_ID`/`MGWS_CLIENT_SECRET`; **if none exists yet, CREATE one** — the Internal app is cap-exempt and needs no verification. Automate its creation + `client_secret.json` capture over CDP with `@references/oauth-client-automation.md` (drives Edge/Chrome on a dedicated automation profile), then pass the captured path to `--client`. Do **not** fall back to the built-in client with `--full` — it will fail the cap |
>
> What the gate does when an over-cap request has no `--client`:
> - **Human at a real terminal** → interactive walkthrough: prints Internal-client setup steps and prompts for the `client_secret.json` path, then authenticates with it.
> - **Agent / CI / `--json` (non-TTY)** → never blocks; fails fast with `SCOPE_CAP_EXCEEDED`. Recover by re-running with `--client <path>`, a narrower `--scopes`, or `MGWS_CLIENT_ID`/`MGWS_CLIENT_SECRET` set.
>
> See `@references/oauth-bootstrap.md` § "Automatic prompt when you exceed the ~25-scope cap" and `@references/profiles.md`.

> **Scopes are immutable on a profile.** To change scopes later, use `mgws profiles rescope <name> --add drive` (or `--remove`, `--set`, `--full`) — it removes + re-adds + re-auths in one step, preserving the display name and any custom OAuth client. `profiles auth` re-uses the existing scope set (including a stored `--full` grant) without changing it.

**Profile selection priority:** `--profile` flag > `MGWS_PROFILE` env > configured default.

## Command Router

All commands follow: `mgws [--profile <name>] <service> <resource> <action> --params '<json>' [--json '<request-body>'] [--upload <path> --upload-content-type <mime>]`

> **Flag surface (gws 0.22.x — verified via `--help`).** Query/URL params →
> **`--params`**. Request **body** → **`--json`** (there is NO `--body` flag).
> **Field masks** go **inside** `--params` as a `"fields"` key (there is NO
> `--fields` flag). Binary content (attachments/uploads) → **`--upload`** +
> `--upload-content-type`; note `--upload` accepts only a **relative path inside
> the current working directory** (cd first). If a documented flag errors with
> `unexpected argument`, run `mgws setup` to update `gws` and check `--help`.

### Gmail
```bash
mgws gmail users messages list --params '{"userId":"me","maxResults":20}'
mgws gmail users messages get --params '{"userId":"me","id":"<msg-id>"}'
mgws gmail users messages send --params '{"userId":"me"}' --json '{"raw":"<base64>"}'
mgws gmail users drafts create --params '{"userId":"me"}' --json '<request-body>'
```
→ Full reference: `@references/gmail.md`

### Calendar
```bash
mgws calendar events list --params '{"calendarId":"primary","timeMin":"<ISO>","timeMax":"<ISO>"}'
mgws calendar events insert --params '{"calendarId":"primary"}' --json '<event-json>'
mgws agenda --days 7                                    # native shortcut: events for next N days
mgws --profile work agenda --days 1                     # today's work events
```
→ Full reference: `@references/calendar.md`

### Drive
```bash
mgws drive files list --params '{"pageSize":20}'
mgws drive files get --params '{"fileId":"<id>"}'
mgws drive files export --params '{"fileId":"<id>","mimeType":"text/plain"}'
```
→ Full reference: `@references/drive.md`

### Keep
> **Keep requires a Google Workspace identity.** On a personal `@gmail.com`
> account the Keep API is gated and returns 403; `mgws` auto-drops the `keep`
> scope at auth time for such accounts. Treat Keep as available only for
> Workspace (managed-domain) profiles.
```bash
mgws keep notes list --params '{"pageSize":25}'
mgws keep notes get --params '{"name":"notes/<note-id>"}'
mgws keep notes create --json '{"title":"Note Title","body":{"text":{"text":"Content"}}}'
mgws keep notes delete --params '{"name":"notes/<note-id>"}'
```
→ Full reference: `@references/keep.md`

### Tasks
```bash
mgws tasks tasklists list --params '{"maxResults":20}'
mgws tasks tasks list --params '{"tasklist":"@default","showCompleted":false}'
mgws tasks tasks insert --params '{"tasklist":"@default"}' --json '{"title":"New task","due":"<ISO>"}'
mgws tasks tasks patch --params '{"tasklist":"<id>","task":"<id>"}' --json '{"status":"completed"}'
```
→ Full reference: `@references/tasks.md`

### Docs & Sheets & Slides
```bash
mgws docs documents get --params '{"documentId":"<id>"}'
mgws sheets spreadsheets get --params '{"spreadsheetId":"<id>"}'
mgws sheets spreadsheets values get --params '{"spreadsheetId":"<id>","range":"Sheet1!A1:C10"}'
mgws slides presentations get --params '{"presentationId":"<id>"}'
```
→ Docs/Sheets share the router pattern in `@references/drive.md`; Slides mirrors it.

### People / Contacts, Chat, Meet, Forms
```bash
mgws people people connections list --params '{"resourceName":"people/me","personFields":"names,emailAddresses"}'
mgws chat spaces list --params '{}'
mgws chat spaces messages create --params '{"parent":"spaces/<id>"}' --body '{"text":"Hello"}'
mgws meet spaces get --params '{"name":"spaces/<id>"}'
mgws forms forms get --params '{"formId":"<id>"}'
```
> These follow the same `mgws <service> <resource> <action>` passthrough. Argument shapes come from `gws` — run `mgws <service> --help` or see the [`gws` docs](https://github.com/googleworkspace/cli). `classroom` and `admin-reports` are also available but require `--scopes classroom` / `--scopes admin-reports` at profile-add time (not in the default set).

### Profile Management
```bash
mgws init <name>                         # one-step: ensure gws + add + auth + auto-default (built-in client)
mgws profiles list --format json
mgws profiles add <name>                                                # default mainstream services (12), built-in client
mgws profiles add <name> --client <path>                                # your own OAuth client
mgws profiles add <name> --scopes gmail,calendar,drive                  # restricted
mgws profiles add <name> --full                                         # ALL scopes (incl. Pub/Sub + Cloud Platform)
mgws profiles remove <name> --force      # --force is REQUIRED (non-interactive)
mgws profiles set-default <name>         # first profile is auto-default; use this to change it
mgws profiles auth <name>                # re-authenticate (re-uses existing scopes; --full re-uses full grant)
mgws profiles auth <name> --full         # re-authenticate requesting ALL scopes
mgws profiles reauth                     # re-auth ALL profiles, serialized (add --stale-only to skip valid tokens)
mgws profiles rescope <name> --add drive # change scopes (remove + re-add + re-auth); also --remove/--set/--full
mgws profiles status --format json --strict   # exits 2 if ANY profile unauthenticated
mgws doctor                              # full health check
mgws migrate --client <path>             # migrate v1 profiles to v2 layout
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
3. Preflight exit `63`/`64` → run `mgws setup` or add a profile (see Step 0)
4. Onboarding error `SCOPE_CAP_EXCEEDED` (from `init`/`profiles add`/`profiles rescope`) → the request exceeds the built-in client's ~25-scope cap. Re-run with `--client <path>` (an Internal Workspace / verified OAuth client), a narrower `--scopes`, or with `MGWS_CLIENT_ID`/`MGWS_CLIENT_SECRET` set. On a managed domain with **no Internal client yet**, create one (cap-exempt) and capture its `client_secret.json` over CDP via `@references/oauth-client-automation.md`, then pass that path to `--client`. See "Account Setup" above.
5. Run `mgws doctor` for systematic diagnosis

> **Structured errors for agents.** `mgws init --json` and `mgws profiles add --json` emit any failure as a JSON object on **stdout** — `{ "success": false, "error": "<CODE>", "message": ..., "suggestion": ... }` — so you can branch on the stable `error` code (e.g. `SCOPE_CAP_EXCEEDED`, `AUTH_FAILED`) instead of scraping stderr prose.

→ Full reference: `@references/troubleshooting.md`

## Re-authenticating expired tokens (the shared-CDP flow)

When `mgws profiles status --strict` exits non-zero or any API call returns
`invalid_grant: Token has been expired or revoked`, the profile needs a fresh
OAuth round-trip. **This is interactive — the user has to log in to Google in a
real browser.** The clean way to run it with a Hermes agent in the loop:

### What `mgws profiles auth <name>` actually does (and why agents still need a shared browser)

- **No interactive scope picker in this flow.** `mgws profiles auth`
  resolves the profile's stored scopes (or an explicit `--scopes`) and passes
  them to gws as `--services`, which skips gws's interactive scope picker
  entirely. mgws also *refuses* to run without scopes in a non-TTY
  environment (a clear error, not a silent hang), so an agent never lands on a
  picker that needs a keyboard `\r`. The auth flow is non-interactive on the
  terminal side right up to the browser hand-off.
- **mgws auto-launches the OS default browser** (incognito, isolated
  per-launch) the moment it detects the OAuth URL. On a human's graphical
  machine that is the whole point. **For an agent it is useless or
  counterproductive:** the agent has no OS GUI session it controls, so that
  auto-opened tab is a dead window. The agent's job is to grab the URL that
  mgws *also tees to the terminal* and drive it in the **shared cloak-cdp
  window** instead — then ignore (or close) the stray OS tab.
- gws still prints the URL and holds a localhost callback server on a
  **dynamic port** (e.g. `127.0.0.1:36767`) until the flow completes, so the
  hand-off target is the same regardless of which browser opens it.

### The right workflow

```
┌──────────────┐      ┌─────────────────┐      ┌────────────────┐
│ User's       │      │ User runs       │      │ Agent driving  │
│ terminal A   │      │ mgws auth      │      │ cloak-cdp      │
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
  mgws profiles auth <name> > /tmp/gwauth.log 2>&1 &   # backgrounded
  # grep the printed consent URL, then drive cloak-cdp to it:
  grep -o 'https://accounts.google.com/o/oauth2/[^ ]*' /tmp/gwauth.log
  # mgws also auto-opens an OS browser tab — ignore/close it; it is NOT the
  # shared window. Watch the log for "Authentication successful".
  ```
  An optional convenience wrapper, `@scripts/drive_mgws_auth.py <name>`,
  captures the URL on a `[driver] URL_CAPTURED ` line and holds the process
  open for a fixed 10-minute window. It is **not required to get past a
  picker** (there is none for a scoped profile) — use it only if you want the
  tagged-line capture or the fixed deadline. Install with `cp` to
  `~/.local/bin/`.

- **User-driven (fallback when no terminal access)**: ask the user to run it
  in a real terminal:
  ```bash
  mgws profiles auth <name>
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
mgws profiles status --format json --strict <name>   # token_valid:true
mgws --profile <name> agenda --days 1                # actually hits API
```
Note: `mgws profiles status` returns `authenticated: true` even with revoked
tokens — only the `details.token_valid` field reflects real grant state.
Always check that field or run a smoke API call.

### Pitfalls

- **`browser_*` tools must be attached to the visible window before step 4.**
  Otherwise `browser_navigate` opens the URL in headless agent-browser the
  user can't see → flow stalls. Use `hermes config set browser.cdp_url
  http://127.0.0.1:9222` (any context) or `/browser connect` (CLI only).
- **Ignore the auto-opened OS browser tab.** mgws opens the consent URL in
  the OS default browser (incognito) as soon as it detects it. In the
  agent/shared-cdp flow that tab is a dead end the agent can't see — drive the
  captured URL in the cloak-cdp window instead and close/ignore the OS tab.
  Don't confuse it with the shared window.
- **PTY EOF ≠ child death (only relevant if you use `drive_mgws_auth.py`).**
  When the mgws wrapper finishes its foreground output the PTY master can see
  EOF while gws still listens on the callback port. A naive driver that bails
  on the first empty `read()` would kill gws before the callback fires,
  leaving credentials.enc untouched. The bundled script guards against this
  (checks `waitpid WNOHANG` before bailing).
- **The callback port is dynamic** — extract from the URL gws prints, don't
  hardcode 8080/9090.
- **CSRF state token is single-use.** If the URL expires (user too slow,
  multi-tab confusion), re-run `mgws profiles auth <name>` to mint a fresh URL.
- **Persistent profile speeds up subsequent auths.** After first OAuth, the
  cloak-cdp profile remembers the Google session — re-authing the same
  account skips password+2FA, often skips consent too.
- **Unverified-app warning** ("Google hasn't verified this app") appears for
  user-created OAuth clients on every fresh consent. Click `Advanced` →
  `Go to <app> (unsafe)`. Skill `multi-gws` deliberately doesn't
  hide this — confirm with the user before clicking.
- **Multiple browser tabs confuse `browser_console`.** Hermes's CDP tab
  selection isn't deterministic when multiple pages exist. To find which
  tab has the OAuth flow, use `curl http://127.0.0.1:9222/json` — it lists
  all tabs with URLs and titles.
- **Driver deadline.** `drive_mgws_auth.py` has a 10-minute deadline. For
  accounts requiring fresh password+2FA+passkey (especially "Use another
  account" flows), 2 minutes was insufficient and silently killed gws
  before callback. Bump it further if needed for slow 2FA paths.
- **Bulk re-auth: serialize, don't parallelize.** Each `mgws profiles auth`
  spawns its own callback port and consumes the visible browser window.

### Quick command for the user

When several profiles need re-auth at once (token expiry often hits every
profile on the same client simultaneously), use the native serial helper — it
walks every profile (or only stale ones), re-using each profile's stored
scopes so there is no picker:
```bash
mgws profiles reauth               # re-auth ALL profiles, one at a time
mgws profiles reauth --stale-only  # skip profiles whose token is still valid
# For each profile: grab the printed URL, drive the shared browser, log in; it advances to the next.
```
Equivalent manual loop if you need per-profile control:
```bash
for p in profile-a profile-b profile-c; do   # your profile names
  echo "=== $p ==="
  mgws profiles auth "$p"
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
To mitigate, avoid spurious `mgws profiles auth` runs unless necessary.

Polling the API does NOT keep refresh tokens alive — the access-token
refresh that happens silently on every API call is unrelated to the
factors that revoke refresh tokens. A "ping cron" is wasted compute.

### Health-check cron (recommended pattern)

Set up a weekly silent watchdog that runs `mgws profiles status --strict`
across your profiles and only speaks up when a profile's `token_valid` flips
false — delivering the exact remediation command (`mgws profiles auth <name>`)
when it does. Silent on success keeps it noise-free. Schedule it for a time you
can act on the alert (e.g. Monday morning), since re-auth needs an interactive
browser login.

→ Full reference: `@references/troubleshooting.md`

## Self-Improvement Protocol

If you discover an inaccuracy in this skill (wrong command, missing flag, broken example), edit the relevant file directly using your file-editing tools. Keep changes minimal and run `mgws doctor` to confirm the change doesn't break anything.

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
- **Automated OAuth client creation (Workspace, CDP/Edge)**: Load `@references/oauth-client-automation.md`
- **Debugging**: Load `@references/troubleshooting.md`
- **Never load all references at once** — load only what's needed for the current task
