# ClickUp compatibility

This audit compares user workflows in the fork with ClickUp's product guides. AI and automation are excluded from the parity target. A listed feature is partial when it only supports some of the documented workflow. No claim is made about ClickUp API wire compatibility or performance at ClickUp's published limits.

| Area | Available in the fork | Important gaps |
| --- | --- | --- |
| [Hierarchy and tasks](https://help.clickup.com/hc/en-us/articles/6311563319063-Core-ClickUp-features) | Spaces, folders, lists, tasks, nested subtasks, archives, task Trash, custom list statuses, milestones, drag ordering, fields, checklists, dependencies and simple recurrence | Subfolders, tasks in multiple lists, custom task types, sprints and sprint reporting, richer recurrence schedules, location-level status inheritance |
| [Views](https://help.clickup.com/hc/en-us/sections/39723873580823-Views) | List, Board, Table, Gantt and Calendar per list. Workspace Calendar, All Tasks, activity history and weekly Workload. Saved filters and defaults on list views | Most views at folder, space and workspace levels. Timeline, Team, Mind Map, Map, Embed, Whiteboard, view locking, private views and advanced Gantt features |
| [Forms](https://help.clickup.com/hc/en-us/articles/6310233090711-Intro-to-Forms-and-Form-view) | List form builder, preview, publish and unpublish, public response link, required text, paragraph, email and choice questions. Responses create tasks | Conditional logic, custom field mapping, file uploads, authenticated forms, embedding and a central Forms Hub |
| [Relationships](https://help.clickup.com/hc/en-us/articles/6304528030743-Intro-to-Relationships) | Two-way task links, external web links and task dependencies | Doc relationships, custom relationship fields, rollups and relationships across workspaces |
| [Workload](https://help.clickup.com/hc/en-us/articles/6310449699735-Use-Workload-view) | Weekly capacity comparison, time estimates split across weekdays and assignees, unassigned tasks and estimate gaps, list filter and task drill-down | Persistent work schedules, per-person and per-day capacity, time off, individual allocations, day and month scales, multiple effort units, drag scheduling and a backlog |
| [Permissions](https://help.clickup.com/hc/en-us/articles/6309221065495-Permissions-in-detail) | Workspace owner, admin, member and read-only guest roles, invitations and scoped personal tokens | Private hierarchy locations, inheritance, item-level sharing, teams and role exceptions, public read-only task and view sharing |
| [Docs](https://help.clickup.com/hc/en-us/articles/6328174371351-Intro-to-Docs), [Chat](https://help.clickup.com/hc/en-us/articles/30090074843415-What-are-Channels) and [Whiteboards](https://help.clickup.com/hc/en-us/articles/14236535147159-Whiteboards-Hub) | Direct messages, threaded comments, mentions, reactions, attachments, notifications, simple shared Docs and linked-task goals | Group channels, assigned comments, granular notification preferences, rich collaborative Docs, nested pages, version history, Wikis and Whiteboards |
| Reporting and [time](https://help.clickup.com/hc/en-us/articles/21302696626967-Timesheets-Hub) | Dashboards with preset reports, timers, estimates, time entries and CSV reports | Custom dashboard cards, timesheet approval, billable reporting, richer goal types and portfolios |
| Templates and data exchange | Task and list templates, list CSV export and import, app REST API | Space, folder, view and public template libraries, ClickUp import and migration fidelity, external integrations and calendar sync |
| Client experience | Responsive browser UI, keyboard shortcuts and live updates on one server | Native mobile and desktop apps, offline behavior and production multi-instance presence |

Compare individual workflows against the guides before marking them complete. Implement private permissions centrally before exposing private locations through views, search, exports, notifications or the API.


## Acceptance checks for the next gaps

1. Private locations and item sharing. A member without access must be unable to discover the item through the sidebar, direct links, search, feeds, exports, notifications or personal tokens. Inheritance must apply consistently to descendants.
2. Hierarchy and views. Create subfolders and save views at workspace, space and folder levels. Verify filters, grouping, context menus and navigation with the same task in every applicable view.
3. Knowledge and collaboration. Verify concurrent editing and recovery in Docs, linked pages, channel membership and read state, and multi-user Whiteboard editing.
4. Planning and reporting. Verify milestones, sprint history, recurring schedules, time entries and approvals, date-specific capacity, dashboards, and exports using tasks that span multiple lists and weeks.
5. Exchange and integrations. Import representative ClickUp projects without dropping hierarchy, statuses, dates, comments or attachments. Verify integration permissions and support reconnects.
