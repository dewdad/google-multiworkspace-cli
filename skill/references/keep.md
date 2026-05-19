# Keep Reference

> **⚠ Enterprise/Workspace only.** The Google Keep API is gated to Google Workspace accounts with admin-level enablement of the Keep API. **Consumer Gmail accounts (`@gmail.com`) cannot use this API** — Keep on consumer accounts has no public API. Calls will fail with `insufficient_scope` or `403 PERMISSION_DENIED`. Verify the target profile is a Workspace account and that the admin has enabled the Keep API in the Google Cloud project before troubleshooting.

All Keep commands use the gws API passthrough pattern:
```bash
gwcli [--profile <name>] keep <resource> <method> --params '<json>' [--body '<json>']
```

## Common Operations

### List Notes
```bash
gwcli keep notes list --params '{"pageSize":25}'
gwcli keep notes list --params '{"pageSize":50,"filter":"trashed=false"}'
```

### Get a Note
```bash
gwcli keep notes get --params '{"name":"notes/<note-id>"}'
```

The `name` field uses the format `notes/<note-id>`.

### Create a Note
```bash
# Simple text note
gwcli keep notes create --body '{
  "title": "Shopping List",
  "body": {"text": {"text": "Milk\nEggs\nBread"}}
}'

# List note (checkboxes)
gwcli keep notes create --body '{
  "title": "TODO",
  "body": {"list": {"listItems": [
    {"text": {"text": "Buy groceries"}, "checked": false},
    {"text": {"text": "Call dentist"}, "checked": false},
    {"text": {"text": "Send invoice"}, "checked": true}
  ]}}
}'
```

### Delete a Note (Trash)
```bash
gwcli keep notes delete --params '{"name":"notes/<note-id>"}'
```

## Note Structure

A note body is either text or a list (not both):

### Text Note
```json
{
  "title": "My Note",
  "body": {
    "text": {"text": "Free-form content here.\nSupports newlines."}
  }
}
```

### List Note (Checkboxes)
```json
{
  "title": "Tasks",
  "body": {
    "list": {
      "listItems": [
        {"text": {"text": "Item 1"}, "checked": false},
        {"text": {"text": "Item 2"}, "checked": true}
      ]
    }
  }
}
```

## Labels

### List Labels
```bash
gwcli keep notes list --params '{"filter":"label=MyLabel"}'
```

## Permissions (Sharing)

### List Permissions on a Note
```bash
gwcli keep notes permissions list --params '{"parent":"notes/<note-id>"}'
```

### Share a Note
```bash
gwcli keep notes permissions create --params '{"parent":"notes/<note-id>"}' --body '{
  "email": "colleague@example.com",
  "role": "WRITER"
}'
```

Roles: `WRITER`, `READER`

## Common Patterns for Agents

### "Show my notes"
```bash
gwcli keep notes list --params '{"pageSize":20}'
```

### "Create a quick note"
```bash
gwcli keep notes create --body '{"title":"Quick Note","body":{"text":{"text":"Content here"}}}'
```

### "Create a checklist"
```bash
gwcli keep notes create --body '{
  "title": "Checklist",
  "body": {"list": {"listItems": [
    {"text": {"text": "Item 1"}, "checked": false},
    {"text": {"text": "Item 2"}, "checked": false}
  ]}}
}'
```

### "Find a specific note"
```bash
gwcli keep notes list --params '{"filter":"trashed=false","pageSize":50}'
```
Then search the results by title/content.

## Pagination

When `nextPageToken` appears in response:
```bash
gwcli keep notes list --params '{"pageSize":25,"pageToken":"<token>"}'
```

## Limitations

- Google Keep API has limited search/filter capabilities compared to other Workspace APIs
- No full-text search parameter — list and filter client-side
- Notes are either text OR list, not mixed
- Images and drawings are read-only via API
