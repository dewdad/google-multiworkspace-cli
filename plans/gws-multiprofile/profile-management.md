# Profile Management

## Storage Layout

```
~/.config/gwcli/                          ← XDG_CONFIG_HOME/gwcli on Linux/macOS
├── config.json                           ← global settings
└── profiles/
    ├── personal/
    │   ├── meta.json                     ← profile metadata
    │   └── gws/                          ← complete gws config directory (isolated)
    │       ├── client_secret.json        ← OAuth client credentials
    │       ├── credentials.enc           ← encrypted OAuth tokens (gws-managed)
    │       ├── .encryption_key           ← AES-256-GCM key (gws-managed)
    │       └── token_cache.json          ← token refresh cache (gws-managed)
    ├── work/
    │   ├── meta.json
    │   └── gws/
    │       ├── client_secret.json
    │       ├── credentials.enc
    │       ├── .encryption_key
    │       └── token_cache.json
    └── client-acme/
        ├── meta.json
        └── gws/
            └── ...
```

### Platform Paths

| Platform | Config Root |
|----------|-------------|
| Linux | `~/.config/gwcli/` |
| macOS | `~/.config/gwcli/` (not ~/Library — matches gws convention) |
| Windows | `%APPDATA%\gwcli\` |

Override: `GWCLI_CONFIG_DIR` env var.

## Config Schemas

### Global Config (`config.json`)

```typescript
interface GlobalConfig {
  version: 1;
  defaultProfile: string | null;
  gwsBinary: string;            // default: "gws" (resolve from PATH)
  settings: {
    defaultFormat: 'json' | 'table' | 'yaml' | 'csv';
    annotateProfile: boolean;   // include profile name in JSON output
  };
}
```

**Default:**
```json
{
  "version": 1,
  "defaultProfile": null,
  "gwsBinary": "gws",
  "settings": {
    "defaultFormat": "json",
    "annotateProfile": false
  }
}
```

### Profile Metadata (`meta.json`)

```typescript
interface ProfileMeta {
  name: string;                 // profile identifier (directory name)
  displayName: string;          // human-friendly label
  email: string | null;         // discovered after auth, null before
  createdAt: string;            // ISO 8601
  lastUsed: string | null;      // ISO 8601, updated on each command
  scopes: string[];             // scope prefixes passed to gws auth login
  clientSecretSource: string;   // original path of client_secret.json (for reference)
  tags: string[];               // user-defined tags for grouping
}
```

**Example:**
```json
{
  "name": "work",
  "displayName": "Work (Acme Corp)",
  "email": "jdoe@acme.com",
  "createdAt": "2025-06-15T10:30:00Z",
  "lastUsed": "2025-07-01T14:22:00Z",
  "scopes": ["gmail", "calendar", "drive", "keep", "docs", "sheets"],
  "clientSecretSource": "~/Downloads/client_secret_acme.json",
  "tags": ["employer"]
}
```

## Profile Name Validation

```typescript
const PROFILE_NAME_REGEX = /^[a-z][a-z0-9\-]{0,62}$/;

// Rules:
// - Lowercase alphanumeric + hyphens only
// - Must start with a letter
// - 1-63 characters (DNS label compatible)
// - No path separators, dots, or spaces
// - Reserved names: "default", "all", "none", "config"
```

## CRUD Operations

### `profiles add <name> --client <path> [--scopes <list>] [--display-name <str>]`

**Steps:**
1. Validate profile name (regex + reserved word check)
2. Check profile doesn't already exist
3. Create directory: `<config_root>/profiles/<name>/gws/`
4. Copy (not move) client_secret.json into the gws dir
5. Write initial meta.json (email=null, scopes from --scopes or default set)
6. Run scoped auth login:
   ```
   GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<profile_gws_dir> gws auth login [-s <scopes>]
   ```
7. On success: fetch email via gws, update meta.json
8. If this is the first profile and no default set: set as default

**Default scopes** (if `--scopes` not provided):
```
gmail, calendar, drive, docs, sheets, keep, tasks
```

**Error cases:**
- Profile name already exists → error with `--force` suggestion
- Client secret file not found → error
- gws binary not found → error with install instructions
- Auth login cancelled/failed → profile dir created but meta.email=null, warn user

### `profiles remove <name> [--force]`

**Steps:**
1. Confirm profile exists
2. If not `--force`: prompt "Remove profile '<name>'? This deletes stored credentials. [y/N]"
3. Delete entire directory: `<config_root>/profiles/<name>/`
4. If this was the default profile: clear default in config.json, warn user

**Agent mode** (non-interactive): requires `--force` flag.

### `profiles list [--format json|table]`

**Output (table):**
```
  Name          Email                 Last Used        Scopes
  ─────────────────────────────────────────────────────────────
* personal      me@gmail.com          2 hours ago      gmail, calendar, drive
  work          jdoe@acme.com         1 day ago        gmail, calendar, drive, docs
  client-acme   contact@acme.io       3 days ago       gmail, calendar
```

`*` indicates default profile.

**Output (JSON):**
```json
[
  {
    "name": "personal",
    "email": "me@gmail.com",
    "isDefault": true,
    "lastUsed": "2025-07-01T14:22:00Z",
    "scopes": ["gmail", "calendar", "drive"],
    "authenticated": true
  }
]
```

### `profiles set-default <name>`

Set the default profile used when no `--profile` flag or `GWCLI_PROFILE` env is provided.

### `profiles rename <old> <new>`

**Steps:**
1. Validate new name
2. Rename directory
3. Update meta.json name field
4. If old was default: update config.json default to new name

### `profiles auth <name> [--scopes <list>]`

Re-authenticate or add scopes to an existing profile.

```
GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<profile_gws_dir> gws auth login [-s <scopes>]
```

### `profiles status <name>`

Check auth health without making a full API call:
- Credentials file exists?
- Token cache present?
- Scopes configured?
- Last successful API call timestamp?

### `profiles export <name> --output <path>`

Export profile config (client_secret.json + meta.json, NOT credentials) for backup or sharing between machines.

### `profiles import <path> --name <name>`

Import a previously exported profile bundle and run auth login.

## Profile Resolution Priority

When gwcli receives a command, it resolves the active profile in this order:

```
1. --profile <name> flag                    (highest priority)
2. GWCLI_PROFILE environment variable
3. config.json defaultProfile
4. Error: "No profile specified and no default set. Run: gwcli profiles add <name>"
```

## Concurrent Access

**Non-goal for v1:** Parallel operations across profiles.

Each gwcli invocation uses exactly one profile. If an agent needs to operate on multiple accounts, it issues separate commands:

```bash
gwcli --profile work gmail +triage
gwcli --profile personal calendar +agenda
```

These are safe to run in parallel from different shell sessions because each profile has its own token cache and credentials — no shared mutable state.

## Cleanup & Garbage Collection

On `profiles remove`:
- Entire profile directory is deleted (including encrypted credentials)
- gws keyring entries for that config dir may be orphaned (acceptable; OS keyring GC is out of scope)

## Security Considerations

1. **Credentials never leave the profile's gws dir** — gwcli never reads, copies, or logs credential contents
2. **client_secret.json is copied, not symlinked** — profile is self-contained, original can be deleted
3. **Profile names are validated against path traversal** — no `../`, absolute paths, or special chars
4. **meta.json contains no secrets** — only display metadata, safe to backup
5. **File permissions** — profile directories created with 0700 (Unix) / user-only ACL (Windows)
