# Troubleshooting

## Error → Fix Table

| Error | Exit Code | Cause | Fix |
|-------|-----------|-------|-----|
| `GWS_NOT_FOUND` | — | gws binary not installed | `npm install -g @googleworkspace/cli` |
| `GWS_VERSION_FAILED` | — | gws binary broken | `npm uninstall -g @googleworkspace/cli && npm install -g @googleworkspace/cli` |
| `NO_PROFILE` | — | No profile specified, no default | `gwcli profiles set-default <name>` |
| `PROFILE_NOT_FOUND` | — | Profile doesn't exist | `gwcli profiles list` to see available |
| `PROFILE_NOT_AUTHENTICATED` | — | Missing tokens | `gwcli profiles auth <name>` |
| `PROFILE_CORRUPTED` | — | Bad meta.json | `gwcli profiles remove <name>` then re-add |
| Auth error | 2 | Token expired/revoked | `gwcli profiles auth <profile>` |
| General error | 1 | API error (quota, invalid request) | Read stderr output from gws |
| "invalid_grant" | 2 | OAuth token revoked | `gwcli profiles auth <profile>` |
| "insufficient_scope" | 1 | Missing API scope | Re-add profile with needed scopes |
| "ECONNREFUSED" | 1 | Network issue | Check internet connectivity |
| "rate limit" / 429 | 1 | API quota exceeded | Wait and retry, or reduce request rate |

## Diagnostic Commands

```bash
# Full system health check
gwcli doctor

# Check specific profile
gwcli profiles status <name>

# Verbose mode (shows resolved profile + gws command)
gwcli --verbose gmail users messages list --params '{"userId":"me"}'
```

## Common Scenarios

### "Command works for one profile but not another"
Different profiles may have different scopes. Check:
```bash
gwcli profiles list --format json
```
Look at `scopes` array. Re-add with missing scope:
```bash
gwcli profiles remove <name>
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

## Self-Healing Sequence

When any command fails unexpectedly:

1. Run `gwcli doctor` — check system health
2. If auth issue → `gwcli profiles auth <profile>`
3. If binary issue → `node "$SKILL_DIR/scripts/setup.mjs"`
4. If still broken → Check `node "$SKILL_DIR/scripts/doctor.mjs"` for full JSON diagnostic
5. Log the issue to `$SKILL_DIR/.feedback/issues.jsonl` for skill improvement
