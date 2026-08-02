# Gmail Reference

All Gmail commands use the gws API passthrough pattern:
```bash
mgws [--profile <name>] gmail <resource> <method> --params '<json>' [--json '<request-body>'] [--upload <path> --upload-content-type <mime>]
```

> **Flag surface (gws 0.22.x — verified against `--help`).** The request body
> is passed with **`--json`**, NOT `--body`. There is **no `--fields` flag** —
> field masks go **inside** `--params` as a `"fields"` key (see "Field Masks").
> Binary content (attachments) uses **`--upload`** (see "Send with attachment").
> **Output:** the JSON payload is on **stdout**; a `Using keyring backend: file`
> line is written to **stderr**. When capturing, read stdout only (or append
> `2>/dev/null`) before `JSON.parse` / `json.loads`, or strip any leading
> non-JSON line.

## Common Operations

### List Messages (inbox)
```bash
mgws gmail users messages list --params '{"userId":"me","maxResults":20}'
mgws gmail users messages list --params '{"userId":"me","maxResults":10,"q":"is:unread"}'
mgws gmail users messages list --params '{"userId":"me","q":"from:boss@company.com after:2024/01/01"}'
```

Useful `q` operators: `is:unread`, `is:starred`, `from:`, `to:`, `subject:`, `after:YYYY/MM/DD`, `before:YYYY/MM/DD`, `has:attachment`, `label:`, `in:inbox`, `in:sent`

### Get a Message (full content)
```bash
mgws gmail users messages get --params '{"userId":"me","id":"<message-id>","format":"full"}'
```

Format options: `full` (headers+body), `metadata` (headers only), `minimal` (ids only), `raw` (base64 RFC 2822)

### Get Thread (conversation)
```bash
mgws gmail users threads get --params '{"userId":"me","id":"<thread-id>","format":"full"}'
```

### Send a Message
```bash
# Raw RFC 2822 base64url-encoded
mgws gmail users messages send --params '{"userId":"me"}' --json '{"raw":"<base64url-encoded-message>"}'
```

To construct the `raw` field, base64url-encode an RFC 2822 message:
```
From: me@gmail.com
To: recipient@example.com
Subject: Hello
Content-Type: text/plain; charset="UTF-8"

Message body here.
```

### Create a Draft
```bash
mgws gmail users drafts create --params '{"userId":"me"}' --json '{"message":{"raw":"<base64url>"}}'
```

### Reply to a Message
```bash
# Include In-Reply-To and References headers in the raw message
# Set threadId to keep in same thread
mgws gmail users messages send --params '{"userId":"me"}' --json '{"raw":"<base64url>","threadId":"<thread-id>"}'
```

### Send with an attachment
```bash
# The message metadata/body goes in --json; the binary file in --upload.
# NOTE: --upload paths must be RELATIVE and inside the current working
# directory (the CLI rejects absolute paths or paths outside CWD). cd first.
mgws gmail users messages send --params '{"userId":"me"}' \
  --json '{"raw":"<base64url>"}' \
  --upload ./attachment.pdf --upload-content-type application/pdf
```

### Modify Labels (archive, star, mark read)
```bash
# Archive (remove INBOX label)
mgws gmail users messages modify --params '{"userId":"me","id":"<id>"}' --json '{"removeLabelIds":["INBOX"]}'

# Mark as read
mgws gmail users messages modify --params '{"userId":"me","id":"<id>"}' --json '{"removeLabelIds":["UNREAD"]}'

# Star
mgws gmail users messages modify --params '{"userId":"me","id":"<id>"}' --json '{"addLabelIds":["STARRED"]}'
```

### Delete a Message
```bash
mgws gmail users messages trash --params '{"userId":"me","id":"<id>"}'
```

### List Labels
```bash
mgws gmail users labels list --params '{"userId":"me"}'
```

## Field Masks

Reduce response size by adding a `"fields"` key **inside** `--params` (there is
no `--fields` flag):
```bash
mgws gmail users messages list --params '{"userId":"me","fields":"messages(id,threadId,snippet,labelIds)"}'
mgws gmail users messages get --params '{"userId":"me","id":"<id>","fields":"payload(headers,body),snippet"}'
```

## Pagination

When `nextPageToken` is present in response:
```bash
mgws gmail users messages list --params '{"userId":"me","maxResults":20,"pageToken":"<token>"}'
```

## Common Patterns for Agents

### Check for new unread emails
```bash
mgws gmail users messages list --params '{"userId":"me","q":"is:unread","maxResults":5,"fields":"messages(id,threadId),resultSizeEstimate"}'
```

### Search and summarize
```bash
# Get IDs
ids=$(mgws gmail users messages list --params '{"userId":"me","q":"subject:invoice","maxResults":3}')
# Get each message
mgws gmail users messages get --params '{"userId":"me","id":"<id>","format":"metadata","fields":"payload/headers"}'
```
