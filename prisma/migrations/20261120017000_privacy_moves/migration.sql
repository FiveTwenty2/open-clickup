CREATE FUNCTION oc_move_keeps_privacy(source_kind text, source_id text, destination_kind text, destination_id text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT oc_acl(source_kind, source_id) >= 3 AND oc_acl(destination_kind, destination_id) >= 3 AND NOT EXISTS (
    SELECT p.resource_kind, p.resource_id
    FROM oc_path(source_kind, source_id) p WHERE p.is_private AND p.depth > 0
    EXCEPT
    SELECT p.resource_kind, p.resource_id
    FROM oc_path(destination_kind, destination_id) p WHERE p.is_private
  )
$$;

CREATE OR REPLACE FUNCTION oc_guard_location() RETURNS trigger
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
    IF NOT oc_move_keeps_privacy(resource_kind, source_id, parent_kind, parent_id) THEN
      RAISE EXCEPTION 'Move this item within its private location' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
