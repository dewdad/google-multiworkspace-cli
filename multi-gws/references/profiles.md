# Profile Management

Profiles are named Google accounts. Each profile stores OAuth credentials independently, enabling multi-account workflows (personal email + work calendar + client-X drive, all in one session).

## Concepts

- **Profile** = named credential set (like AWS CLI profiles)
- **Config dir** = `~/.config/mgws/` (Linux/Mac) or `%APPDATA%\mgws\` (Windows)
- **Resolution order**: `--profile` flag → `MGWS_PROFILE` env → default profile → error

## On-disk layout (managed by the CLI — do not hand-edit)

```
<config-dir>/
├── config.json                 # global: version, defaultProfile, gwsBinary, settings
└── profiles/
    └── <profile-name>/
        ├── meta.json           # name, displayName, email, scopes, createdAt,
        │                       #   lastUsed, clientSecretSource, tags[]
        └── gws/                # per-profile, isolated credential store
            ├── credentials.enc
            ├── .encryption_key
            ├── client_secret.json
            ├── token_cache.json
            └── cache/          # per-API discovery cache (gmail_v1.json, …)
```

Each profile is fully self-contained under `profiles/<name>/`, which is what
makes cross-profile parallelism safe (see Concurrency Rules). **Never move,
rename, or edit these files by hand** — use `mgws profiles rename` / `remove`
so `config.json` (e.g. `defaultProfile`) stays consistent. To relocate the whole
store, set `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` / the mgws config dir rather than
moving directories.

## Profile organization & naming conventions

Profile **names** are the primary organizational handle (they're what you type
in `--profile`), so keep them short, lowercase, and predictable. A good scheme
for multi-account / multi-project setups:

- **By role/owner:** `personal`, `work`, `avital`, `ops`.
- **By client/project (namespaced):** `client-acme`, `client-globex`,
  `proj-zikhron`. A `<kind>-<slug>` prefix keeps related accounts grouped
  alphabetically in `profiles list`.
- **One identity per profile.** Don't reuse a profile for two Google accounts —
  add a second profile. Credentials are isolated per profile by design.

Attach a human label with **`--display-name`** at add time (stored in
`meta.json.displayName`, shown in `profiles list`) so a terse name like
`proj-zikhron` still reads clearly:

```bash
mgws profiles add proj-zikhron --client ./secret.json --display-name "Zikhron build (avitalidit@gmail.com)"
```

Housekeeping tips:
- The **first profile is auto-set as default** (by both `mgws init` and
  `mgws profiles add`). Use `mgws profiles set-default <name>` only to switch
  the default to a different, most-used profile; pass `--profile` for exceptions.
- `meta.json` records `email`, `scopes`, `lastUsed`, and a `tags[]` array. `tags`
  is currently populated by the CLI/metadata (there is **no `--tags` flag** on
  `add` as of gws 0.22.x) — treat it as read-only metadata for now, and rely on
  the naming/`--display-name` scheme above for organization.
- Rename freely with `mgws profiles rename <old> <new>` if a scheme evolves —
  it updates `config.json` references for you.

## Commands

### List All Profiles
```bash
mgws profiles list --format json
```
Returns:
```json
[
  {"name": "personal", "email": "me@gmail.com", "scopes": ["gmail","calendar","drive"], "authenticated": true, "isDefault": true},
  {"name": "work", "email": "me@company.com", "scopes": ["gmail","calendar"], "authenticated": true, "isDefault": false}
]
```

### One-Step Onboarding (preferred)
```bash
mgws init <name> [--scopes <list> | --full] [--client <path>] [--display-name "My Work"] [--json] [--yes]
```
`init` ensures `gws` is installed, creates the profile, authenticates, and auto-sets it as default when it's the first. It is **non-interactive in a non-TTY** (agent/CI): pass a name + flags and it never hangs on a prompt; in a real terminal it prompts for the name/services when omitted. `--json` emits a summary. It's idempotent — an existing profile is re-authed rather than recreated.

### Add a New Profile
```bash
mgws profiles add <name> [--client <path-to-oauth-json>] [--scopes <list> | --full] [--display-name "My Work"]
```

**`--client` is optional.** `mgws` ships a built-in Desktop OAuth client, so `profiles add <name>` works with no client file. Provide `--client <path>` only to use your own / verified OAuth app — see [`oauth-bootstrap.md`](oauth-bootstrap.md) (Google's "Download JSON" modal is one-shot; capture in a real browser, not headless automation). `profiles add` assumes `gws` is already installed; `mgws init` bundles the setup pre-check.

If the OAuth flow fails (timeout, browser closed, consent declined), both `init` and `profiles add` roll back automatically — the partial profile directory is removed so you can retry with the same name.

**Default scopes** (granted when `--scopes` is omitted) — mainstream Workspace user services:
`gmail,calendar,drive,docs,sheets,slides,tasks,keep,people,chat,meet,forms`

**Opt-in extras** (available via `--scopes`, NOT in the default): `classroom`, `admin-reports` — education- / admin-only, and each pulls in scopes a typical account can't consent to.

**Full access** — `--full` requests EVERY scope (incl. Pub/Sub + Cloud Platform) via `gws auth login --full`. It overrides `--scopes`. The grant is stored so `profiles auth` re-requests it on re-auth.

```bash
# All mainstream services (default), built-in client — no --client needed
mgws profiles add personal

