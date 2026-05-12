# Auth Integration with `gws`

## Core Mechanism

The entire auth integration hinges on one environment variable:

```
GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<path>
```

When set, `gws` uses `<path>` as its configuration root instead of `~/.config/gws/`. Phase 0 must verify the exact artifact names for the pinned `gws` version. The expected model is:
- Credentials are loaded from `<path>/credentials.enc`
- Token cache lives at `<path>/token_cache.json`
- Client secret read from `<path>/client_secret.json`
- Encryption key stored in `<path>/.encryption_key`

**Each profile gets its own config dir = complete credential isolation.**

Do not implement filename-specific checks until Phase 0 records the files created by the installed `gws`. The plan examples below use currently documented/observed names, but `gws` is pre-v1.0 and may change.

## Expected `gws` Credential Resolution

The current upstream docs describe this credential precedence. Phase 0 must verify it against the pinned version before implementation:

```
Priority 0: GOOGLE_WORKSPACE_CLI_TOKEN env var
             → Raw access token, bypasses everything
             → Use case: pre-fetched tokens, CI/CD pipelines

Priority 1: GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE env var
             → Path to plaintext JSON (User or Service Account)
             → Use case: explicit credential file override

Priority 2: <CONFIG_DIR>/credentials.enc
             → AES-256-GCM encrypted OAuth credentials
             → Key stored in OS keyring or <CONFIG_DIR>/.encryption_key
             → This is the PRIMARY path for interactive users

Priority 3: <CONFIG_DIR>/credentials.json
             → Plaintext fallback (legacy)

Priority 4: GOOGLE_APPLICATION_CREDENTIALS env var
             → Standard ADC (Application Default Credentials)
             → Path to service account JSON

Priority 5: ~/.config/gcloud/application_default_credentials.json
             → Well-known ADC from `gcloud auth application-default login`
```

## Our Integration Point: Priority 2

For interactive user profiles, prefer the **encrypted credentials** path when the pinned `gws` version supports it:

1. `gwcli profiles add` → runs `gws auth login` with isolated config dir
2. `gws auth login` performs the OAuth flow and writes the verified credential artifacts
3. On subsequent commands, `gws` loads those artifacts and refreshes tokens if needed

**We never touch the credentials directly.** gws handles encryption, refresh, and caching.

## Environment Injection

### Per-Command Execution

```typescript
import { spawnSync } from 'node:child_process';

function execGws(profile: ProfileMeta, gwsArgs: string[]): number {
  const config = getGlobalConfig();
  const profileGwsDir = getProfileGwsDir(profile.name);

  const result = spawnSync(config.gwsBinary, gwsArgs, {
    env: {
      ...process.env,
      GOOGLE_WORKSPACE_CLI_CONFIG_DIR: profileGwsDir,
      // Do NOT set GOOGLE_WORKSPACE_CLI_TOKEN — let gws manage token refresh
      // Do NOT set GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE — use encrypted store
    },
    stdio: 'inherit',
    shell: false,  // no shell interpolation — direct exec
  });

  return result.status ?? 1;
}
```

### Auth Login (Profile Setup)

```typescript
async function authenticateProfile(
  profileName: string,
  scopes: string[]
): Promise<void> {
  const config = getGlobalConfig();
  const profileGwsDir = getProfileGwsDir(profileName);
  const authArgs = verifiedAuthArgs(scopes);

  const result = spawnSync(config.gwsBinary, authArgs, {
    env: {
      ...process.env,
      GOOGLE_WORKSPACE_CLI_CONFIG_DIR: profileGwsDir,
    },
    stdio: 'inherit',  // user sees browser prompt
  });

  if (result.status !== 0) {
    throw new Error(`Authentication failed for profile '${profileName}'`);
  }
}
```

## Token Lifecycle

### Who Manages What

| Concern | Owner |
|---------|-------|
| OAuth browser flow | `gws auth login` |
| Token encryption at rest | `gws` (verified in Phase 0) |
| Token refresh | `gws` (automatic on each command) |
| Token cache | `gws` (artifact name verified in Phase 0) |
| Profile ↔ config dir mapping | `gwcli` |
| Credential isolation | `gwcli` (separate config dirs per profile) |

### Token Refresh Flow (Internal to gws)

```
gwcli --profile work calendar events list
  │
  ├─ gwcli sets GOOGLE_WORKSPACE_CLI_CONFIG_DIR=.../work/gws/
  ├─ gwcli spawns: gws calendar events list
  │
  └─ gws internal:
       1. Load the verified credential artifact from config dir
       2. Decrypt using the verified key storage mechanism, if encrypted credentials are used
       3. Check token cache for a valid access token
       4. If expired: use refresh_token to get new access_token
       5. Update token_cache.json
       6. Make API call with fresh access_token
       7. Return response
```

**gwcli never sees tokens.** It doesn't need to know if a refresh happened.

## Scope Management

### Initial Scopes

When `gwcli profiles add` runs the verified `gws` auth command, it passes scope prefixes only if Phase 0 confirms that interface:

```bash
gws auth login -s gmail,calendar,drive,keep,docs,sheets,tasks
```

`gws` maps these prefixes to full OAuth scope URLs internally.

### Adding Scopes Later

```bash
gwcli profiles add-scopes work --scopes meet,chat
```

