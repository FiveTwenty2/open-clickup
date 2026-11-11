
SELECT oc_install_child_policy('TaskListMembership',
  'oc_can(''task'', "taskId", 1) AND oc_can(''list'', "listId", 1)',
  'oc_can(''task'', "taskId", 3) AND oc_can(''list'', "listId", 3)');
SELECT oc_install_child_policy('AttachmentBlob',
  'EXISTS (SELECT 1 FROM public."Attachment" a WHERE a.id = "attachmentId" AND oc_can(''task'', a."taskId", 1))',
  'EXISTS (SELECT 1 FROM public."Attachment" a WHERE a.id = "attachmentId" AND oc_can(''task'', a."taskId", 3))');

CREATE FUNCTION oc_scoped_view_access(view_id text, minimum integer) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ScopedView" v WHERE v.id = view_id AND (
      (oc_workspace_role(v."workspaceId") IS NOT NULL
        AND (v."spaceId" IS NULL OR oc_can('space', v."spaceId", minimum))
        AND (v."folderId" IS NULL OR oc_can('folder', v."folderId", minimum))
        AND (minimum = 1 OR oc_workspace_role(v."workspaceId") <> 'GUEST')
      ) OR (
        oc_actor() IS NULL AND minimum = 1 AND v."privateOwnerId" IS NULL
        AND EXISTS (SELECT 1 FROM public."ScopedViewPublicLink" l WHERE l."viewId" = v.id AND l.key = current_setting('open_clickup.public_key', true))
        AND (v."spaceId" IS NULL OR oc_is_public('space', v."spaceId"))
        AND (v."folderId" IS NULL OR oc_is_public('folder', v."folderId"))
      )
    )
  )
$$;

ALTER TABLE "ScopedView" ENABLE ROW LEVEL SECURITY;
CREATE POLICY oc_select ON "ScopedView" FOR SELECT TO open_clickup_request USING (oc_scoped_view_access(id, 1));
CREATE POLICY oc_insert ON "ScopedView" FOR INSERT TO open_clickup_request WITH CHECK (
  oc_workspace_role("workspaceId") IN ('OWNER', 'ADMIN', 'MEMBER')
  AND ("spaceId" IS NULL OR oc_can('space', "spaceId", 3))
  AND ("folderId" IS NULL OR oc_can('folder', "folderId", 3)));
CREATE POLICY oc_update ON "ScopedView" FOR UPDATE TO open_clickup_request USING (oc_scoped_view_access(id, 3))
  WITH CHECK (oc_workspace_role("workspaceId") IN ('OWNER', 'ADMIN', 'MEMBER')
    AND ("spaceId" IS NULL OR oc_can('space', "spaceId", 3))
    AND ("folderId" IS NULL OR oc_can('folder', "folderId", 3)));
CREATE POLICY oc_delete ON "ScopedView" FOR DELETE TO open_clickup_request USING (oc_scoped_view_access(id, 3));

SELECT oc_install_child_policy('ScopedViewReader', 'oc_scoped_view_access("viewId", 1)', 'oc_scoped_view_access("viewId", 3)');
SELECT oc_install_child_policy('ScopedViewPublicLink',
  'oc_scoped_view_access("viewId", 3) OR (key = current_setting(''open_clickup.public_key'', true) AND oc_scoped_view_access("viewId", 1))',
  'oc_scoped_view_access("viewId", 3)');
