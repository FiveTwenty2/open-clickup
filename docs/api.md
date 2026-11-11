# Open ClickUp API

In the app, open your profile menu and select **API tokens**. Create a read-only token for reporting, or enable task edits for an integration that needs to write. Copy the token when it appears. You can revoke it from the same menu and it expires after 90 days. The app stores only a digest of the token.

Send `Authorization: Bearer <token>` with each request. For the local preview:

```powershell
$base = "http://localhost:3301"
$headers = @{ Authorization = "Bearer $env:OPEN_CLICKUP_TOKEN" }
$workspace = Invoke-RestMethod "$base/api/bootstrap" -Headers $headers
$workspace.workspace.spaces | Select-Object name, lists, folders
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/bootstrap` | Workspace hierarchy, list IDs and members |
| GET | `/api/me` | Token owner's identity and workspace role |
| GET | `/api/search?q=release` | Search for task and list names |
| GET | `/api/lists/{listId}` | Tasks, subtasks, statuses, views and custom field definitions |
| GET | `/api/tasks/{taskId}` | Task details, comments and checklists |
| GET | `/api/workspace/tasks?q=release&status=open` | Paginated tasks across lists |
| GET | `/api/dashboard` | Workspace counts, due work and tracked time |
| GET | `/api/lists/{listId}/csv` | Export active tasks and subtasks as CSV |
| POST | `/api/lists/{listId}/csv` | Validate or import up to 500 task rows |
| GET | `/api/tasks/recovery?mode=trash` | List recoverable tasks or use `mode=archive` |
| POST | `/api/tasks/recovery` | Restore an archived or trashed task by ID |
| POST | `/api/tasks` | Create a task or subtask |
| PATCH | `/api/tasks/{taskId}` | Edit a task, including its status and assignees |

```powershell
$task = Invoke-RestMethod "$base/api/tasks" -Method Post -Headers $headers -ContentType "application/json" -Body (@{
  listId = $listId
  name = "Review the release"
} | ConvertTo-Json)

Invoke-RestMethod "$base/api/tasks/$($task.id)" -Method Patch -Headers $headers -ContentType "application/json" -Body (@{
  statusId = $closedStatusId
} | ConvertTo-Json)
```

Get `$listId` from the workspace response and `$closedStatusId` from that list's statuses. Add `parentId` to the create request to create a subtask. A token has the permissions of its owner within its workspace. A read-only token cannot write, and tokens cannot delete tasks or manage other tokens. Error responses use JSON with an `error` field. Expect 401 for an invalid, expired or revoked token, 403 for insufficient permissions, and 404 for an unavailable resource.

CSV import accepts `{ "csv": "...", "preview": true }`. Use `preview: false` to write once the returned `errors` array is empty. A file must contain `Task Name` (or `Name`). Optional fields are `Task ID`, `Parent Task ID`, `Status`, `Priority`, `Assignees`, `Start Date`, `Due Date` and `Description`. Parent IDs must refer to rows in the same file. Use ISO dates and assignee emails. A failed validation writes no tasks.


## Communication and audit

These endpoints use the signed-in browser session.

- `GET /api/messages?peer=<userId>` reads a direct conversation. Use `before=<messageId>` to fetch older messages. `POST /api/messages` takes `{ "peerId": "...", "body": "..." }`.
- `POST /api/tasks/:id/comments` accepts JSON with `body` and optional `parentId`. For files, use multipart form data with the same fields and repeat the `files` field for each attachment. Up to five files and 50 MB total are allowed. Attachment metadata includes an ID for `GET /api/comment-files/:id`.
- `GET /api/notifications` accepts `filter=all|unread|archive` and zero-based `page`. `PATCH /api/notifications` takes `ids` and `action=read|unread|archive|restore`.
- `GET /api/audit` is available to workspace owners and admins. Filter by `actor` (user ID), `action=recovery|discussion`, and `q` (task name). Use zero-based `page` for older entries.

## List archive, manual order, and calendar

- `PATCH /api/lists/:id` accepts `{ "archived": true }` to archive a list and `false` to restore it. `GET /api/lists/archive?q=&page=0` lists archived lists.
- `POST /api/lists/:id/reorder` accepts `taskId`, `targetId`, and `placement` (`before` or `after`) for active top-level tasks in the same list.
- `GET /api/workspace/calendar` returns calendar tasks across active lists. Use `list=<listId>` to narrow the result. `POST /api/tasks` accepts an optional ISO 8601 `dueDate` to create a scheduled task.