Internally:
```bash
GOOGLE_WORKSPACE_CLI_CONFIG_DIR=.../work/gws/ gws auth login -s meet,chat
```

This should trigger a re-consent flow. Phase 0 must verify whether `gws` merges scopes with existing credentials or replaces the previous grant; `gwcli` metadata must record the actual resulting scope set where discoverable.

### Scope Prefix → OAuth URL Mapping (handled by gws)

| Prefix | OAuth Scope |
|--------|-------------|
| gmail | `https://www.googleapis.com/auth/gmail.modify` |
| calendar | `https://www.googleapis.com/auth/calendar` |
| drive | `https://www.googleapis.com/auth/drive` |
| keep | `https://www.googleapis.com/auth/keep` |
| docs | `https://www.googleapis.com/auth/documents` |
| sheets | `https://www.googleapis.com/auth/spreadsheets` |
| tasks | `https://www.googleapis.com/auth/tasks` |
| chat | `https://www.googleapis.com/auth/chat.spaces` |
| meet | `https://www.googleapis.com/auth/meetings.space.created` |
| admin | `https://www.googleapis.com/auth/admin.reports.audit.readonly` |

(gws handles this mapping — we just pass prefixes.)

## Service Account Support

For automation/CI scenarios, profiles can use service accounts instead of OAuth only after Phase 0 verifies the supported `gws` service-account path:

```bash
gwcli profiles add ci-bot --service-account ~/keys/service-account.json
```

Implementation:
```typescript
function setupServiceAccountProfile(name: string, keyPath: string): void {
  const profileGwsDir = getProfileGwsDir(name);

  // For service accounts, use the env var confirmed by Phase 0.
  // Expected path: gws honors GOOGLE_APPLICATION_CREDENTIALS.
  // We store the key in the profile dir and set the env var on execution
  copyFile(keyPath, path.join(profileGwsDir, 'service-account.json'));

  // On execution, set both env vars:
  // GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<profile_gws_dir>
  // GOOGLE_APPLICATION_CREDENTIALS=<profile_gws_dir>/service-account.json
}
```

## Auth Health Check

```bash
gwcli profiles status work
```

**Checks:**
1. Profile directory exists
2. A verified `gws` credential artifact or `gws/service-account.json` is present
3. Token cache not stale (optional: attempt a lightweight API call)

**Implementation:**
```typescript
async function checkAuthHealth(profileName: string): Promise<AuthStatus> {
  const gwsDir = getProfileGwsDir(profileName);

  const hasCredentials = hasVerifiedGwsCredentialArtifact(gwsDir)
    || existsSync(path.join(gwsDir, 'service-account.json'));

  if (!hasCredentials) {
    return { status: 'not-authenticated', message: 'No credentials found' };
  }

  // Lightweight check: try to get the user's email
  const config = getGlobalConfig();
  const result = spawnSync(config.gwsBinary, [
    'gmail', 'users', 'getProfile',
    '--params', '{"userId":"me"}',
    '--fields', 'emailAddress'
  ], {
    env: { ...process.env, GOOGLE_WORKSPACE_CLI_CONFIG_DIR: gwsDir },
    encoding: 'utf-8',
  });

  if (result.status === 0) {
    return { status: 'healthy', email: JSON.parse(result.stdout).emailAddress };
  }

  return { status: 'expired', message: 'Token refresh failed. Run: gwcli profiles auth ' + profileName };
}
```

## Error Handling

### Common Auth Errors from gws

| gws Exit Code | Meaning | gwcli Response |
|---------------|---------|----------------|
| Verified auth code | No credentials found | "Profile '<name>' not authenticated. Run: gwcli profiles auth <name>" |
| Verified auth code | Token refresh failed | "Credentials expired. Run: gwcli profiles auth <name>" |
| Verified permission/scope code | Insufficient scopes | "Missing scope for this operation. Run: gwcli profiles add-scopes <name> --scopes <service>" |
| 1 | General error | Pass through gws error message |

### Graceful Degradation

If `gws` binary is not found:
```
Error: 'gws' not found on PATH.

Install: npm install -g @googleworkspace/cli
    or: Download from https://github.com/googleworkspace/cli/releases

Then run: gwcli doctor
```

## Multi-Machine Sync (Future)

Not in v1, but the design supports it:
- `meta.json` and `client_secret.json` are portable (no secrets)
- After copying these to a new machine, user runs `gwcli profiles auth <name>` to re-authenticate
- gws-managed credential and key artifacts are machine-specific when the pinned `gws` version uses encrypted local credentials

## Security Model

```
┌─────────────────────────────────────────────────────────┐
│  gwcli process                                          │
│                                                         │
│  Sees: profile names, config dirs, meta.json            │
│  Never sees: tokens, credentials, encryption keys       │
│                                                         │
│  Principle: gwcli is a COORDINATOR, not a CREDENTIAL    │
│             HANDLER. It never decrypts, reads, or       │
│             logs any secret material.                    │
└─────────────────────────────────────────────────────────┘
         │
         │ env vars only (directory paths)
         ▼
┌─────────────────────────────────────────────────────────┐
│  gws process                                            │
│                                                         │
│  Sees: encrypted credentials, manages decryption        │
│  Handles: token refresh, re-encryption, API auth        │
│                                                         │
│  Security boundary: gws is trusted with credentials     │
│  (it's the same trust model as using gws directly)      │
└─────────────────────────────────────────────────────────┘
```
