# Drive, Docs & Sheets Reference

## Drive Files

```bash
mgws [--profile <name>] drive <resource> <method> --params '<json>' [--json '<request-body>'] [--upload <path> --upload-content-type <mime>]
```

> **Flag surface (gws 0.22.x — verified against `--help`).** There is **no
> `--fields` flag** — field masks go **inside** `--params` as a `"fields"` key.
> File **metadata** for create/update goes in **`--json`** (not `--body`); the
> **binary content** goes in **`--upload`** (see "Upload a binary file").
> **Output** is JSON on stdout; a `Using keyring backend: file` line is written
> to stderr — read stdout only (or `2>/dev/null`) before parsing.

### List Files
```bash
mgws drive files list --params '{"pageSize":20}'
mgws drive files list --params '{"pageSize":20,"q":"mimeType=\"application/vnd.google-apps.document\""}'
mgws drive files list --params '{"pageSize":10,"q":"name contains \"report\"","fields":"files(id,name,mimeType,modifiedTime)"}'
```

### Search Files
Query operators for `q` param:
- `name contains 'text'` — filename search
- `mimeType = 'application/vnd.google-apps.spreadsheet'` — by type
- `'<folder-id>' in parents` — in specific folder
- `modifiedTime > '2024-01-01T00:00:00'` — recent changes
- `trashed = false` — exclude trash

MIME types:
- `application/vnd.google-apps.document` — Google Doc
- `application/vnd.google-apps.spreadsheet` — Google Sheet
- `application/vnd.google-apps.presentation` — Google Slides
- `application/vnd.google-apps.folder` — Folder

### Get File Metadata
```bash
mgws drive files get --params '{"fileId":"<id>","fields":"id,name,mimeType,size,modifiedTime,webViewLink"}'
```

### Download a File
```bash
# Binary files (PDF, images, etc.)
mgws drive files get --params '{"fileId":"<id>","alt":"media"}' > output.pdf
```

### Export Google Docs/Sheets/Slides
```bash
# Export Google Doc as plain text
mgws drive files export --params '{"fileId":"<id>","mimeType":"text/plain"}'

# Export as PDF
mgws drive files export --params '{"fileId":"<id>","mimeType":"application/pdf"}' > doc.pdf

# Export Sheet as CSV
mgws drive files export --params '{"fileId":"<id>","mimeType":"text/csv"}'
```

Export MIME types:
- Google Docs: `text/plain`, `text/html`, `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Google Sheets: `text/csv`, `application/pdf`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Google Slides: `application/pdf`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`

### Create a File (Google-native: Doc/Sheet/Slides/folder)
```bash
mgws drive files create --params '{"name":"New Document","mimeType":"application/vnd.google-apps.document","parents":["<folder-id>"]}'

# Create a folder
mgws drive files create --json '{"name":"My Folder","mimeType":"application/vnd.google-apps.folder","parents":["<parent-folder-id>"]}'
```

### Upload a binary file (PDF, image, etc.)
```bash
# Metadata (name/parents) goes in --json; the file bytes go in --upload.
# IMPORTANT: --upload only accepts a RELATIVE path INSIDE the current working
# directory. Absolute paths or paths outside CWD are rejected
# ("resolves to ... which is outside the current directory").
# So cd into the file's directory first and pass a bare relative name.
cd /path/to/files
mgws drive files create \
  --json '{"name":"report.pdf","parents":["<folder-id>"]}' \
  --upload report.pdf --upload-content-type application/pdf
```

### List Folder Contents
```bash
mgws drive files list --params '{"q":"\"<folder-id>\" in parents","pageSize":50,"fields":"files(id,name,mimeType)"}'
```

## Pagination

When `nextPageToken` appears:
```bash
mgws drive files list --params '{"pageSize":20,"pageToken":"<token>"}'
```

## Common Patterns for Agents

### "Find my recent documents"
```bash
mgws drive files list --params '{"pageSize":10,"orderBy":"modifiedTime desc","q":"mimeType=\"application/vnd.google-apps.document\"","fields":"files(id,name,modifiedTime)"}'
```

### "Get contents of a Google Doc"
```bash
mgws drive files export --params '{"fileId":"<id>","mimeType":"text/plain"}'
```

### "Search across all files"
```bash
mgws drive files list --params '{"q":"fullText contains \"quarterly report\"","pageSize":5,"fields":"files(id,name,mimeType,webViewLink)"}'
```
