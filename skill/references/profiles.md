# Profile Management

Profiles are named Google accounts. Each profile stores OAuth credentials independently, enabling multi-account workflows (personal email + work calendar + client-X drive, all in one session).

## Concepts

- **Profile** = named credential set (like AWS CLI profiles)
- **Config dir** = `~/.config/gwcli/` (Linux/Mac) or `%APPDATA%\gwcli\` (Windows)
- **Resolution order**: `--profile` flag → `GWCLI_PROFILE` env → default profile → error

## Commands

### List All Profiles
```bash
gwcli profiles list --format json
```
Returns:
```json
[
  {"name": "personal", "email": "me@gmail.com", "scopes": ["gmail","calendar","drive"], "authenticated": true, "isDefault": true},
  {"name": "work", "email": "me@company.com", "scopes": ["gmail","calendar"], "authenticated": true, "isDefault": false}
]
```

### Add a New Profile
```bash
gwcli profiles add <name> --client <path-to-oauth-json> [--scopes gmail,calendar,drive,docs,sheets,keep,tasks] [--display-name "My Work"]
```

**Required**: OAuth client secret JSON from Google Cloud Console — see [`oauth-bootstrap.md`](oauth-bootstrap.md). Google's "Download JSON" modal is one-shot; capture the file in a real browser, not headless automation.

If the OAuth flow fails (timeout, browser closed, consent declined), `profiles add` rolls back automatically — the partial profile directory is removed so you can retry with the same name.

**Available scopes**: `gmail`, `calendar`, `drive`, `docs`, `sheets`, `keep`, `tasks`  
Default: `gmail,calendar,drive,docs,sheets,keep,tasks`

After creating, the CLI opens a browser for OAuth consent. The user must authenticate.

### Remove a Profile
```bash
gwcli profiles remove <name> --force
```
**`--force` is required** — the command refuses to delete without it (no interactive prompts in CLI mode). Deletes credentials and metadata. Irreversible.

### Rename a Profile
```bash
gwcli profiles rename <old> <new>
```

### Set Default Profile
```bash
gwcli profiles set-default <name>
```

### Re-authenticate (refresh expired tokens)
```bash
gwcli profiles auth <name>                       # uses the profile's stored scopes
gwcli profiles auth <name> --scopes gmail,calendar  # override (still subject to immutability rule below)
```
Opens browser for fresh OAuth flow. Use when tokens expire.

> **`profiles auth` reuses the existing scope set.** It does **not** prompt for new scopes. To add a scope, you must `profiles remove --force` then `profiles add` with the new scope list.

> **Non-TTY behavior.** `profiles auth` always passes `--services` to the underlying gws so the interactive scope picker is bypassed. In CI / agent / `Start-Process`-style environments where stdin is not a TTY, the command refuses to run if no stored or `--scopes` value is available — it would otherwise hang forever waiting for keystrokes that never arrive.

### Check Auth Status
```bash
gwcli profiles status <name>                       # single profile (gws JSON output)
gwcli profiles status                              # all profiles (table when TTY, JSON when piped)
gwcli profiles status --format json                # force JSON for all
gwcli profiles status --format json --strict       # exits 2 if ANY profile is unauthenticated
```

The `--strict` flag is the recommended pre-flight for bulk multi-account operations: run it first, fix any unauthenticated profiles, then proceed.

## Multi-Account Workflows

### Using Specific Profile for One Command
```bash
gwcli --profile work gmail users messages list --params '{"userId":"me","maxResults":5}'
```

### Environment Variable Override
```bash
# POSIX
GWCLI_PROFILE=personal gwcli agenda --days 3

# PowerShell
$env:GWCLI_PROFILE = "personal"; gwcli agenda --days 3
```

### Cross-Account Operations

```bash
# POSIX (bash/zsh)
work_emails=$(gwcli --profile work gmail users messages list --params '{"userId":"me","q":"meeting invite","maxResults":1}')
gwcli --profile personal calendar events insert --params '{"calendarId":"primary"}' --body '<event>'
```

```powershell
# PowerShell
$work_emails = gwcli --profile work gmail users messages list --params '{"userId":"me","q":"meeting invite","maxResults":1}'
gwcli --profile personal calendar events insert --params '{"calendarId":"primary"}' --body '<event>'
```

### Concurrency Rules

- **Cross-profile parallelism is safe.** Each profile gets an isolated `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` per spawn.
- **Same-profile parallelism is NOT safe.** The file-keyring backend stores tokens as plain JSON; concurrent invocations against the same profile can race during token refresh and corrupt the cache. Serialize same-profile commands.

## Advanced Configuration

The global config file (`~/.config/gwcli/config.json` on Linux/Mac, `%APPDATA%\gwcli\config.json` on Windows) supports:

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
- **`defaultProfile`** — used when neither `--profile` nor `GWCLI_PROFILE` is set.
- **`settings.defaultFormat`** — passed to gws for passthrough commands.

## OAuth Client Setup Guide (for helping users)

1. Go to https://console.cloud.google.com/
2. Create project or select existing
3. Enable APIs you need (only enable what you'll use):
   - Gmail API, Google Calendar API, Google Drive API, Google Docs API, Google Sheets API, Google Tasks API
   - **Google Keep API** is **enterprise/Workspace-only** and requires special enablement (the consumer Keep API is not exposed). See [`keep.md`](./keep.md) for details.
4. Go to **APIs & Services > Credentials**
5. Click **Create Credentials > OAuth client ID**
6. Application type: **Desktop app**
7. Download the JSON file
8. Provide path to: `gwcli profiles add <name> --client <downloaded-file.json>`

> **About `gws`:** The underlying tool (`@googleworkspace/cli`) is community-maintained and explicitly not an officially supported Google product. Major API changes in `gws` releases can affect this skill. If commands break after a `gws` upgrade, run `gwcli doctor` and check the [troubleshooting reference](./troubleshooting.md).

### gws version compatibility

| gws range | Status | Notes |
|-----------|--------|-------|
| `< 0.20.0` | Not supported | `gwcli setup` rejects with "below minimum" error |
| `0.20.x – 0.22.x` | Tested | Current reference target |
| `0.23.x +` | Best-effort | Likely works; watch for breaking changes in `gws --help` |
| `1.0.0 +` | Unknown | Future major; verify with `gwcli doctor` and the gws changelog before relying on it |

The minimum is enforced in `gwcli setup`. Other versions degrade gracefully — if a specific gws command surface changes, the gwcli passthrough still forwards arguments verbatim, so the user only sees gws's own error message.

## Troubleshooting Profiles

| Symptom | Cause | Fix |
|---------|-------|-----|
| "No profile specified" | No default, no --profile | `gwcli profiles set-default <name>` |
| "Profile not authenticated" | Tokens missing/expired | `gwcli profiles auth <name>` |
| "Profile corrupted" | Missing meta.json | Remove + re-add the profile |
| "Invalid grant" | OAuth revoked externally | `gwcli profiles auth <name>` |
