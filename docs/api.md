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
