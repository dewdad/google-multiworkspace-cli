# Migration Plan

## Overview

Transform `gwcli` from a standalone Google API client into a multi-profile orchestration layer over `gws`. This is a major architectural change but results in significantly less code to maintain.

## Phases

### Phase 0: Preparation (Before Any Code Changes)

**Duration:** 1 session

1. **Install and validate gws**
   ```bash
   npm install -g @googleworkspace/cli
   gws --version
   gws auth login  # verify basic flow works
   ```

2. **Verify env var isolation works**
   ```bash
   mkdir -p /tmp/gws-test-profile
   cp ~/.config/gws/client_secret.json /tmp/gws-test-profile/
   GOOGLE_WORKSPACE_CLI_CONFIG_DIR=/tmp/gws-test-profile gws auth login
   GOOGLE_WORKSPACE_CLI_CONFIG_DIR=/tmp/gws-test-profile gws gmail users getProfile --params '{"userId":"me"}' --fields emailAddress
   ```
   If this returns the email without touching `~/.config/gws/`, the hybrid approach is confirmed.

3. **Document current gwcli usage** — capture any scripts/skills that reference current command syntax for backward-compat mapping.

4. **Tag current state**
   ```bash
   git tag v1.0.0-pre-hybrid -m "Last version before gws hybrid migration"
   ```

---

### Phase 1: New Profile Manager (Keep Old Code Working)

**Duration:** 1-2 sessions

**Goal:** Build the new profile management system alongside the old code. Both work simultaneously.

#### Files to Create

```
src/
├── profiles/
│   ├── index.ts          ← profile CRUD operations
│   ├── config.ts         ← config schema, read/write
│   ├── resolver.ts       ← profile resolution logic (flag → env → default)
│   └── validator.ts      ← name validation, path safety
├── gws/
│   ├── runner.ts         ← subprocess execution wrapper
│   ├── binary.ts         ← gws binary discovery and version check
│   └── errors.ts         ← gws exit code → user-friendly error mapping
```

#### Implementation Order

1. `src/profiles/validator.ts` — name regex, reserved words, path traversal check
2. `src/profiles/config.ts` — global config read/write, profile meta read/write
3. `src/profiles/index.ts` — add, remove, list, rename, set-default
4. `src/gws/binary.ts` — find gws on PATH, check version, error if missing
5. `src/gws/runner.ts` — spawn gws with env injection, stream stdio, forward exit code
6. `src/gws/errors.ts` — translate gws exit codes to helpful messages

#### Testing

- Unit tests for validator, config, resolver
- Integration test: create profile dir, verify file layout
- Integration test: spawn gws with mock config dir (use `gws --help` as a no-op)
- Contract tests: snapshot expected JSON structure from key `gws` commands (gmail, calendar, drive) to detect upstream output format changes on version bump (see architecture.md § "Upgrade Safety")

---

### Phase 2: Wire Up CLI Commands

**Duration:** 1 session

**Goal:** Replace existing commands with gws passthrough. Add profile management commands.

#### Changes to `src/commands/profiles.ts`

Rewrite to use the new `src/profiles/` module:
- `profiles add` → creates dir, copies client_secret, runs `gws auth login`
- `profiles remove` → deletes dir
- `profiles list` → reads all meta.json files
- `profiles set-default` → updates config.json
- `profiles auth` → re-runs gws auth login for existing profile
- `profiles status` → checks credential health

#### Changes to `src/index.ts`

Replace command routing:

```typescript
// Before: explicit command handlers
program.command('gmail').addCommand(gmailList).addCommand(gmailSearch)...
program.command('calendar').addCommand(calendarEvents)...
program.command('drive').addCommand(driveList)...

// After: profile commands + gws passthrough
program.command('profiles').addCommand(add).addCommand(remove)...
program.command('doctor', 'Check system health')
program.command('version', 'Show version info')

// Everything else → passthrough to gws
program.on('command:*', (args) => {
  const profile = resolveProfile(program.opts());
  const exitCode = execGws(profile, args);
  process.exit(exitCode);
});
```

#### Files to Delete

