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

**Required**: OAuth client secret JSON from Google Cloud Console.

**Available scopes**: `gmail`, `calendar`, `drive`, `docs`, `sheets`, `keep`, `tasks`  
Default: `gmail,calendar,drive,docs,sheets,keep,tasks`

After creating, the CLI opens a browser for OAuth consent. The user must authenticate.

### Remove a Profile
```bash
gwcli profiles remove <name>
```
Deletes credentials and metadata. Irreversible.

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
gwcli profiles auth <name>
```
Opens browser for fresh OAuth flow. Use when tokens expire or scopes change.

### Check Auth Status
```bash
gwcli profiles status <name>
```

## Multi-Account Workflows

### Using Specific Profile for One Command
```bash
gwcli --profile work gmail users messages list --params '{"userId":"me","maxResults":5}'
```

### Environment Variable Override
```bash
GWCLI_PROFILE=personal gwcli calendar +agenda --days 3
```

### Cross-Account Operations
```bash
# Read email from work, create event on personal
work_emails=$(gwcli --profile work gmail users messages list --params '{"userId":"me","q":"meeting invite","maxResults":1}')
gwcli --profile personal calendar events insert --params '{"calendarId":"primary"}' --body '<event>'
```

## OAuth Client Setup Guide (for helping users)

1. Go to https://console.cloud.google.com/
2. Create project or select existing
3. Enable APIs: Gmail API, Google Calendar API, Google Drive API
4. Go to **APIs & Services > Credentials**
5. Click **Create Credentials > OAuth client ID**
6. Application type: **Desktop app**
7. Download the JSON file
8. Provide path to: `gwcli profiles add <name> --client <downloaded-file.json>`

## Troubleshooting Profiles

| Symptom | Cause | Fix |
|---------|-------|-----|
| "No profile specified" | No default, no --profile | `gwcli profiles set-default <name>` |
| "Profile not authenticated" | Tokens missing/expired | `gwcli profiles auth <name>` |
| "Profile corrupted" | Missing meta.json | Remove + re-add the profile |
| "Invalid grant" | OAuth revoked externally | `gwcli profiles auth <name>` |
