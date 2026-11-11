# 0008. Enforce hierarchy access in PostgreSQL

- **Status:** Accepted

## Context

Search, audit history, notifications, linked tasks and public views all query the same hierarchy. A task can appear in more than one list while retaining its home list and status.

## Decision

HTTP routes attach an authenticated actor and workspace, or a public-link capability, to the request context. The Prisma adapter sets those values and switches to a restricted PostgreSQL role inside a transaction. Row-level policies apply the same access rules to direct reads and records reached through joins. Request context and role settings expire at the end of the transaction.

The hierarchy policy checks the home path from space to task. Access can be granted to a person or team at each location. A secondary placement also requires access to the destination list. Public links can show content only while the link and the applicable hierarchy remain public.

New task attachments store their bytes in a separate database record. The download route checks access to the task before reading the file. Legacy uploads use an authenticated route that resolves the original file against its attachment record.

## Consequences

- Database migrations provision a restricted PostgreSQL role and install the policies. Deployments using separate migration and runtime logins need to grant the role to both.
- API handlers with a Prisma call must establish request context before querying protected data. Seeds and database maintenance run with the database login's own privileges.
- Realtime list events check current permissions before delivering a list identifier. Hierarchy permission changes invalidate cached client data so open views reflect revocation.