```
src/commands/gmail.ts          ← replaced by gws gmail passthrough
src/commands/calendar.ts       ← replaced by gws calendar passthrough
src/commands/drive.ts          ← replaced by gws drive passthrough
src/lib/gmail-client.ts        ← no longer needed
src/lib/calendar-client.ts     ← no longer needed
src/lib/drive-client.ts        ← no longer needed
src/lib/auth.ts                ← replaced by gws auth delegation
```

#### Files to Keep (Modified)

```
src/lib/config.ts              ← refactor to new config schema
src/lib/output.ts              ← keep for error formatting
src/commands/profiles.ts       ← rewrite with new profile module
src/index.ts                   ← rewrite with passthrough router
```

---

### Phase 3: Backward Compatibility Layer (Optional)

**Duration:** 0.5 session

**Goal:** Old gwcli commands still work via translation to gws syntax.

If existing scripts use the old syntax:
```bash
gwcli gmail list --unread --limit 20
gwcli calendar events --days 7
gwcli drive search "report"
```

Add a compatibility shim that translates to gws equivalents:
```bash
gwcli gmail list --unread --limit 20
→ gws gmail +triage  (or gws gmail users messages list --params '{"userId":"me","q":"is:unread","maxResults":20}')
```

**Implementation:** A mapping table in `src/compat/translations.ts`:

```typescript
const COMPAT_MAP: Record<string, (args: string[]) => string[]> = {
  'gmail list': (args) => {
    const limit = extractFlag(args, '--limit') ?? '20';
    const unread = hasFlag(args, '--unread') ? ' is:unread' : '';
    return ['gmail', 'users', 'messages', 'list',
      '--params', JSON.stringify({ userId: 'me', maxResults: Number(limit), q: unread.trim() }),
      '--fields', 'messages(id,threadId,snippet,labelIds,internalDate)'];
  },
  'calendar events': (args) => {
    const days = extractFlag(args, '--days') ?? '7';
    return ['calendar', '+agenda', '--days', days];
  },
  // ...
};
```

**Deprecation strategy:** Log a warning when compat translation is used:
```
⚠ Deprecated: 'gwcli gmail list' → use 'gwcli gmail +triage' or native gws syntax.
  See: gwcli docs migration
```

Remove compat layer after 3 months or v3.0.

---

### Phase 4: Agent Skill + Documentation

**Duration:** 0.5 session

**Goal:** Ship the agent skill file and updated README.

1. **Create skill file** at `skill/SKILL.md` — command reference for LLM agents
2. **Update README.md** — new architecture, setup instructions, usage examples
3. **Update package.json** — remove `googleapis` dependency, update description
4. **Create `gwcli doctor`** — system health check

---

### Phase 5: Existing Profile Migration

**Duration:** Built into Phase 2

Users who already have gwcli profiles (old format) need a migration path.

```bash
gwcli migrate
```

**What it does:**
1. Reads old config at `~/.config/gwcli/profiles/<name>/credentials.json`
2. Creates new directory structure: `~/.config/gwcli/profiles/<name>/gws/`
3. Converts old credentials to gws format (or re-runs auth login)
4. Preserves profile names and default setting

**Implementation:**

```typescript
async function migrateProfile(name: string): Promise<void> {
  const oldDir = path.join(configRoot, 'profiles', name);
  const newGwsDir = path.join(oldDir, 'gws');

  // Check if already migrated
  if (existsSync(newGwsDir)) {
    console.log(`Profile '${name}' already migrated.`);
    return;
  }

  mkdirSync(newGwsDir, { recursive: true });

  // Copy client credentials if they exist in old format
  const oldCreds = path.join(oldDir, 'credentials.json');
  if (existsSync(oldCreds)) {
    // Old format has OAuth tokens in credentials.json
    // gws needs them in a specific format — safest to re-auth
    console.log(`Re-authenticating profile '${name}'...`);
    await authenticateProfile(name, DEFAULT_SCOPES);
  }

  // Copy client_secret if it exists
  const oldClient = path.join(oldDir, 'config.json');
  if (existsSync(oldClient)) {
    const config = JSON.parse(readFileSync(oldClient, 'utf-8'));
    if (config.clientSecretPath) {
      copyFileSync(config.clientSecretPath, path.join(newGwsDir, 'client_secret.json'));
    }
  }

  // Write meta.json
  writeMetaJson(name, { migratedFrom: 'v1', migratedAt: new Date().toISOString() });
}
```

