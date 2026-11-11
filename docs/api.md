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
- `POST /api/lists/:id/reorder` accepts `taskId`, `targetId`, and `placement` (`before` or `after`) for active tasks sharing a parent (including top-level tasks) in the same list.
- `GET /api/workspace/calendar` returns calendar tasks across active lists. Use `list=<listId>` to narrow the result. `POST /api/tasks` accepts an optional ISO 8601 `dueDate` to create a scheduled task.


## Sidebar hierarchy and list templates

- `POST /api/hierarchy/reorder` accepts `source` and `target` objects with `kind` (`space`, `folder`, or `list`) and `id`, plus `placement` (`before`, `after`, or `inside`). Reorder spaces within the workspace, reorder folders within a space, or move lists into a space or folder.
- `GET /api/list-templates` lists workspace templates. `POST` creates one with `sourceListId`, `name`, and optional `includeTasks`. `PATCH` accepts the same fields plus `id` and replaces that template.
- `PUT /api/list-templates` creates a new list from `templateId`, `name`, `spaceId`, and optional `folderId`. Options are `includeTasks` (default true), `includeDates`, and `includeAutomations` (both default false).


## Forms, relationships, and workload

- `GET|POST|PATCH|DELETE /api/lists/:id/forms` manages intake forms for editors. Forms have a title, description, publish flag, and an array of questions. Each question has a UUID `id`, `label`, `type` (`text`, `paragraph`, `email`, or `choice`), `required`, and `options`. Updates and deletions specify the form `id`.
- `GET /api/public/forms/:key` returns the published form. `POST` accepts `name` and `answers` keyed by question ID, and creates a task in the destination list. The response contains no task details.
- `GET /api/tasks/:id/relationships` lists related tasks and links. `POST` accepts `{ "kind": "task", "otherId": "..." }` or `{ "kind": "link", "title": "...", "url": "https://..." }`. `DELETE` accepts `kind` and relationship `id`.
- `GET /api/workspace/workload` takes ISO `from` and `to` timestamps (exclusive end, maximum eight days) and optional `listId`. It returns open scheduled tasks and their estimates and assignees for the period.

Tasks accept an optional boolean `milestone` when created or updated.

## Subfolders, task types, and view access

- `POST /api/folders` accepts an optional `parentId` in the same space. List creation accepts any folder in the destination space. Folder reordering operates among siblings.
- `GET /api/workspace/task-types` returns workspace task types. Owners and admins manage them with `POST`, `PATCH`, and `DELETE`. Task creation and updates accept `taskTypeId`, and `null` clears it.
- Set `private: true` when creating a list view to limit access to its creator. Owners and admins can use `protected: true` when patching a view to lock its saved settings. Each list retains at least one shared view.
- `GET|POST|DELETE /api/tasks/:id/public-share` retrieves, enables, or revokes a public task summary link. `GET /api/public/tasks/:key` returns the limited summary for an active task and list.

Private view owners can use `GET /api/views/:id/sharing` to list readers and `PATCH` with `{ "action": "readers", "userIds": [] }` to replace read access. Workspace owners and admins can enable or revoke a public summary of a shared List or Table view through the same endpoint with `{ "action": "enable" }` or `{ "action": "revoke" }`. The public endpoint `GET /api/public/views/:key` uses the saved filters and excludes comments, descriptions, and assignee details.
