-- Private access must be granted even for workspace admins and owners.
UPDATE public."Space" s
SET "privacyOwnerId" = m."userId"
FROM public."WorkspaceMember" m
WHERE s.private AND s."privacyOwnerId" IS NULL AND m."workspaceId" = s."workspaceId" AND m.role = 'OWNER';

CREATE FUNCTION oc_grant_level(workspace text, kind text, target text, actor text) RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    max(g.permission) FILTER (WHERE g."subjectType" = 'person' AND g."subjectId" = actor),
    max(g.permission) FILTER (WHERE g."subjectType" = 'team' AND EXISTS (
      SELECT 1 FROM public."AccessTeamMember" m JOIN public."AccessTeam" t ON t.id = m."teamId"
      WHERE t.id = g."subjectId" AND t."workspaceId" = workspace AND m."userId" = actor
    ))
  )
  FROM public."AccessGrant" g
  WHERE g."workspaceId" = workspace AND g."resourceType" = kind AND g."resourceId" = target
$$;
REVOKE ALL ON FUNCTION oc_grant_level(text, text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION oc_acl(kind text, target text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor text := oc_actor();
  role_name text;
  effective integer := 0;
  granted integer;
  workspace text := current_setting('open_clickup.workspace_id', true);
  node record;
BEGIN
  IF actor IS NULL THEN RETURN 0; END IF;
  FOR node IN SELECT * FROM oc_path(kind, target) ORDER BY depth DESC LOOP
    IF node.resource_kind = 'space' THEN
      role_name := oc_workspace_role(node.workspace_id);
      IF role_name IS NULL THEN RETURN 0; END IF;
      effective := CASE WHEN role_name = 'GUEST' THEN 1 ELSE 4 END;
    ELSIF effective = 0 THEN RETURN 0;
    END IF;
    granted := oc_grant_level(workspace, node.resource_kind, node.resource_id, actor);
    IF node.owner_id = actor THEN effective := 4;
    ELSIF granted IS NOT NULL THEN effective := granted;
    ELSIF node.is_private THEN RETURN 0;
    END IF;
  END LOOP;
  RETURN effective;
END $$;

CREATE OR REPLACE FUNCTION oc_row_acl(kind text, target text, parent_kind text, parent_id text, workspace text, is_private boolean, owner_id text)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor text := oc_actor();
  role_name text;
  parent_level integer;
BEGIN
  IF actor IS NULL THEN RETURN 0; END IF;
  workspace := coalesce(workspace, current_setting('open_clickup.workspace_id', true));
  IF kind = 'space' THEN
    role_name := oc_workspace_role(workspace);
    IF role_name IS NULL THEN RETURN 0; END IF;
    parent_level := CASE WHEN role_name = 'GUEST' THEN 1 ELSE 4 END;
  ELSE
    parent_level := oc_acl(parent_kind, parent_id);
  END IF;
  IF parent_level = 0 THEN RETURN 0; END IF;
  IF owner_id = actor THEN RETURN 4; END IF;
  RETURN coalesce(oc_grant_level(workspace, kind, target, actor), CASE WHEN is_private THEN 0 ELSE parent_level END);
END $$;

-- Replace all grants atomically, including edits that remove the caller's own
-- direct or team grant. Membership and target checks precede any write.
CREATE FUNCTION oc_replace_grants(kind text, target text, grants jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  workspace text := current_setting('open_clickup.workspace_id', true);
BEGIN
  IF oc_acl(kind, target) < 4 THEN RAISE EXCEPTION 'Full access is required' USING ERRCODE = '42501'; END IF;
  IF jsonb_array_length(grants) > 500 OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(grants) g("subjectType" text, "subjectId" text, permission integer)
    WHERE g.permission IS NULL OR g.permission NOT BETWEEN 1 AND 4 OR NOT (
      (g."subjectType" = 'person' AND EXISTS (
        SELECT 1 FROM public."WorkspaceMember" m WHERE m."workspaceId" = workspace AND m."userId" = g."subjectId"
      )) OR (g."subjectType" = 'team' AND EXISTS (
        SELECT 1 FROM public."AccessTeam" t WHERE t."workspaceId" = workspace AND t.id = g."subjectId"
      ))
    )
  ) THEN RAISE EXCEPTION 'Invalid access grants' USING ERRCODE = '22023'; END IF;

  DELETE FROM public."AccessGrant" g
  WHERE g."workspaceId" = workspace AND g."resourceType" = kind AND g."resourceId" = target;
  INSERT INTO public."AccessGrant" (id, "workspaceId", "resourceType", "resourceId", "subjectType", "subjectId", permission)
  SELECT gen_random_uuid()::text, workspace, kind, target, g."subjectType", g."subjectId", g.permission
  FROM jsonb_to_recordset(grants) g("subjectType" text, "subjectId" text, permission integer);
END $$;

CREATE FUNCTION oc_drop_member_grants() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public."AccessGrant" g
  WHERE g."workspaceId" = OLD."workspaceId" AND g."subjectType" = 'person' AND g."subjectId" = OLD."userId";
  RETURN OLD;
END $$;
CREATE TRIGGER oc_drop_member_grants AFTER DELETE ON "WorkspaceMember" FOR EACH ROW EXECUTE FUNCTION oc_drop_member_grants();

CREATE FUNCTION oc_drop_team_grants() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public."AccessGrant" g
  WHERE g."workspaceId" = OLD."workspaceId" AND g."subjectType" = 'team' AND g."subjectId" = OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER oc_drop_team_grants AFTER DELETE ON "AccessTeam" FOR EACH ROW EXECUTE FUNCTION oc_drop_team_grants();
CREATE OR REPLACE FUNCTION oc_guard_delete() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  resource_kind text := lower(TG_TABLE_NAME);
  source_id text := OLD.id;
  workspace_id text;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'open_clickup_request' THEN RETURN OLD; END IF;
  SELECT p.workspace_id INTO workspace_id FROM oc_path(resource_kind, source_id) p WHERE p.resource_kind = 'space';
  IF workspace_id IS NULL THEN RETURN OLD; END IF;
  IF EXISTS (
    WITH RECURSIVE branch(kind, id) AS (
      SELECT resource_kind, source_id
      UNION
      SELECT child.kind, child.id FROM branch parent
      CROSS JOIN LATERAL (
        SELECT 'folder'::text AS kind, f.id FROM public."Folder" f
          WHERE (parent.kind = 'space' AND f."spaceId" = parent.id AND f."parentId" IS NULL)
             OR (parent.kind = 'folder' AND f."parentId" = parent.id)
        UNION ALL
        SELECT 'list', l.id FROM public."List" l
          WHERE (parent.kind = 'space' AND l."spaceId" = parent.id AND l."folderId" IS NULL)
             OR (parent.kind = 'folder' AND l."folderId" = parent.id)
        UNION ALL
        SELECT 'task', t.id FROM public."Task" t
          WHERE (parent.kind = 'list' AND t."listId" = parent.id AND t."parentId" IS NULL)
             OR (parent.kind = 'task' AND t."parentId" = parent.id)
      ) child
    ) SELECT 1 FROM branch WHERE oc_acl(kind, id) < 4
  ) THEN RAISE EXCEPTION 'Full access is required for every item in this location' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

CREATE FUNCTION oc_drop_item_grants() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public."AccessGrant" g
  WHERE g."resourceType" = lower(TG_TABLE_NAME) AND g."resourceId" = OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER oc_drop_item_grants AFTER DELETE ON "Space" FOR EACH ROW EXECUTE FUNCTION oc_drop_item_grants();
CREATE TRIGGER oc_drop_item_grants AFTER DELETE ON "Folder" FOR EACH ROW EXECUTE FUNCTION oc_drop_item_grants();
CREATE TRIGGER oc_drop_item_grants AFTER DELETE ON "List" FOR EACH ROW EXECUTE FUNCTION oc_drop_item_grants();
CREATE TRIGGER oc_drop_item_grants AFTER DELETE ON "Task" FOR EACH ROW EXECUTE FUNCTION oc_drop_item_grants();
