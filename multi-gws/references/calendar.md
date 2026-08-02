# Calendar Reference

## Quick Commands (shortcuts)

```bash
# Native mgws shortcut (recommended — works regardless of gws version)
mgws agenda --days 7
mgws agenda --days 1                              # Today only
mgws --profile work agenda --days 3               # Work calendar (next 3 days)
mgws --profile work agenda --calendar team@company.com --days 7
```

> The native `mgws agenda` command composes a `calendar.events.list` call internally; it does **not** rely on a gws-side `+agenda` shortcut and works on every supported gws version.

## API Passthrough Commands

```bash
mgws [--profile <name>] calendar <resource> <method> --params '<json>' [--json '<request-body>']
```

### List Calendars
```bash
mgws calendar calendarList list --params '{}'
```

### List Events
```bash
mgws calendar events list --params '{
  "calendarId": "primary",
  "timeMin": "2024-01-01T00:00:00Z",
  "timeMax": "2024-01-31T23:59:59Z",
  "singleEvents": true,
  "orderBy": "startTime",
  "maxResults": 50
}'
```

Key params:
- `calendarId`: `"primary"` or specific calendar ID
- `timeMin`/`timeMax`: RFC 3339 timestamps (required for bounded queries)
- `singleEvents`: `true` to expand recurring events
- `orderBy`: `"startTime"` (requires singleEvents=true) or `"updated"`
- `q`: free-text search

### Get a Single Event
```bash
mgws calendar events get --params '{"calendarId":"primary","eventId":"<event-id>"}'
```

### Create an Event
```bash
mgws calendar events insert --params '{"calendarId":"primary"}' --json '{
  "summary": "Team Standup",
  "description": "Daily sync",
  "start": {"dateTime": "2024-06-15T09:00:00-07:00", "timeZone": "America/Los_Angeles"},
  "end": {"dateTime": "2024-06-15T09:30:00-07:00", "timeZone": "America/Los_Angeles"},
  "attendees": [{"email": "colleague@company.com"}],
  "reminders": {"useDefault": false, "overrides": [{"method": "popup", "minutes": 10}]}
}'
```

### Update an Event
```bash
mgws calendar events patch --params '{"calendarId":"primary","eventId":"<id>"}' --json '{
  "summary": "Updated Title",
  "start": {"dateTime": "2024-06-15T10:00:00-07:00"}
}'
```

### Delete an Event
```bash
mgws calendar events delete --params '{"calendarId":"primary","eventId":"<id>"}'
```

### Quick Add (natural language)
```bash
mgws calendar events quickAdd --params '{"calendarId":"primary","text":"Lunch with Alice tomorrow at noon"}'
```

## All-Day Events

Use `date` instead of `dateTime`:
```json
{
  "start": {"date": "2024-06-15"},
  "end": {"date": "2024-06-16"}
}
```

## Recurring Events

```json
{
  "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10"]
}
```

## Common Patterns for Agents

### "What's on my calendar today?"
```bash
mgws agenda --days 1
```

### "Am I free at 3pm tomorrow?"
```bash
mgws calendar events list --params '{
  "calendarId": "primary",
  "timeMin": "2024-06-16T15:00:00Z",
  "timeMax": "2024-06-16T16:00:00Z",
  "singleEvents": true
}'
```
Empty `items[]` = free.

### "Schedule a meeting"
```bash
mgws calendar events insert --params '{"calendarId":"primary"}' --json '{"summary":"...","start":{"dateTime":"..."},"end":{"dateTime":"..."}}'
```
