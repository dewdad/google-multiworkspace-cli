# Architecture

## System Overview

```
┌───────────────────────────────────────────────────────────────────── ┐
│  gwcli (TypeScript, ~400 LOC)                                        │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐   │
│  │ Profile Manager  │  │ Command Router   │  │ Output Formatter  │   │
│  │                  │  │                  │  │                   │   │
│  │ • add / remove   │  │ • parse argv     │  │ • passthrough     │   │
│  │ • list / rename  │  │ • resolve profile│  │ • table transform │   │
│  │ • set-default    │  │ • build env      │  │ • error wrapping  │   │
│  │ • migrate        │  │ • exec gws       │  │                   │   │
│  └────────┬─────────┘  └────────┬─────────┘  └───────────────────┘   │
│           │                      │                                   │
│           ▼                      ▼                                   │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Config Store (~/.config/gwcli/)                              │    │
│  │                                                              │    │
│  │  config.json              ← global settings, default profile │    │
│  │  profiles/                                                   │    │
│  │    personal/                                                 │    │
│  │      meta.json            ← display name, email, created_at  │    │
│  │      gws/                 ← isolated gws config directory    │    │
│  │        client_secret.json                                    │    │
│  │        credentials/token artifacts (gws-managed)             │    │
│  │    work/                                                     │    │
│  │      meta.json                                               │    │
│  │      gws/                                                    │    │
│  │        ...                                                   │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              │ subprocess: GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<profile_gws_dir> gws <args>
                              ▼
              ┌───────────────────────────────┐
              │  gws (Rust binary, external)  │
              │                               │
              │  • Discovery-based commands   │
              │  • 19+ Workspace services     │
              │  • OAuth token refresh        │
              │  • Field masks, pagination    │
              │  • Schema introspection       │
              │  • Helpers (+triage, +agenda) │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Google Workspace APIs        │
              └───────────────────────────────┘
```

## Components

### 1. Profile Manager (`src/profiles/`)

Owns the lifecycle of named profiles. Each profile maps to an isolated `gws` configuration directory. This replaces the current plaintext `credentials.json` profile backend; existing profile commands are useful UX precedent, not reusable auth storage.

**Responsibilities:**
- Create/delete profile directories
- Store profile metadata (display name, associated email, creation date)
- Validate profile names (alphanumeric + hyphens, no path traversal)
- Copy client_secret.json into profile's gws config dir
- Orchestrate `gws auth login` within the profile's config dir

**Does NOT:**
- Handle OAuth flows directly (delegates to `gws auth login`)
- Make any Google API calls
- Manage tokens (gws handles refresh internally)

### 2. Command Router (`src/gws/runner.ts` + `src/profiles/resolver.ts`)

Resolves the active profile, constructs the environment, and spawns `gws` as a subprocess.

**Responsibilities:**
- Parse `--profile` flag or `GWCLI_PROFILE` env var or default
- Resolve profile name → config directory path
- Validate that the profile has a usable auth artifact (`credentials.enc`, `credentials.json`, service-account file, or whatever Phase 0 confirms for the pinned `gws` version)
- Build subprocess environment with `GOOGLE_WORKSPACE_CLI_CONFIG_DIR`
- Spawn configured `gwsBinary` with remaining argv passed through
- Stream stdout/stderr from gws to parent process
- Forward exit code

**Argv parsing contract:**
1. Parse only gwcli global flags before the native command or passthrough command: `--profile/-p`, `--format/-f`, `--verbose/-v`, and `--config-dir` if added.
2. Treat `profiles`, `doctor`, `version`, `migrate`, and `completion` as gwcli-native commands.
3. For every other first positional token, preserve the remaining argv byte-for-byte as `gwsArgs`.
4. Support `--` as an explicit passthrough separator.
5. Do not let Commander reject unknown options intended for `gws`.
6. If `--format` appears in both gwcli global flags and passthrough args, do not inject a second format flag; the explicit passthrough `gws` flag wins.
7. `--dry-run` is passed through only when the pinned `gws` version supports it. gwcli must not claim mutation safety for commands where `gws` has no dry-run behavior.

**Subprocess execution model:**
```typescript
const result = spawnSync(config.gwsBinary, gwsArgs, {
  env: {
    ...process.env,
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR: profileGwsDir,
  },
  stdio: 'inherit',  // default passthrough mode streams directly
});
process.exit(result.status ?? 1);
```

### 3. Output Formatter (`src/lib/output.ts`)

Minimal transformation layer. In default mode, gwcli passes `gws` output through untouched.

**Responsibilities:**
- Default mode: pure passthrough (`stdio: 'inherit'`) so agent JSON is byte-for-byte `gws` output
- Native gwcli commands (`profiles`, `doctor`, `version`, `migrate`) use gwcli's formatter
- Optional capture mode only for features that must inspect output, such as `--annotate-profile`
- Error wrapping only for preflight gwcli errors (profile missing, binary missing) and captured `gws` failures where stderr is available
  - Example: "No credentials found" → "Profile 'work' is not authenticated. Run: gwcli profiles auth work"

**Important constraint:** `--annotate-profile` and byte-for-byte passthrough are mutually exclusive. If annotation is enabled, gwcli must buffer and parse JSON, and the output is no longer identical to raw `gws`.

### 4. Config Store

File-based configuration. No database, no network dependency.

**Global config** (`~/.config/gwcli/config.json`):
```json
{
  "version": 1,
  "defaultProfile": "personal",
  "gwsBinary": "gws",
  "settings": {
    "defaultFormat": "json"
  }
}
```

