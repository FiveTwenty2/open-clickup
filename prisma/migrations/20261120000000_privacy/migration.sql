DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'open_clickup_request') THEN
    CREATE ROLE open_clickup_request NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'open_clickup_request' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit)) THEN
    RAISE EXCEPTION 'The open_clickup_request role must be a restricted NOLOGIN role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid = m.member WHERE r.rolname = 'open_clickup_request') THEN
    RAISE EXCEPTION 'The open_clickup_request role must have no parent roles';
  END IF;
  IF NOT pg_has_role(current_user, 'open_clickup_request', 'MEMBER') THEN
    EXECUTE format('GRANT open_clickup_request TO %I', current_user);
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO open_clickup_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO open_clickup_request;
REVOKE ALL ON TABLE "_prisma_migrations" FROM open_clickup_request;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO open_clickup_request;

ALTER TABLE "Space" ADD COLUMN "privacyOwnerId" TEXT;
ALTER TABLE "Folder" ADD COLUMN "privacyOwnerId" TEXT, ADD COLUMN "private" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "List" ADD COLUMN "privacyOwnerId" TEXT, ADD COLUMN "private" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "privacyOwnerId" TEXT, ADD COLUMN "private" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AccessGrant" (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL CHECK ("resourceType" IN ('space', 'folder', 'list', 'task')),
  "resourceId" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL CHECK ("subjectType" IN ('person', 'team')),
  "subjectId" TEXT NOT NULL,
  permission INTEGER NOT NULL CHECK (permission BETWEEN 1 AND 4)
);
CREATE UNIQUE INDEX "AccessGrant_resourceType_resourceId_subjectType_subjectId_key" ON "AccessGrant" ("resourceType", "resourceId", "subjectType", "subjectId");
CREATE INDEX "AccessGrant_workspaceId_subjectType_subjectId_idx" ON "AccessGrant" ("workspaceId", "subjectType", "subjectId");

