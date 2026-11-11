CREATE OR REPLACE FUNCTION oc_public_scope(kind text, target text, minimum integer) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  capability text := current_setting('open_clickup.public_kind', true);
  key_value text := NULLIF(current_setting('open_clickup.public_key', true), '');
  task_id text;
  list_id text;
  workspace_id text;
  space_id text;
  folder_id text;
BEGIN
  IF key_value IS NULL OR oc_actor() IS NOT NULL OR minimum > 1 THEN RETURN false; END IF;
  IF capability = 'task' THEN
    SELECT t.id, t."listId" INTO task_id, list_id FROM public."TaskPublicShare" p
      JOIN public."Task" t ON t.id = p."taskId" JOIN public."List" l ON l.id = t."listId"
      WHERE p.key = key_value AND t."deletedAt" IS NULL AND NOT t.archived AND l."archivedAt" IS NULL;
    IF NOT oc_is_public('task', task_id) THEN RETURN false; END IF;
    RETURN COALESCE((kind = 'task' AND task_id = target) OR (kind = 'list' AND list_id = target), false);
  ELSIF capability = 'form' THEN
    SELECT f."listId" INTO list_id FROM public."IntakeForm" f JOIN public."List" l ON l.id = f."listId"
      WHERE f."shareKey" = key_value AND f.published AND l."archivedAt" IS NULL;
    RETURN COALESCE(kind = 'list' AND list_id = target AND oc_is_public('list', list_id), false);
  ELSIF capability = 'view' THEN
    SELECT v."listId" INTO list_id FROM public."ViewPublicLink" p JOIN public."View" v ON v.id = p."viewId"
      JOIN public."List" l ON l.id = v."listId"
      WHERE p.key = key_value AND v."privateOwnerId" IS NULL AND l."archivedAt" IS NULL;
    IF list_id IS NOT NULL THEN
      IF kind = 'list' THEN RETURN target = list_id AND oc_is_public(kind, target); END IF;
      IF kind = 'task' THEN
        RETURN oc_is_public(kind, target) AND oc_is_public('list', list_id) AND EXISTS (
          SELECT 1 FROM public."Task" t JOIN public."List" home ON home.id = t."listId" WHERE t.id = target AND t."deletedAt" IS NULL AND NOT t.archived AND home."archivedAt" IS NULL
            AND EXISTS (SELECT 1 FROM oc_path('task', t.id) h JOIN oc_path('list', list_id) d ON d.workspace_id = h.workspace_id)
            AND (t."listId" = list_id OR EXISTS (
              SELECT 1 FROM public."TaskListMembership" m WHERE m."taskId" = t.id AND m."listId" = list_id
            )));
      END IF;
      RETURN false;
    END IF;
    SELECT v."workspaceId", v."spaceId", v."folderId" INTO workspace_id, space_id, folder_id
      FROM public."ScopedViewPublicLink" p JOIN public."ScopedView" v ON v.id = p."viewId"
      WHERE p.key = key_value AND v."privateOwnerId" IS NULL;
    IF workspace_id IS NULL OR NOT oc_is_public(kind, target) THEN RETURN false; END IF;
    IF kind = 'task' AND NOT EXISTS (
      SELECT 1 FROM public."Task" t JOIN public."List" home ON home.id = t."listId"
      WHERE t.id = target AND t."deletedAt" IS NULL AND NOT t.archived AND home."archivedAt" IS NULL
    ) THEN RETURN false; END IF;
    IF kind = 'task' AND EXISTS (
      SELECT 1 FROM public."Task" t JOIN public."TaskListMembership" m ON m."taskId" = t.id
        JOIN public."List" l ON l.id = m."listId"
      WHERE t.id = target AND t."deletedAt" IS NULL AND NOT t.archived AND l."archivedAt" IS NULL
        AND oc_is_public('list', l.id)
        AND EXISTS (SELECT 1 FROM oc_path('task', t.id) h WHERE h.workspace_id = workspace_id)
        AND EXISTS (SELECT 1 FROM oc_path('list', l.id) d WHERE d.workspace_id = workspace_id)
        AND (space_id IS NULL OR EXISTS (SELECT 1 FROM oc_path('list', l.id) d WHERE d.resource_kind = 'space' AND d.resource_id = space_id))
        AND (folder_id IS NULL OR EXISTS (SELECT 1 FROM oc_path('list', l.id) d WHERE d.resource_kind = 'folder' AND d.resource_id = folder_id))
    ) THEN RETURN true; END IF;
    RETURN EXISTS (SELECT 1 FROM oc_path(kind, target) n WHERE n.workspace_id = workspace_id)
      AND (space_id IS NULL OR EXISTS (SELECT 1 FROM oc_path(kind, target) n WHERE n.resource_kind = 'space' AND n.resource_id = space_id))
      AND (folder_id IS NULL OR EXISTS (SELECT 1 FROM oc_path(kind, target) n WHERE n.resource_kind = 'folder' AND n.resource_id = folder_id));
  END IF;
  RETURN false;
END $$;


CREATE FUNCTION oc_custom_value_access(task_id text, field_id text, minimum integer)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."Task" t JOIN public."CustomField" f ON f.id = field_id
    WHERE t.id = task_id AND oc_can('task', t.id, minimum)
      AND (oc_can('list', f."listId", minimum) OR (oc_actor() IS NULL AND t."listId" = f."listId" AND minimum = 1))
      AND (t."listId" = f."listId" OR EXISTS (
        SELECT 1 FROM public."TaskListMembership" m WHERE m."taskId" = t.id AND m."listId" = f."listId"
      ))
  )
$$;

ALTER POLICY oc_select ON "CustomFieldValue" USING (oc_custom_value_access("taskId", "customFieldId", 1));
ALTER POLICY oc_insert ON "CustomFieldValue" WITH CHECK (oc_custom_value_access("taskId", "customFieldId", 3));
ALTER POLICY oc_update ON "CustomFieldValue" USING (oc_custom_value_access("taskId", "customFieldId", 3))
  WITH CHECK (oc_custom_value_access("taskId", "customFieldId", 3));
ALTER POLICY oc_delete ON "CustomFieldValue" USING (oc_custom_value_access("taskId", "customFieldId", 3));