**Profile metadata** (`~/.config/gwcli/profiles/<name>/meta.json`):
```json
{
  "name": "work",
  "email": "user@company.com",
  "createdAt": "2025-06-15T10:30:00Z",
  "lastUsed": "2025-07-01T14:22:00Z",
  "scopes": ["gmail", "calendar", "drive", "keep", "docs"]
}
```

## Data Flow

### Normal Command Execution

```
User/Agent: gwcli --profile work gmail +triage

1. argv parsing: profile="work", gws_args=["gmail", "+triage"]
2. Profile resolution: ~/.config/gwcli/profiles/work/gws/
3. Validation: usable auth artifact exists? yes → proceed
4. Subprocess spawn:
   env: GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gwcli/profiles/work/gws/
   cmd: gws gmail +triage
5. gws loads credentials from the profile's config dir
6. gws refreshes token if expired (using profile's token_cache.json)
7. gws calls Gmail API, returns JSON to stdout
8. gwcli streams stdout to caller
9. Exit code forwarded
```

### Profile Setup

```
User: gwcli profiles add work --client ~/Downloads/client_secret_123.json

1. Validate profile name ("work" — OK)
2. Create directory: ~/.config/gwcli/profiles/work/gws/
3. Copy client_secret.json → ~/.config/gwcli/profiles/work/gws/client_secret.json
4. Spawn the verified auth command from Phase 0, usually: GOOGLE_WORKSPACE_CLI_CONFIG_DIR=...work/gws/ gws auth login
5. Browser opens → user authorizes → tokens stored in the profile `gws/` directory using the artifact names confirmed in Phase 0
6. Fetch email: GOOGLE_WORKSPACE_CLI_CONFIG_DIR=...work/gws/ gws gmail users getProfile --params '{"userId":"me"}' --fields "emailAddress"
7. Store email in meta.json
8. Done: "Profile 'work' created and authenticated as user@company.com"
```

### Scope Management

```
User: gwcli profiles add-scopes work --scopes keep,docs

1. Resolve profile config dir
2. Spawn: GOOGLE_WORKSPACE_CLI_CONFIG_DIR=...work/gws/ gws auth login -s keep,docs
3. Browser opens → user grants additional scopes
4. Update meta.json scopes array
```

## Design Principles

1. **gwcli never calls Google APIs directly** — all API interaction goes through `gws`
2. **Profile isolation is absolute** — each profile has its own encryption keys, tokens, client config
3. **gws is a black box** — gwcli only depends on documented env vars and CLI interface
4. **Fail fast** — if gws binary missing, profile not found, or not authenticated: clear error immediately
5. **Agent-first** — JSON output by default, deterministic exit codes, no interactive prompts during normal operation
6. **Human-friendly setup** — interactive flows only during `profiles add` and `profiles auth`

## Upgrade Safety: Contract Testing Against `gws`

Since gwcli treats `gws` as a black box with `stdio: 'inherit'` passthrough, output format changes in `gws` propagate silently to downstream agents. Without explicit guards, a `gws` update could break every agent skill consuming gwcli output.

### Strategy: Pinned Output Snapshots

Maintain two test layers:
1. **Mocked runner tests** in normal CI. These verify gwcli argv parsing, env injection, profile resolution, exit-code forwarding, and native command output without requiring Google credentials.
2. **Live contract tests** for `gws` upgrades. These require opt-in credentials and a pinned `gws` version, then capture expected JSON structure from key `gws` commands.

**What to snapshot** (structure, not values):
```typescript
// tests/contracts/gws-output.test.ts
const EXPECTED_SCHEMAS = {
  'gmail users messages list': {
    required: ['messages'],
    messageShape: ['id', 'threadId', 'labelIds'],
  },
  'calendar events list': {
    required: ['items'],
    itemShape: ['id', 'summary', 'start', 'end'],
  },
  'drive files list': {
    required: ['files'],
    fileShape: ['id', 'name', 'mimeType'],
  },
};
```

**How it works:**
1. Live tests spawn `gws <command> --format json` with a test profile
2. Parse output and assert top-level keys and nested object shapes exist
3. Do NOT assert values — only structural contract (key names, nesting, types)
4. Fail loudly with: "gws output contract broken for `<command>` — expected key `<key>` missing"

**When to run:**
- Normal CI: mocked runner and profile tests on every PR
- Optional/live CI or manual: before bumping pinned `gws` version (`gwcli doctor --check-contracts`)
- Never require live Google credentials for ordinary pull requests

**Graceful degradation:**
- If contract test fails after `gws` upgrade, gwcli should still pass through raw output (agents may adapt)
- The failure is a **warning** to update agent skill documentation, not a hard block on users

### `gwcli doctor --check-contracts`

Extends the `doctor` command to verify output contracts against the currently installed `gws` binary:
```
$ gwcli doctor --check-contracts
✓ gws binary found (v0.14.2)
✓ gmail output contract: OK
✓ calendar output contract: OK
✗ drive output contract: CHANGED (missing key 'webViewLink' in fileShape)
  → gws v0.14.2 may have changed Drive output. Check agent skills.
```

## Dependencies

### Runtime
- `gws` binary on PATH (or configured path in config.json)
- Node.js 18+ (for gwcli itself)

### Build
- TypeScript
- `commander` — CLI framework (already in use)
- `chalk` — terminal colors (already in use)

### Removed (no longer needed)
- `googleapis` npm package — all API calls go through gws
- `open` — browser opening delegated to gws auth login
