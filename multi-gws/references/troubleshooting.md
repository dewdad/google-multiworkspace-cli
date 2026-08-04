# Troubleshooting

> **Two distinct exit-code namespaces:**
> - **Preflight codes (60–69)** are emitted only by `mgws preflight` / `mgws setup` and indicate environment problems before any API call.
> - **Runtime codes (1, 2)** are emitted by `gws` API passthrough and indicate API/auth problems during a request.
> Always check which command produced the code before applying a fix.

## Preflight exit codes (`mgws preflight`, `mgws setup`)

| Exit | Cause | Fix |
|------|-------|-----|
| `0` | Ready | proceed |
| `63` | `gws` binary missing or below minimum version | `mgws setup` |
| `64` | No profiles configured | `mgws init <name>` (or `mgws profiles add <name>`) |
| `127` (or shell "command not found") | `mgws` itself not on PATH | `npm install -g github:dewdad/multi-gws`, then `mgws setup` |

## Runtime exit codes (gws API passthrough)

| Symptom | Exit Code | Cause | Fix |
|---------|-----------|-------|-----|
| Auth error / "invalid_grant" | `2` | OAuth token expired or revoked | `mgws profiles auth <profile>` |
| General error / API failure | `1` | API error (quota, invalid request) | Read stderr from gws |
| "insufficient_scope" | `1` | Missing API scope on this profile | `mgws profiles rescope <name> --add <service>` (scopes are immutable; this re-adds + re-auths) |
| "ECONNREFUSED" / network | `1` | Network issue | Check internet connectivity |
| "rate limit" / HTTP 429 | `1` | API quota exceeded | Wait and retry, or reduce request rate |

## mgws error codes (in stderr `Error: ... [CODE]`)

| Code | Cause | Fix |
|------|-------|-----|
| `GWS_NOT_FOUND` | gws binary not installed | `mgws setup` |
| `GWS_VERSION_FAILED` | gws binary broken | `npm uninstall -g @googleworkspace/cli && mgws setup` |
| `NO_PROFILE` | No profile specified, no default | `mgws profiles set-default <name>` |
| `PROFILE_NOT_FOUND` | Profile doesn't exist | `mgws profiles list` to see available |
| `PROFILE_NOT_AUTHENTICATED` | Missing tokens | `mgws profiles auth <name>` |
| `PROFILE_CORRUPTED` | Bad meta.json | `mgws profiles remove <name> --force` then re-add |
| `INVALID_PROFILE_NAME` | Bad characters or reserved name | use `[a-z][a-z0-9-]{0,62}`, avoid reserved names |
| `CLIENT_SECRET_NOT_FOUND` | OAuth JSON file missing | check the `--client <path>` value |
| `SCOPE_CAP_EXCEEDED` | Requested scopes exceed the built-in client's ~25-scope testing-mode cap (`--full`, `classroom`/`admin-reports`, or more than the default set) and no `--client` was given | Re-run with `--client <path>` (Internal Workspace / verified OAuth client), a narrower `--scopes`, or set `MGWS_CLIENT_ID`/`MGWS_CLIENT_SECRET`. In an interactive terminal `mgws` instead walks you through creating the client. See [`oauth-bootstrap.md`](oauth-bootstrap.md) |

## Diagnostic Commands

```bash
# Fast environment check (silent on success, exits 63/64 on issues)
mgws preflight
mgws preflight --json    # JSON diagnosis on stderr

# Full system health check (per-profile auth, scopes, paths)
mgws doctor

# Bulk auth status — exits 2 if ANY profile is unauthenticated
mgws profiles status --format json --strict

# Single-profile status
mgws profiles status <name>

# Verbose mode (shows resolved profile + gws command on stderr)
mgws --verbose gmail users messages list --params '{"userId":"me"}'
```

## Common Scenarios

### "Command works for one profile but not another"
Different profiles may have different scopes. **Scopes are immutable on a profile** — `profiles auth` re-uses the existing scope set, so adding a scope requires recreating the profile. `profiles rescope` does the remove + re-add + re-auth in one step (preserving display name and any custom OAuth client):
```bash
mgws profiles list --format json
# Inspect the `scopes` array, then add what's missing:
mgws profiles rescope <name> --add docs,sheets
# Or replace the whole set / go full-access:
mgws profiles rescope <name> --set gmail,calendar,drive,docs
mgws profiles rescope <name> --full
```

### "Onboarding fails with SCOPE_CAP_EXCEEDED"
The requested scopes exceed the built-in (unverified, testing-mode) OAuth client's ~25-scope ceiling — triggered by `--full`, adding `classroom`/`admin-reports`, or requesting more than the default service set, when no `--client` was supplied. `mgws` stops **before** the doomed consent attempt.

```bash
# Option A — narrow the request so it fits the built-in client
mgws profiles add <name> --scopes gmail,calendar,drive

# Option B — use a cap-exempt client (Internal Workspace / verified app)
mgws profiles add <name> --client ~/internal-client.json --full

# Option C — org-wide: point the built-in client at your Internal app once
export MGWS_CLIENT_ID=...; export MGWS_CLIENT_SECRET=...   # gate never trips
mgws profiles add <name> --full
```
In an interactive terminal, `mgws` instead walks you through creating the client and prompts for its path. With `--json`, the error is emitted as `{"success":false,"error":"SCOPE_CAP_EXCEEDED",...}` on stdout. See [`oauth-bootstrap.md`](oauth-bootstrap.md).

### "Token expired after long inactivity"
Google OAuth tokens expire. Simply re-authenticate:
```bash
mgws profiles auth <profile-name>
```

### "gws version mismatch"
If gws API changes break mgws:
```bash
npm update -g @googleworkspace/cli
mgws doctor
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
Rebuild mgws:
```bash
npm uninstall -g multi-gws
npm install -g github:dewdad/multi-gws
```

> The package self-identifies as `multi-gws` (see `package.json`), so `npm uninstall -g multi-gws` is correct even though the install vector is the GitHub URL.

### "I need to use a non-PATH gws binary"
Edit `~/.config/mgws/config.json` (Linux/Mac) or `%APPDATA%\mgws\config.json` (Windows) and set `"gwsBinary"` to an absolute path. Useful for monorepo `node_modules/.bin/gws`, Docker-mounted binaries, or air-gapped installs.

## Self-Healing Sequence

When any command fails unexpectedly:

1. `mgws preflight --json` — fast environment diagnosis
2. If `gws_missing` (exit 63) → `mgws setup`
3. If `no_profiles` (exit 64) → `mgws init <name>` (or `mgws profiles add <name>`)
4. If runtime auth error (exit 2) → `mgws profiles auth <profile>`
5. For a deeper view → `mgws doctor`
6. Found a real bug or doc inaccuracy? Edit the relevant skill file directly with your editing tools.