---

## Dependency Changes

### package.json Diff

```diff
  "dependencies": {
    "chalk": "^5.3.0",
    "cli-table3": "^0.6.5",
    "commander": "^12.1.0",
-   "googleapis": "^144.0.0",
-   "open": "^10.1.0"
  },
```

**Removed:**
- `googleapis` (144MB unpacked) — all API calls go through gws binary
- `open` — browser opening delegated to gws auth login

**Net effect:** Package shrinks from ~150MB node_modules to ~5MB.

---

## File Change Summary

| Action | File | Reason |
|--------|------|--------|
| DELETE | `src/lib/gmail-client.ts` | Replaced by gws |
| DELETE | `src/lib/calendar-client.ts` | Replaced by gws |
| DELETE | `src/lib/drive-client.ts` | Replaced by gws |
| DELETE | `src/lib/auth.ts` | Auth delegated to gws |
| DELETE | `src/commands/gmail.ts` | Replaced by passthrough |
| DELETE | `src/commands/calendar.ts` | Replaced by passthrough |
| DELETE | `src/commands/drive.ts` | Replaced by passthrough |
| DELETE | `src/commands/calendar.test.ts` | Tests for deleted code |
| REWRITE | `src/index.ts` | New routing architecture |
| REWRITE | `src/commands/profiles.ts` | New profile management |
| REWRITE | `src/lib/config.ts` | New config schema |
| KEEP | `src/lib/output.ts` | Error formatting still useful |
| CREATE | `src/profiles/index.ts` | Profile CRUD |
| CREATE | `src/profiles/config.ts` | Config read/write |
| CREATE | `src/profiles/resolver.ts` | Profile resolution |
| CREATE | `src/profiles/validator.ts` | Input validation |
| CREATE | `src/gws/runner.ts` | Subprocess execution |
| CREATE | `src/gws/binary.ts` | Binary discovery |
| CREATE | `src/gws/errors.ts` | Error translation |
| CREATE | `src/compat/translations.ts` | (Optional) compat shim |
| CREATE | `skill/SKILL.md` | Agent skill file |

---

## Estimated LOC

| Component | Lines (approx) |
|-----------|---------------|
| profiles/ (CRUD, config, validation) | 250 |
| gws/ (runner, binary, errors) | 150 |
| index.ts (routing) | 80 |
| commands/profiles.ts (CLI wiring) | 120 |
| compat/ (optional) | 100 |
| skill/SKILL.md | 100 |
| Tests | 200 |
| **Total** | **~1000** |

Versus current codebase: ~2000+ LOC of Google API wrappers that cover 3 services.
New codebase: ~1000 LOC that covers 19+ services.

---

## Rollback Plan

If the hybrid approach fails for any reason:

1. `git checkout v1.0.0-pre-hybrid` — restore old code
2. Old profiles still work (credentials stored in same root dir)
3. No data loss — profile migration doesn't delete old credential files until confirmed

---

## Verification Checklist

Before declaring migration complete:

- [ ] `gwcli profiles add test --client <path>` → creates profile, authenticates
- [ ] `gwcli -p test gmail +triage` → returns JSON email summary
- [ ] `gwcli -p test calendar +agenda` → returns upcoming events
- [ ] `gwcli -p test drive files list --fields "files(id,name)"` → returns files
- [ ] `gwcli -p test keep notes list` → returns Keep notes
- [ ] `gwcli -p test docs documents get --params '{"documentId":"X"}'` → returns doc
- [ ] `gwcli profiles list` → shows all profiles with auth status
- [ ] `gwcli doctor` → all checks pass
- [ ] `gwcli version` → shows both gwcli and gws versions
- [ ] Exit codes propagate correctly (0, 1, 4)
- [ ] `--format table` works for human-readable output
- [ ] Old v1 profiles can be migrated with `gwcli migrate`
- [ ] npm package size < 10MB (no googleapis dependency)
- [ ] Contract tests pass against installed `gws` version (gmail, calendar, drive JSON shapes)
- [ ] `gwcli doctor --check-contracts` reports all green
- [ ] CI passes: lint, test (including contract tests), build
