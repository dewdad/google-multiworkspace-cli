# Drive, Docs & Sheets Reference

## Drive Files

```bash
gwcli [--profile <name>] drive <resource> <method> --params '<json>' [--fields '<mask>']
```

### List Files
```bash
gwcli drive files list --params '{"pageSize":20}'
gwcli drive files list --params '{"pageSize":20,"q":"mimeType=\"application/vnd.google-apps.document\""}'
gwcli drive files list --params '{"pageSize":10,"q":"name contains \"report\""}' --fields 'files(id,name,mimeType,modifiedTime)'
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
gwcli drive files get --params '{"fileId":"<id>"}' --fields 'id,name,mimeType,size,modifiedTime,webViewLink'
```

### Download a File
```bash
# Binary files (PDF, images, etc.)
gwcli drive files get --params '{"fileId":"<id>","alt":"media"}' > output.pdf
```

### Export Google Docs/Sheets/Slides
```bash
# Export Google Doc as plain text
gwcli drive files export --params '{"fileId":"<id>","mimeType":"text/plain"}'

# Export as PDF
gwcli drive files export --params '{"fileId":"<id>","mimeType":"application/pdf"}' > doc.pdf

# Export Sheet as CSV
gwcli drive files export --params '{"fileId":"<id>","mimeType":"text/csv"}'
```

Export MIME types:
- Google Docs: `text/plain`, `text/html`, `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Google Sheets: `text/csv`, `application/pdf`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Google Slides: `application/pdf`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`

### Create a File
```bash
gwcli drive files create --params '{"name":"New Document","mimeType":"application/vnd.google-apps.document","parents":["<folder-id>"]}'
```

### List Folder Contents
```bash
gwcli drive files list --params '{"q":"\"<folder-id>\" in parents","pageSize":50}' --fields 'files(id,name,mimeType)'
```

## Pagination

When `nextPageToken` appears:
```bash
gwcli drive files list --params '{"pageSize":20,"pageToken":"<token>"}'
```

## Common Patterns for Agents

### "Find my recent documents"
```bash
gwcli drive files list --params '{"pageSize":10,"orderBy":"modifiedTime desc","q":"mimeType=\"application/vnd.google-apps.document\""}' --fields 'files(id,name,modifiedTime)'
```

### "Get contents of a Google Doc"
```bash
gwcli drive files export --params '{"fileId":"<id>","mimeType":"text/plain"}'
```

### "Search across all files"
```bash
gwcli drive files list --params '{"q":"fullText contains \"quarterly report\"","pageSize":5"}' --fields 'files(id,name,mimeType,webViewLink)'
```
