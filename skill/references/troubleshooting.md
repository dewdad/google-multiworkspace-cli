# Troubleshooting

> **Two distinct exit-code namespaces:**
> - **Preflight codes (60–69)** are emitted only by `gwcli preflight` / `gwcli setup` and indicate environment problems before any API call.
> - **Runtime codes (1, 2)** are emitted by `gws` API passthrough and indicate API/auth problems during a request.
> Always check which command produced the code before applying a fix.

## Preflight exit codes (`gwcli preflight`, `gwcli setup`)

| Exit | Cause | Fix |
|------|-------|-----|
| `0` | Ready | proceed |
| `63` | `gws` binary missing or below minimum version | `gwcli setup` |
| `64` | No profiles configured | `gwcli profiles add <name> --client <path>` |
| `127` (or shell "command not found") | `gwcli` itself not on PATH | `npm install -g google-workspace-cli`, then `gwcli setup` |

## Runtime exit codes (gws API passthrough)

| Symptom | Exit Code | Cause | Fix |
|---------|-----------|-------|-----|
| Auth error / "invalid_grant" | `2` | OAuth token expired or revoked | `gwcli profiles auth <profile>` |
| General error / API failure | `1` | API error (quota, invalid request) | Read stderr from gws |
| "insufficient_scope" | `1` | Missing API scope on this profile | Re-add profile with needed scopes (scopes are immutable) |
| "ECONNREFUSED" / network | `1` | Network issue | Check internet connectivity |
| "rate limit" / HTTP 429 | `1` | API quota exceeded | Wait and retry, or reduce request rate |

## gwcli error codes (in stderr `Error: ... [CODE]`)

| Code | Cause | Fix |
|------|-------|-----|
| `GWS_NOT_FOUND` | gws binary not installed | `gwcli setup` |
| `GWS_VERSION_FAILED` | gws binary broken | `npm uninstall -g @googleworkspace/cli && gwcli setup` |
| `NO_PROFILE` | No profile specified, no default | `gwcli profiles set-default <name>` |
| `PROFILE_NOT_FOUND` | Profile doesn't exist | `gwcli profiles list` to see available |
| `PROFILE_NOT_AUTHENTICATED` | Missing tokens | `gwcli profiles auth <name>` |
| `PROFILE_CORRUPTED` | Bad meta.json | `gwcli profiles remove <name> --force` then re-add |
| `INVALID_PROFILE_NAME` | Bad characters or reserved name | use `[a-z][a-z0-9-]{0,62}`, avoid reserved names |
| `CLIENT_SECRET_NOT_FOUND` | OAuth JSON file missing | check the `--client <path>` value |

## Diagnostic Commands

```bash
# Fast environment check (silent on success, exits 63/64 on issues)
gwcli preflight
gwcli preflight --json    # JSON diagnosis on stderr

# Full system health check (per-profile auth, scopes, paths)
gwcli doctor

# Bulk auth status — exits 2 if ANY profile is unauthenticated
gwcli profiles status --format json --strict

# Single-profile status
gwcli profiles status <name>

# Verbose mode (shows resolved profile + gws command on stderr)
gwcli --verbose gmail users messages list --params '{"userId":"me"}'
```

## Common Scenarios

### "Command works for one profile but not another"
Different profiles may have different scopes. **Scopes are immutable on a profile** — `profiles auth` re-uses the existing scope set, so adding a scope requires recreating the profile.
```bash
gwcli profiles list --format json
# Inspect the `scopes` array, then:
gwcli profiles remove <name> --force
gwcli profiles add <name> --client <path> --scopes gmail,calendar,drive,docs
```

### "Token expired after long inactivity"
Google OAuth tokens expire. Simply re-authenticate:
```bash
gwcli profiles auth <profile-name>
```

### "gws version mismatch"
If gws API changes break gwcli:
```bash
npm update -g @googleworkspace/cli
gwcli doctor
```

### "Permission denied on Windows"
Windows npm global installs may have PATH issues. Use:
```powershell
# Check where npm globals are
npm config get prefix
# Verify it's in PATH
$env:PATH -split ';' | Where-Object { $_ -match 'npm' }
```

### "Cannot find module" errors
Rebuild gwcli:
```bash
npm uninstall -g google-workspace-cli
npm install -g google-workspace-cli
```

### "I need to use a non-PATH gws binary"
Edit `~/.config/gwcli/config.json` (Linux/Mac) or `%APPDATA%\gwcli\config.json` (Windows) and set `"gwsBinary"` to an absolute path. Useful for monorepo `node_modules/.bin/gws`, Docker-mounted binaries, or air-gapped installs.

## Self-Healing Sequence

When any command fails unexpectedly:

1. `gwcli preflight --json` — fast environment diagnosis
2. If `gws_missing` (exit 63) → `gwcli setup`
3. If `no_profiles` (exit 64) → `gwcli profiles add <name> --client <path>`
4. If runtime auth error (exit 2) → `gwcli profiles auth <profile>`
5. For a deeper view → `gwcli doctor`
6. Found a real bug or doc inaccuracy? Edit the relevant skill file directly with your editing tools.
