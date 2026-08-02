# Tasks Reference

All Tasks commands use the gws API passthrough pattern:
```bash
mgws [--profile <name>] tasks <resource> <method> --params '<json>' [--json '<request-body>']
```

## Task Lists

### List All Task Lists
```bash
mgws tasks tasklists list --params '{"maxResults":20}'
```

### Get a Task List
```bash
mgws tasks tasklists get --params '{"tasklist":"<tasklist-id>"}'
```

### Create a Task List
```bash
mgws tasks tasklists insert --json '{"title":"Work Projects"}'
```

### Update a Task List
```bash
mgws tasks tasklists patch --params '{"tasklist":"<tasklist-id>"}' --json '{"title":"Renamed List"}'
```

### Delete a Task List
```bash
mgws tasks tasklists delete --params '{"tasklist":"<tasklist-id>"}'
```

## Tasks

### List Tasks in a List
```bash
mgws tasks tasks list --params '{"tasklist":"<tasklist-id>","maxResults":50}'
mgws tasks tasks list --params '{"tasklist":"<tasklist-id>","showCompleted":false}'
mgws tasks tasks list --params '{"tasklist":"<tasklist-id>","showHidden":true,"showCompleted":true}'
mgws tasks tasks list --params '{"tasklist":"<tasklist-id>","dueMin":"2024-01-01T00:00:00Z","dueMax":"2024-01-31T23:59:59Z"}'
```

Key params:
- `tasklist`: Task list ID (use `@default` for the default list)
- `showCompleted`: Include completed tasks (default: true)
- `showHidden`: Include hidden tasks (default: false)
- `dueMin`/`dueMax`: Filter by due date (RFC 3339)
- `maxResults`: Max items per page (default: 20, max: 100)

### Get a Task
```bash
mgws tasks tasks get --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}'
```

### Create a Task
```bash
# Simple task
mgws tasks tasks insert --params '{"tasklist":"<tasklist-id>"}' --json '{
  "title": "Review pull request",
  "notes": "Check the auth module changes",
  "due": "2024-06-15T00:00:00Z"
}'

# Subtask (insert after parent)
mgws tasks tasks insert --params '{"tasklist":"<tasklist-id>","parent":"<parent-task-id>"}' --json '{
  "title": "Check test coverage"
}'

# Insert at specific position
mgws tasks tasks insert --params '{"tasklist":"<tasklist-id>","previous":"<sibling-task-id>"}' --json '{
  "title": "After this task"
}'
```

### Update a Task
```bash
mgws tasks tasks patch --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}' --json '{
  "title": "Updated title",
  "notes": "Added details",
  "due": "2024-06-20T00:00:00Z"
}'
```

### Complete a Task
```bash
mgws tasks tasks patch --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}' --json '{
  "status": "completed"
}'
```

### Uncomplete a Task
```bash
mgws tasks tasks patch --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}' --json '{
  "status": "needsAction",
  "completed": null
}'
```

### Delete a Task
```bash
mgws tasks tasks delete --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}'
```

### Move a Task (reorder or re-parent)
```bash
# Move to top of list
mgws tasks tasks move --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}'

# Move after another task
mgws tasks tasks move --params '{"tasklist":"<tasklist-id>","task":"<task-id>","previous":"<other-task-id>"}'

# Make a subtask of another task
mgws tasks tasks move --params '{"tasklist":"<tasklist-id>","task":"<task-id>","parent":"<parent-task-id>"}'
```

### Clear Completed Tasks
```bash
mgws tasks tasks clear --params '{"tasklist":"<tasklist-id>"}'
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
mgws tasks tasklists list --params '{"maxResults":10}'
# Then for each list:
mgws tasks tasks list --params '{"tasklist":"<id>","showCompleted":false}'
```

### "What's due this week?"
```bash
mgws tasks tasks list --params '{"tasklist":"@default","dueMin":"2024-06-10T00:00:00Z","dueMax":"2024-06-16T23:59:59Z","showCompleted":false}'
```

### "Add a task"
```bash
mgws tasks tasks insert --params '{"tasklist":"@default"}' --json '{"title":"New task","due":"2024-06-15T00:00:00Z"}'
```

### "Mark task done"
```bash
mgws tasks tasks patch --params '{"tasklist":"<tasklist-id>","task":"<task-id>"}' --json '{"status":"completed"}'
```

### "Create a project with subtasks"
```bash
# Create parent
mgws tasks tasks insert --params '{"tasklist":"<id>"}' --json '{"title":"Project Alpha"}'
# Create subtasks under parent
mgws tasks tasks insert --params '{"tasklist":"<id>","parent":"<parent-id>"}' --json '{"title":"Phase 1: Research"}'
mgws tasks tasks insert --params '{"tasklist":"<id>","parent":"<parent-id>"}' --json '{"title":"Phase 2: Implement"}'
```

## Pagination

When `nextPageToken` appears in response:
```bash
mgws tasks tasks list --params '{"tasklist":"<id>","maxResults":50,"pageToken":"<token>"}'
```

## Default Task List

Use `@default` as the tasklist ID to target the user's default "My Tasks" list:
```bash
mgws tasks tasks list --params '{"tasklist":"@default","showCompleted":false}'
```
