# Keep Reference

> **⚠ Most users cannot use this API.** Google's official Keep API is Workspace-only and requires an admin to enable the Keep API in the Google Cloud project. Personal `@gmail.com` accounts — which are likely most `gwcli` users — will get `403 PERMISSION_DENIED` or `insufficient_scope` on every command in this reference. `gwcli` does not work around this; the error from `gws` is the signal that the API is not available for that account.
>
> **If you're on personal Gmail, skip the rest of this reference** and read [Consumer Keep alternatives](#consumer-keep-alternatives-personal-gmailcom) below. The Workspace API surface documented after that section will not work for you.

## Consumer Keep alternatives (personal `@gmail.com`)

There is no consumer Keep support in `gws`, and therefore none in `gwcli`. There is no roadmap to add it — Google has not exposed a public API for consumer Keep, and `gwcli` does not call Google APIs directly.

For consumer Keep access, the community has built two unofficial paths:

- **[KeepSidian](https://github.com/lc0rp/KeepSidian)** — Obsidian plugin, 2-way sync between Google Keep and an Obsidian vault. Best fit if you already use Obsidian.
- **[Keep-It-Markdown (KIM)](https://github.com/djsudduth/keep-it-markdown)** — Python CLI, exports Keep notes to markdown files. Best fit outside Obsidian. KeepSidian's sync server is built on top of KIM.

Read before installing either:

- **Unofficial API.** Both projects rely on `gkeepapi`, which speaks Keep's internal mobile-client endpoints. Google does not document or support this surface; it can break, throttle, or be revoked without notice.
- **Master-token auth, not OAuth.** Authentication uses a token captured from a Google Android sign-in flow — a separate trust decision from `gwcli`'s OAuth profiles. The token grants broad account access; treat it as a credential, not a session.
- **Independent of `gwcli`.** No shared credentials, no shared profiles, no integration. These tools are mentioned here only because the official-API path is not available to consumer accounts.
- **Account risk.** Some users have reported Google security challenges after using master-token tools. Evaluate the projects, their maintenance status, and your own risk tolerance before proceeding.

**Agents:** do **not** install, configure, or invoke KeepSidian or KIM on the user's behalf. If a user asks for consumer Keep access, surface the links above with the caveats, then stop. These tools live outside `gwcli`'s trust and support boundary.

---

The remainder of this reference applies **only to Workspace profiles** where an admin has enabled the Keep API in the associated Google Cloud project.

All Keep commands use the gws API passthrough pattern:
```bash
gwcli [--profile <name>] keep <resource> <method> --params '<json>' [--json '<request-body>']
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
gwcli keep notes create --json '{
  "title": "Shopping List",
  "body": {"text": {"text": "Milk\nEggs\nBread"}}
}'

# List note (checkboxes)
gwcli keep notes create --json '{
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
gwcli keep notes permissions create --params '{"parent":"notes/<note-id>"}' --json '{
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
gwcli keep notes create --json '{"title":"Quick Note","body":{"text":{"text":"Content here"}}}'
```

### "Create a checklist"
```bash
gwcli keep notes create --json '{
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
