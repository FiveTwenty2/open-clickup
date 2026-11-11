CREATE FUNCTION oc_carry_recurrence_access(source_id text, target_id text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  source_owner text;
  workspace text := current_setting('open_clickup.workspace_id', true);
BEGIN
  IF oc_acl('task', source_id) < 3 OR oc_acl('task', target_id) < 4 THEN
    RAISE EXCEPTION 'The next occurrence must preserve task access' USING ERRCODE = '42501';
  END IF;
  SELECT s."privacyOwnerId" INTO source_owner
  FROM public."Task" s JOIN public."Task" t ON t.id = target_id
  WHERE s.id = source_id AND s.id <> t.id AND s.private AND t.private
    AND s."listId" = t."listId" AND s."parentId" IS NOT DISTINCT FROM t."parentId"
    AND s.recurrence IS NOT NULL AND s.recurrence = t.recurrence AND s.name = t.name
    AND t."privacyOwnerId" = oc_actor() AND t."createdById" = oc_actor();
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid recurring task access transfer' USING ERRCODE = '42501'; END IF;

  INSERT INTO public."AccessGrant" (id, "workspaceId", "resourceType", "resourceId", "subjectType", "subjectId", permission)
    SELECT gen_random_uuid()::text, workspace, 'task', target_id, g."subjectType", g."subjectId", g.permission
    FROM public."AccessGrant" g
    WHERE g."workspaceId" = workspace AND g."resourceType" = 'task' AND g."resourceId" = source_id
    ON CONFLICT ("resourceType", "resourceId", "subjectType", "subjectId") DO NOTHING;

  IF source_owner IS NOT NULL AND source_owner <> oc_actor() THEN
    INSERT INTO public."AccessGrant" (id, "workspaceId", "resourceType", "resourceId", "subjectType", "subjectId", permission)
      VALUES (gen_random_uuid()::text, workspace, 'task', target_id, 'person', source_owner, 4)
      ON CONFLICT ("resourceType", "resourceId", "subjectType", "subjectId") DO UPDATE SET permission = 4;
  END IF;
END $$;
