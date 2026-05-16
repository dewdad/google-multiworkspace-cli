# Tasks Reference

All Tasks commands use the gws API passthrough pattern:
```bash
gwcli [--profile <name>] tasks <resource> <method> --params '<json>' [--body '<json>']
```

## Task Lists

### List All Task Lists
```bash
gwcli tasks tasklists list --params '{"maxResults":20}'
```

### Get a Task List
```bash
gwcli tasks tasklists get --params '{"tasklist":"<tasklist-id>"}'
```

### Create a Task List
```bash
gwcli tasks tasklists insert --body '{"title":"Work Projects"}'
```

### Update a Task List
```bash
gwcli tasks tasklists patch --params '{"tasklist":"<tasklist-id>"}' --body '{"title":"Renamed List"}'
```

### Delete a Task List
```bash
gwcli tasks tasklists delete --params '{"tasklist":"<tasklist-id>"}'
```

## Tasks

### List Tasks in a List
```bash
gwcli tasks tasks list --params '{"tasklist":"<tasklist-id>","maxResults":50}'
gwcli tasks tasks list --params '{"tasklist":"<tasklist-id>","showCompleted":false}'
gwcli tasks tasks list --params '{"tasklist":"<tasklist-id>","showHidden":true,"showCompleted":true}'
gwcli tasks tasks list --params '{"tasklist":"<tasklist-id>","dueMin":"2024-01-01T00:00:00Z","dueMax":"2024-01-31T23:59:59Z"}'
```

Key params:
- `tasklist`: Task list ID (use `@default` for the default list)
- `showCompleted`: Include completed tasks (default: true)
- `showHidden`: Include hidden tasks (default: false)
- `dueMin`/`dueMax`: Filter by due date (RFC 3339)
- `maxResults`: Max items per page (default: 20, max: 100)

### Get a Task
```bash
gwcli tasks tasks get --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}'
```

### Create a Task
```bash
# Simple task
gwcli tasks tasks insert --params '{"tasklist":"<tasklist-id>"}' --body '{
  "title": "Review pull request",
  "notes": "Check the auth module changes",
  "due": "2024-06-15T00:00:00Z"
}'

# Subtask (insert after parent)
gwcli tasks tasks insert --params '{"tasklist":"<tasklist-id>","parent":"<parent-task-id>"}' --body '{
  "title": "Check test coverage"
}'

# Insert at specific position
gwcli tasks tasks insert --params '{"tasklist":"<tasklist-id>","previous":"<sibling-task-id>"}' --body '{
  "title": "After this task"
}'
```

### Update a Task
```bash
gwcli tasks tasks patch --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}' --body '{
  "title": "Updated title",
  "notes": "Added details",
  "due": "2024-06-20T00:00:00Z"
}'
```

### Complete a Task
```bash
gwcli tasks tasks patch --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}' --body '{
  "status": "completed"
}'
```

### Uncomplete a Task
```bash
gwcli tasks tasks patch --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}' --body '{
  "status": "needsAction",
  "completed": null
}'
```

### Delete a Task
```bash
gwcli tasks tasks delete --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}'
```

### Move a Task (reorder or re-parent)
```bash
# Move to top of list
gwcli tasks tasks move --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}'

# Move after another task
gwcli tasks tasks move --params '{"tasklist":"<tasklist-id>","task":"<task-id>","previous":"<other-task-id>"}'

# Make a subtask of another task
gwcli tasks tasks move --params '{"tasklist":"<tasklist-id>","task":"<task-id>","parent":"<parent-task-id>"}'
```

### Clear Completed Tasks
```bash
gwcli tasks tasks clear --params '{"tasklist":"<tasklist-id>"}'
```

## Task Structure

```json
{
  "id": "task-id",
  "title": "Task title",
  "notes": "Optional description",
  "status": "needsAction",
  "due": "2024-06-15T00:00:00.000Z",
  "completed": null,
  "parent": "parent-task-id",
  "position": "00000000000000000001",
  "links": [{"type": "email", "description": "Related email", "link": "https://..."}]
}
```

Status values: `needsAction`, `completed`

## Common Patterns for Agents

### "Show my tasks"
```bash
gwcli tasks tasklists list --params '{"maxResults":10}'
# Then for each list:
gwcli tasks tasks list --params '{"tasklist":"<id>","showCompleted":false}'
```

### "What's due this week?"
```bash
gwcli tasks tasks list --params '{"tasklist":"@default","dueMin":"2024-06-10T00:00:00Z","dueMax":"2024-06-16T23:59:59Z","showCompleted":false}'
```

### "Add a task"
```bash
gwcli tasks tasks insert --params '{"tasklist":"@default"}' --body '{"title":"New task","due":"2024-06-15T00:00:00Z"}'
```

### "Mark task done"
```bash
gwcli tasks tasks patch --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}' --body '{"status":"completed"}'
```

### "Create a project with subtasks"
```bash
# Create parent
gwcli tasks tasks insert --params '{"tasklist":"<id>"}' --body '{"title":"Project Alpha"}'
# Create subtasks under parent
gwcli tasks tasks insert --params '{"tasklist":"<id>","parent":"<parent-id>"}' --body '{"title":"Phase 1: Research"}'
gwcli tasks tasks insert --params '{"tasklist":"<id>","parent":"<parent-id>"}' --body '{"title":"Phase 2: Implement"}'
```

## Pagination

When `nextPageToken` appears in response:
```bash
gwcli tasks tasks list --params '{"tasklist":"<id>","maxResults":50,"pageToken":"<token>"}'
```

## Default Task List

Use `@default` as the tasklist ID to target the user's default "My Tasks" list:
```bash
gwcli tasks tasks list --params '{"tasklist":"@default","showCompleted":false}'
```