# Restricted set
mgws profiles add work --scopes gmail,calendar,drive

# Include an opt-in extra
mgws profiles add edu --scopes gmail,drive,classroom

# Everything
mgws profiles add admin --full

# Your own / verified OAuth client (optional)
mgws profiles add corp --client ~/client.json --scopes gmail,calendar
```

> **⚠ Testing-mode scope limit.** Google caps consent for an **unverified** OAuth app (consent screen in "Testing") at **~25 OAuth scopes**. Each service maps to several scopes, so:
> - the default set already sits near the ceiling;
> - adding `classroom`/`admin-reports` or using `--full` will typically **exceed 25 and fail consent** — most visibly on personal `@gmail.com` accounts.
>
> Remedies: narrow the request with `--scopes`, or get the OAuth app **verified** (or use an Internal Workspace app, which is exempt).

After creating, the CLI opens a browser for OAuth consent. The user must authenticate.

### Remove a Profile
```bash
mgws profiles remove <name> --force
```
**`--force` is required** — the command refuses to delete without it (no interactive prompts in CLI mode). Deletes credentials and metadata. Irreversible.

### Rename a Profile
```bash
mgws profiles rename <old> <new>
```

### Set Default Profile
```bash
mgws profiles set-default <name>
```

### Re-authenticate (refresh expired tokens)
```bash
mgws profiles auth <name>                       # uses the profile's stored scopes
mgws profiles auth <name> --scopes gmail,calendar  # override (still subject to immutability rule below)
mgws profiles auth <name> --full                # re-authenticate requesting ALL scopes
mgws profiles reauth                            # re-auth ALL profiles, serialized
mgws profiles reauth --stale-only               # only profiles whose token is invalid/expired
```
Opens a browser for a fresh OAuth flow. Use when tokens expire. `profiles reauth` walks every profile one at a time (never in parallel — each auth grabs its own callback port + the shared browser window), re-using each profile's stored scopes so there's no picker; `--stale-only` probes `gws auth status` and skips profiles whose token is still valid.

> **`profiles auth` reuses the existing scope set.** It does **not** prompt for new scopes. A profile created with `--full` stores a full-access sentinel and is automatically re-authenticated with `--full`. To **change** the scope set, use `mgws profiles rescope <name> --add <svc>` (or `--remove`/`--set`/`--full`) — it removes + re-adds + re-auths in one step, preserving the display name and any custom OAuth client.

> **Non-TTY behavior.** `profiles auth` always passes `--services` to the underlying gws so the interactive scope picker is bypassed. In CI / agent / `Start-Process`-style environments where stdin is not a TTY, the command refuses to run if no stored or `--scopes` value is available — it would otherwise hang forever waiting for keystrokes that never arrive.

### Check Auth Status
```bash
mgws profiles status <name>                       # single profile (gws JSON output)
mgws profiles status                              # all profiles (table when TTY, JSON when piped)
mgws profiles status --format json                # force JSON for all
mgws profiles status --format json --strict       # exits 2 if ANY profile is unauthenticated
```

The `--strict` flag is the recommended pre-flight for bulk multi-account operations: run it first, fix any unauthenticated profiles, then proceed.

## Multi-Account Workflows

### Using Specific Profile for One Command
```bash
mgws --profile work gmail users messages list --params '{"userId":"me","maxResults":5}'
```

### Environment Variable Override
```bash
# POSIX
MGWS_PROFILE=personal mgws agenda --days 3