CREATE TABLE "AccessTeam" (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX "AccessTeam_workspaceId_name_key" ON "AccessTeam" ("workspaceId", name);
CREATE TABLE "AccessTeamMember" (
  "teamId" TEXT NOT NULL REFERENCES "AccessTeam"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  PRIMARY KEY ("teamId", "userId")
);
CREATE INDEX "AccessTeamMember_userId_idx" ON "AccessTeamMember" ("userId");

CREATE FUNCTION oc_actor() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog
AS $$ SELECT NULLIF(current_setting('open_clickup.user_id', true), '') $$;

CREATE FUNCTION oc_workspace_role(workspace text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT m.role::text FROM public."WorkspaceMember" m
  WHERE m."workspaceId" = workspace AND m."userId" = oc_actor()
    AND workspace = current_setting('open_clickup.workspace_id', true)
$$;

-- Each row is a location on the requested item's home path, including itself.
CREATE FUNCTION oc_path(kind text, target text)
RETURNS TABLE (resource_kind text, resource_id text, workspace_id text, is_private boolean, owner_id text, depth integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  next_kind text := kind;
  next_id text := target;
  parent_id text;
  home_id text;
  hop integer := 0;
BEGIN
  WHILE next_id IS NOT NULL AND hop < 128 LOOP
    resource_kind := next_kind;
    resource_id := next_id;
    workspace_id := NULL;
    depth := hop;
    CASE next_kind
      WHEN 'task' THEN
        SELECT t."parentId", t."listId", t.private, t."privacyOwnerId"
          INTO parent_id, home_id, is_private, owner_id FROM public."Task" t WHERE t.id = next_id;
        next_kind := CASE WHEN parent_id IS NULL THEN 'list' ELSE 'task' END;
      WHEN 'list' THEN
        SELECT l."folderId", l."spaceId", l.private, l."privacyOwnerId"
          INTO parent_id, home_id, is_private, owner_id FROM public."List" l WHERE l.id = next_id;
        next_kind := CASE WHEN parent_id IS NULL THEN 'space' ELSE 'folder' END;
      WHEN 'folder' THEN
        SELECT f."parentId", f."spaceId", f.private, f."privacyOwnerId"
          INTO parent_id, home_id, is_private, owner_id FROM public."Folder" f WHERE f.id = next_id;
        next_kind := CASE WHEN parent_id IS NULL THEN 'space' ELSE 'folder' END;
      WHEN 'space' THEN
        SELECT s."workspaceId", s.private, s."privacyOwnerId"
          INTO workspace_id, is_private, owner_id FROM public."Space" s WHERE s.id = next_id;
        parent_id := NULL;
        home_id := NULL;
      ELSE
        RETURN;
    END CASE;
    IF NOT FOUND THEN RETURN; END IF;
    RETURN NEXT;
    next_id := coalesce(parent_id, home_id);
    hop := hop + 1;
  END LOOP;
END $$;

CREATE FUNCTION oc_acl(kind text, target text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  role_name text;
  member_id text := oc_actor();
  effective integer := 0;
  granted integer;
  current_workspace text := current_setting('open_clickup.workspace_id', true);
  node record;
BEGIN
  IF member_id IS NULL THEN RETURN 0; END IF;
  FOR node IN SELECT * FROM oc_path(kind, target) ORDER BY depth DESC LOOP
    IF node.resource_kind = 'space' THEN
      role_name := oc_workspace_role(node.workspace_id);
      IF role_name IS NULL THEN RETURN 0; END IF;
      IF role_name IN ('OWNER', 'ADMIN') THEN RETURN 4; END IF;
      effective := CASE WHEN role_name = 'MEMBER' THEN 4 ELSE 1 END;
    ELSIF effective = 0 THEN RETURN 0;
    END IF;
    SELECT max(g.permission) INTO granted FROM public."AccessGrant" g
      WHERE g."workspaceId" = current_workspace AND g."resourceType" = node.resource_kind AND g."resourceId" = node.resource_id
        AND ((g."subjectType" = 'person' AND g."subjectId" = member_id) OR
          (g."subjectType" = 'team' AND EXISTS (
            SELECT 1 FROM public."AccessTeamMember" m JOIN public."AccessTeam" t ON t.id = m."teamId"
            WHERE t.id = g."subjectId" AND t."workspaceId" = current_workspace AND m."userId" = member_id
          )));
    IF node.owner_id = member_id THEN effective := 4;
    ELSIF granted IS NOT NULL THEN effective := granted;
    ELSIF node.is_private THEN RETURN 0;
    END IF;
  END LOOP;
  RETURN effective;
END $$;

CREATE FUNCTION oc_is_public(kind text, target text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(bool_or(resource_kind = 'space'), false) AND NOT COALESCE(bool_or(is_private), true)
  FROM oc_path(kind, target)
$$;

-- Anonymous access is limited to the exact published key. A workspace actor cannot
-- opt into this branch. Public responses are further projected by their API handlers.
CREATE FUNCTION oc_public_scope(kind text, target text, minimum integer) RETURNS boolean
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
        RETURN oc_is_public(kind, target) AND EXISTS (SELECT 1 FROM public."Task" t WHERE t.id = target AND t."listId" = list_id);
      END IF;
      RETURN false;
    END IF;
    SELECT v."workspaceId", v."spaceId", v."folderId" INTO workspace_id, space_id, folder_id
      FROM public."ScopedViewPublicLink" p JOIN public."ScopedView" v ON v.id = p."viewId"
      WHERE p.key = key_value AND v."privateOwnerId" IS NULL;
    IF workspace_id IS NULL OR NOT oc_is_public(kind, target) THEN RETURN false; END IF;
    RETURN EXISTS (SELECT 1 FROM oc_path(kind, target) n WHERE n.workspace_id = workspace_id)
      AND (space_id IS NULL OR EXISTS (SELECT 1 FROM oc_path(kind, target) n WHERE n.resource_kind = 'space' AND n.resource_id = space_id))
      AND (folder_id IS NULL OR EXISTS (SELECT 1 FROM oc_path(kind, target) n WHERE n.resource_kind = 'folder' AND n.resource_id = folder_id));
  END IF;
  RETURN false;
END $$;

CREATE FUNCTION oc_can(kind text, target text, minimum integer) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path = pg_catalog, public
AS $$ SELECT CASE WHEN oc_actor() IS NULL THEN oc_public_scope(kind, target, minimum) ELSE oc_acl(kind, target) >= minimum END $$;

CREATE FUNCTION oc_form_list(list_id text) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path = pg_catalog, public
AS $$
  SELECT oc_actor() IS NULL AND current_setting('open_clickup.public_kind', true) = 'form'
    AND oc_public_scope('list', list_id, 1)
$$;

ALTER TABLE "Space" ENABLE ROW LEVEL SECURITY;
CREATE POLICY oc_select ON "Space" FOR SELECT TO open_clickup_request USING (oc_can('space', id, 1));
CREATE POLICY oc_insert ON "Space" FOR INSERT TO open_clickup_request WITH CHECK (oc_workspace_role("workspaceId") IN ('ADMIN', 'OWNER'));
CREATE POLICY oc_update ON "Space" FOR UPDATE TO open_clickup_request USING (oc_can('space', id, 3))
  WITH CHECK (oc_workspace_role("workspaceId") IS NOT NULL);
CREATE POLICY oc_delete ON "Space" FOR DELETE TO open_clickup_request USING (oc_can('space', id, 4));

ALTER TABLE "Folder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY oc_select ON "Folder" FOR SELECT TO open_clickup_request USING (oc_can('folder', id, 1));
CREATE POLICY oc_insert ON "Folder" FOR INSERT TO open_clickup_request WITH CHECK (
  oc_can('space', "spaceId", 1) AND (("parentId" IS NULL AND oc_can('space', "spaceId", 3)) OR oc_can('folder', "parentId", 3)));
CREATE POLICY oc_update ON "Folder" FOR UPDATE TO open_clickup_request USING (oc_can('folder', id, 3))
  WITH CHECK (oc_can('space', "spaceId", 1) AND ("parentId" IS NULL OR oc_can('folder', "parentId", 1)));
CREATE POLICY oc_delete ON "Folder" FOR DELETE TO open_clickup_request USING (oc_can('folder', id, 4));

ALTER TABLE "List" ENABLE ROW LEVEL SECURITY;
CREATE POLICY oc_select ON "List" FOR SELECT TO open_clickup_request USING (oc_can('list', id, 1));
CREATE POLICY oc_insert ON "List" FOR INSERT TO open_clickup_request WITH CHECK (
  oc_can('space', "spaceId", 1) AND (("folderId" IS NULL AND oc_can('space', "spaceId", 3)) OR oc_can('folder', "folderId", 3)));
CREATE POLICY oc_update ON "List" FOR UPDATE TO open_clickup_request USING (oc_can('list', id, 3))
  WITH CHECK (oc_can('space', "spaceId", 1) AND ("folderId" IS NULL OR oc_can('folder', "folderId", 1)));
CREATE POLICY oc_delete ON "List" FOR DELETE TO open_clickup_request USING (oc_can('list', id, 4));

ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY oc_select ON "Task" FOR SELECT TO open_clickup_request USING (
  oc_can('task', id, 1) OR (oc_form_list("listId") AND "createdById" IS NULL AND "parentId" IS NULL AND NOT private AND EXISTS (
    SELECT 1 FROM "IntakeForm" f WHERE f."listId" = "Task"."listId" AND f."shareKey" = current_setting('open_clickup.public_key', true)
  )));
CREATE POLICY oc_insert ON "Task" FOR INSERT TO open_clickup_request WITH CHECK (
  (oc_can('list', "listId", 1) AND (("parentId" IS NULL AND oc_can('list', "listId", 3)) OR oc_can('task', "parentId", 3))) OR
  (oc_form_list("listId") AND "parentId" IS NULL AND "createdById" IS NULL AND NOT private));
CREATE POLICY oc_update ON "Task" FOR UPDATE TO open_clickup_request USING (oc_can('task', id, 3))
  WITH CHECK (oc_can('list', "listId", 1) AND ("parentId" IS NULL OR oc_can('task', "parentId", 1)));
CREATE POLICY oc_delete ON "Task" FOR DELETE TO open_clickup_request USING (oc_can('task', id, 4));

CREATE FUNCTION oc_form_task(task_id text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT EXISTS (SELECT 1 FROM public."Task" t WHERE t.id = task_id AND t."parentId" IS NULL AND NOT t.private AND t."createdById" IS NULL AND oc_form_list(t."listId")) $$;

-- A private ancestor is the boundary for its descendants. Prevent structural
-- updates from escaping it, and reject edits that would bypass a destination ACL.
CREATE FUNCTION oc_guard_location() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  resource_kind text := lower(TG_TABLE_NAME);
  parent_kind text;
  parent_id text;
  previous_parent_id text;
  previous_parent_kind text;
  source_id text := OLD.id;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'open_clickup_request' THEN RETURN NEW; END IF;
  IF (OLD.private, OLD."privacyOwnerId") IS DISTINCT FROM (NEW.private, NEW."privacyOwnerId")
     AND oc_acl(resource_kind, source_id) < 4 THEN
    RAISE EXCEPTION 'Full access is required to change privacy' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'Space' THEN
    IF OLD."workspaceId" IS DISTINCT FROM NEW."workspaceId" THEN
      RAISE EXCEPTION 'Spaces cannot be transferred between workspaces' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'Folder' THEN
    parent_id := coalesce(NEW."parentId", NEW."spaceId");
    previous_parent_id := coalesce(OLD."parentId", OLD."spaceId");
    parent_kind := CASE WHEN NEW."parentId" IS NULL THEN 'space' ELSE 'folder' END;
    previous_parent_kind := CASE WHEN OLD."parentId" IS NULL THEN 'space' ELSE 'folder' END;
  ELSIF TG_TABLE_NAME = 'List' THEN
    parent_id := coalesce(NEW."folderId", NEW."spaceId");
    previous_parent_id := coalesce(OLD."folderId", OLD."spaceId");
    parent_kind := CASE WHEN NEW."folderId" IS NULL THEN 'space' ELSE 'folder' END;
    previous_parent_kind := CASE WHEN OLD."folderId" IS NULL THEN 'space' ELSE 'folder' END;
  ELSE
    parent_id := coalesce(NEW."parentId", NEW."listId");
    previous_parent_id := coalesce(OLD."parentId", OLD."listId");
    parent_kind := CASE WHEN NEW."parentId" IS NULL THEN 'list' ELSE 'task' END;
    previous_parent_kind := CASE WHEN OLD."parentId" IS NULL THEN 'list' ELSE 'task' END;
  END IF;
  IF (previous_parent_kind, previous_parent_id) IS DISTINCT FROM (parent_kind, parent_id) THEN
    IF oc_acl(parent_kind, parent_id) < 3 THEN
      RAISE EXCEPTION 'Edit access is required at the destination' USING ERRCODE = '42501';
    END IF;
    IF NOT oc_is_public(previous_parent_kind, previous_parent_id) THEN
      RAISE EXCEPTION 'Unshare this location from its private parent before moving it' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oc_guard_location BEFORE UPDATE ON "Space" FOR EACH ROW EXECUTE FUNCTION oc_guard_location();
CREATE TRIGGER oc_guard_location BEFORE UPDATE ON "Folder" FOR EACH ROW EXECUTE FUNCTION oc_guard_location();
CREATE TRIGGER oc_guard_location BEFORE UPDATE ON "List" FOR EACH ROW EXECUTE FUNCTION oc_guard_location();
CREATE TRIGGER oc_guard_location BEFORE UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION oc_guard_location();

-- PostgreSQL foreign-key cascades may bypass RLS. Guard each delete before
-- the cascading row is removed, looking up all descendants with owner visibility.
CREATE FUNCTION oc_guard_delete() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  resource_kind text := lower(TG_TABLE_NAME);
  source_id text := OLD.id;
  workspace_id text;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'open_clickup_request' THEN RETURN OLD; END IF;
  SELECT p.workspace_id INTO workspace_id FROM oc_path(resource_kind, source_id) p WHERE p.resource_kind = 'space';
  IF workspace_id IS NULL OR oc_workspace_role(workspace_id) IN ('OWNER', 'ADMIN') THEN RETURN OLD; END IF;
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
CREATE TRIGGER oc_guard_delete BEFORE DELETE ON "Space" FOR EACH ROW EXECUTE FUNCTION oc_guard_delete();
CREATE TRIGGER oc_guard_delete BEFORE DELETE ON "Folder" FOR EACH ROW EXECUTE FUNCTION oc_guard_delete();
CREATE TRIGGER oc_guard_delete BEFORE DELETE ON "List" FOR EACH ROW EXECUTE FUNCTION oc_guard_delete();
CREATE TRIGGER oc_guard_delete BEFORE DELETE ON "Task" FOR EACH ROW EXECUTE FUNCTION oc_guard_delete();

-- Generic policy installation keeps related tables behind their parent ACL.
CREATE FUNCTION oc_install_child_policy(table_name text, can_read text, can_write text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('CREATE POLICY oc_select ON public.%I FOR SELECT TO open_clickup_request USING (%s)', table_name, can_read);
  EXECUTE format('CREATE POLICY oc_insert ON public.%I FOR INSERT TO open_clickup_request WITH CHECK (%s)', table_name, can_write);
  EXECUTE format('CREATE POLICY oc_update ON public.%I FOR UPDATE TO open_clickup_request USING (%s) WITH CHECK (%s)', table_name, can_write, can_write);
  EXECUTE format('CREATE POLICY oc_delete ON public.%I FOR DELETE TO open_clickup_request USING (%s)', table_name, can_write);
END $$;
REVOKE ALL ON FUNCTION oc_install_child_policy(text, text, text) FROM PUBLIC;

DO $policies$
DECLARE
  item text;
BEGIN
  FOREACH item IN ARRAY ARRAY['Status', 'CustomField', 'TaskAutomation', 'View'] LOOP
    PERFORM oc_install_child_policy(item, 'oc_can(''list'', "listId", 1)', 'oc_can(''list'', "listId", 3)');
  END LOOP;
  FOREACH item IN ARRAY ARRAY['TaskAssignee', 'TaskWatcher', 'TaskTag', 'CustomFieldValue', 'Checklist', 'Attachment', 'TaskResourceLink', 'TimeEntry'] LOOP
    PERFORM oc_install_child_policy(item, 'oc_can(''task'', "taskId", 1)', 'oc_can(''task'', "taskId", 3)');
  END LOOP;
  PERFORM oc_install_child_policy('Activity', 'oc_can(''task'', "taskId", 1) OR oc_form_task("taskId")', 'oc_can(''task'', "taskId", 2) OR oc_form_task("taskId")');
  PERFORM oc_install_child_policy('Comment', 'oc_can(''task'', "taskId", 1)', 'oc_can(''task'', "taskId", 2)');
  PERFORM oc_install_child_policy('ChecklistItem',
    'EXISTS (SELECT 1 FROM public."Checklist" c WHERE c.id = "checklistId" AND oc_can(''task'', c."taskId", 1))',
    'EXISTS (SELECT 1 FROM public."Checklist" c WHERE c.id = "checklistId" AND oc_can(''task'', c."taskId", 3))');
  FOREACH item IN ARRAY ARRAY['CommentFile','CommentReaction'] LOOP
    PERFORM oc_install_child_policy(item,
      'EXISTS (SELECT 1 FROM public."Comment" c WHERE c.id = "commentId" AND oc_can(''task'', c."taskId", 1))',
      'EXISTS (SELECT 1 FROM public."Comment" c WHERE c.id = "commentId" AND oc_can(''task'', c."taskId", 2))');
  END LOOP;
  PERFORM oc_install_child_policy('CustomFieldOption',
    'EXISTS (SELECT 1 FROM public."CustomField" c WHERE c.id = "customFieldId" AND oc_can(''list'', c."listId", 1))',
    'EXISTS (SELECT 1 FROM public."CustomField" c WHERE c.id = "customFieldId" AND oc_can(''list'', c."listId", 3))');
  PERFORM oc_install_child_policy('TaskDependency',
    'oc_can(''task'', "blockerId", 1) AND oc_can(''task'', "blockedId", 1)',
    'oc_can(''task'', "blockerId", 3) AND oc_can(''task'', "blockedId", 3)');
  PERFORM oc_install_child_policy('TaskRelationship',
    'oc_can(''task'', "leftId", 1) AND oc_can(''task'', "rightId", 1)',
    'oc_can(''task'', "leftId", 3) AND oc_can(''task'', "rightId", 3)');
  PERFORM oc_install_child_policy('Tag',
    'oc_can(''space'', "spaceId", 1) OR EXISTS (SELECT 1 FROM public."TaskTag" t WHERE t."tagId" = "Tag".id AND oc_can(''task'', t."taskId", 1))',
    'oc_can(''space'', "spaceId", 3)');
  PERFORM oc_install_child_policy('GoalTask', 'oc_can(''task'', "taskId", 1)', 'oc_can(''task'', "taskId", 3)');
  PERFORM oc_install_child_policy('Favorite',
    '"userId" = oc_actor() AND oc_can(''list'', "listId", 1)', '"userId" = oc_actor() AND oc_can(''list'', "listId", 1)');
  PERFORM oc_install_child_policy('IntakeForm',
    'oc_acl(''list'', "listId") >= 1 OR (published AND "shareKey" = current_setting(''open_clickup.public_key'', true) AND oc_form_list("listId"))',
    'oc_acl(''list'', "listId") >= 3');
  PERFORM oc_install_child_policy('TaskPublicShare',
    'oc_acl(''task'', "taskId") >= 3 OR (key = current_setting(''open_clickup.public_key'', true) AND oc_public_scope(''task'', "taskId", 1))',
    'oc_acl(''task'', "taskId") >= 3');
  PERFORM oc_install_child_policy('ViewPublicLink',
    'EXISTS (SELECT 1 FROM public."View" v WHERE v.id = "viewId" AND (oc_acl(''list'', v."listId") >= 3 OR (key = current_setting(''open_clickup.public_key'', true) AND oc_public_scope(''list'', v."listId", 1))))',
    'EXISTS (SELECT 1 FROM public."View" v WHERE v.id = "viewId" AND oc_acl(''list'', v."listId") >= 3)');
  PERFORM oc_install_child_policy('ViewReader',
    'EXISTS (SELECT 1 FROM public."View" v WHERE v.id = "viewId" AND oc_acl(''list'', v."listId") >= 1)',
    'EXISTS (SELECT 1 FROM public."View" v WHERE v.id = "viewId" AND oc_acl(''list'', v."listId") >= 3)');
END $policies$;

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY oc_notification_read ON "Notification" FOR SELECT TO open_clickup_request USING (
  ("userId" = oc_actor() OR "actorId" = oc_actor()) AND ("taskId" IS NULL OR oc_can('task', "taskId", 1)));
CREATE POLICY oc_notification_insert ON "Notification" FOR INSERT TO open_clickup_request WITH CHECK (
  "actorId" = oc_actor() AND ("taskId" IS NULL OR oc_can('task', "taskId", 2)));
CREATE POLICY oc_notification_update ON "Notification" FOR UPDATE TO open_clickup_request USING (
  "userId" = oc_actor() AND ("taskId" IS NULL OR oc_can('task', "taskId", 1)));

SELECT oc_install_child_policy('AccessGrant',
  'oc_acl("resourceType", "resourceId") >= 4',
  'oc_acl("resourceType", "resourceId") >= 4 AND oc_workspace_role("workspaceId") IS NOT NULL');
SELECT oc_install_child_policy('AccessTeam',
  'oc_workspace_role("workspaceId") IS NOT NULL',
  'oc_workspace_role("workspaceId") IN (''OWNER'', ''ADMIN'')');
SELECT oc_install_child_policy('AccessTeamMember',
  'EXISTS (SELECT 1 FROM public."AccessTeam" t WHERE t.id = "teamId" AND oc_workspace_role(t."workspaceId") IS NOT NULL)',
  'EXISTS (SELECT 1 FROM public."AccessTeam" t WHERE t.id = "teamId" AND oc_workspace_role(t."workspaceId") IN (''OWNER'', ''ADMIN''))');

-- Ancestor discovery returns internal private metadata. Only the owner of the
-- authorization functions may call it directly.
REVOKE ALL ON FUNCTION oc_path(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION oc_is_public(text, text) FROM PUBLIC;
