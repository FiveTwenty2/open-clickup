-- Evaluate a row using its actual parent and privacy fields. INSERT RETURNING
-- and UPDATE RETURNING run their visibility check before another scan sees it.
CREATE FUNCTION oc_row_acl(kind text, target text, parent_kind text, parent_id text, workspace text, is_private boolean, owner_id text)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor text := oc_actor();
  role_name text;
  parent_level integer;
  granted integer;
BEGIN
  IF actor IS NULL THEN RETURN 0; END IF;
  workspace := coalesce(workspace, current_setting('open_clickup.workspace_id', true));
  role_name := oc_workspace_role(workspace);
  IF role_name IS NULL THEN RETURN 0; END IF;
  IF kind = 'space' THEN
    parent_level := CASE WHEN role_name IN ('OWNER', 'ADMIN', 'MEMBER') THEN 4 ELSE 1 END;
  ELSE
    parent_level := oc_acl(parent_kind, parent_id);
  END IF;
  IF parent_level = 0 THEN RETURN 0; END IF;
  IF role_name IN ('OWNER', 'ADMIN') OR owner_id = actor THEN RETURN 4; END IF;
  SELECT max(g.permission) INTO granted
    FROM public."AccessGrant" g
    WHERE g."workspaceId" = workspace AND g."resourceType" = kind AND g."resourceId" = target
      AND ((g."subjectType" = 'person' AND g."subjectId" = actor) OR
        (g."subjectType" = 'team' AND EXISTS (
          SELECT 1 FROM public."AccessTeamMember" m JOIN public."AccessTeam" t ON t.id = m."teamId"
          WHERE t.id = g."subjectId" AND t."workspaceId" = workspace AND m."userId" = actor
        )));
  RETURN coalesce(granted, CASE WHEN is_private THEN 0 ELSE parent_level END);
END $$;

ALTER POLICY oc_select ON "Space" USING (
  oc_row_acl('space', id, NULL, NULL, "workspaceId", private, "privacyOwnerId") >= 1
  OR (oc_actor() IS NULL AND oc_public_scope('space', id, 1)));
ALTER POLICY oc_select ON "Folder" USING (
  oc_row_acl('folder', id, CASE WHEN "parentId" IS NULL THEN 'space' ELSE 'folder' END,
    coalesce("parentId", "spaceId"), NULL, private, "privacyOwnerId") >= 1
  OR (oc_actor() IS NULL AND oc_public_scope('folder', id, 1)));
ALTER POLICY oc_select ON "List" USING (
  oc_row_acl('list', id, CASE WHEN "folderId" IS NULL THEN 'space' ELSE 'folder' END,
    coalesce("folderId", "spaceId"), NULL, private, "privacyOwnerId") >= 1
  OR (oc_actor() IS NULL AND oc_public_scope('list', id, 1)));
ALTER POLICY oc_select ON "Task" USING (
  oc_row_acl('task', id, CASE WHEN "parentId" IS NULL THEN 'list' ELSE 'task' END,
    coalesce("parentId", "listId"), NULL, private, "privacyOwnerId") >= 1
  OR (oc_actor() IS NULL AND oc_public_scope('task', id, 1))
  OR (oc_form_list("listId") AND "createdById" IS NULL AND "parentId" IS NULL AND NOT private));

ALTER POLICY oc_select ON "ScopedView" USING (
  (oc_workspace_role("workspaceId") IS NOT NULL
    AND ("spaceId" IS NULL OR oc_can('space', "spaceId", 1))
    AND ("folderId" IS NULL OR oc_can('folder', "folderId", 1)))
  OR (oc_actor() IS NULL AND oc_scoped_view_access(id, 1)));