# PowerShell
$env:MGWS_PROFILE = "personal"; mgws agenda --days 3
```

### Cross-Account Operations

```bash
# POSIX (bash/zsh)
work_emails=$(mgws --profile work gmail users messages list --params '{"userId":"me","q":"meeting invite","maxResults":1}')
mgws --profile personal calendar events insert --params '{"calendarId":"primary"}' --json '<event>'
```

```powershell
# PowerShell
$work_emails = mgws --profile work gmail users messages list --params '{"userId":"me","q":"meeting invite","maxResults":1}'
mgws --profile personal calendar events insert --params '{"calendarId":"primary"}' --json '<event>'
```

### Concurrency Rules

- **Cross-profile parallelism is safe.** Each profile gets an isolated `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` per spawn.
- **Same-profile parallelism is NOT safe.** The file-keyring backend stores tokens as plain JSON; concurrent invocations against the same profile can race during token refresh and corrupt the cache. Serialize same-profile commands.

## Advanced Configuration

The global config file (`~/.config/mgws/config.json` on Linux/Mac, `%APPDATA%\mgws\config.json` on Windows) supports:

```json
{
  "version": 1,
  "defaultProfile": "personal",
  "gwsBinary": "gws",
  "settings": {
    "defaultFormat": "json",
    "annotateProfile": false
  }
}
```

- **`gwsBinary`** — absolute path or PATH-resolvable name. Set to a non-default location for monorepo `node_modules/.bin/gws`, Docker-mounted binaries, or pinned versions.
- **`defaultProfile`** — used when neither `--profile` nor `MGWS_PROFILE` is set.
- **`settings.defaultFormat`** — passed to gws for passthrough commands.

## OAuth Client Setup Guide (for helping users)

1. Go to https://console.cloud.google.com/
2. Create project or select existing
3. Enable APIs you need (**each service's API must be enabled in the project, or its scopes fail consent**):
   - Default set: Gmail API, Google Calendar API, Google Drive API, Google Docs API, Google Sheets API, Google Slides API, Google Tasks API, People API (Contacts), Google Chat API, Google Meet API, Google Forms API
   - Opt-in extras: Google Classroom API, Admin SDK / Reports API (`admin-reports`)
   - `--full` additionally requires Cloud Pub/Sub API + `cloud-platform` scope — only enable if you actually use full access.
   - **Google Keep API** is **enterprise/Workspace-only** and requires special enablement (the consumer Keep API is not exposed). See [`keep.md`](./keep.md) for details.
4. Go to **APIs & Services > Credentials**
5. Click **Create Credentials > OAuth client ID**
6. Application type: **Desktop app**
7. Download the JSON file
8. Provide path to: `mgws profiles add <name> --client <downloaded-file.json>`

> **About `gws`:** The underlying tool (`@googleworkspace/cli`) is community-maintained and explicitly not an officially supported Google product. Major API changes in `gws` releases can affect this skill. If commands break after a `gws` upgrade, run `mgws doctor` and check the [troubleshooting reference](./troubleshooting.md).

### gws version compatibility

| gws range | Status | Notes |
|-----------|--------|-------|
| `< 0.20.0` | Not supported | `mgws setup` rejects with "below minimum" error |
| `0.20.x – 0.22.x` | Tested | Current reference target |
| `0.23.x +` | Best-effort | Likely works; watch for breaking changes in `gws --help` |
| `1.0.0 +` | Unknown | Future major; verify with `mgws doctor` and the gws changelog before relying on it |

The minimum is enforced in `mgws setup`. Other versions degrade gracefully — if a specific gws command surface changes, the mgws passthrough still forwards arguments verbatim, so the user only sees gws's own error message.

## Troubleshooting Profiles

| Symptom | Cause | Fix |
|---------|-------|-----|
| "No profile specified" | No default, no --profile | `mgws profiles set-default <name>` |
| "Profile not authenticated" | Tokens missing/expired | `mgws profiles auth <name>` |
| "Profile corrupted" | Missing meta.json | Remove + re-add the profile |
| "Invalid grant" | OAuth revoked externally | `mgws profiles auth <name>` |
