-- A status belongs to a List workflow even when some tasks on that List are private.
-- Updating a workflow must migrate those tasks without exposing their contents to its editor.
CREATE FUNCTION oc_sync_list_statuses(list_id text, workflow jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  entry record;
  old_status public."Status"%ROWTYPE;
  target_status public."Status"%ROWTYPE;
  original_ids text[];
  kept_ids text[] := ARRAY[]::text[];
  next_id text;
  next_type public."StatusType";
  next_wip integer;
BEGIN
  SELECT COALESCE(array_agg(id), ARRAY[]::text[]) INTO original_ids
  FROM public."Status" WHERE "listId" = list_id;

  FOR entry IN SELECT value, ordinality FROM jsonb_array_elements(workflow) WITH ORDINALITY LOOP
    next_type := (entry.value ->> 'type')::public."StatusType";
    next_wip := (entry.value ->> 'wipLimit')::integer;
    SELECT * INTO old_status FROM public."Status" s
    WHERE s.id = ANY(original_ids) AND NOT (s.id = ANY(kept_ids))
      AND (s."inheritedKey" = entry.value ->> 'key' OR lower(s.name) = lower(entry.value ->> 'name'))
    ORDER BY (s."inheritedKey" = entry.value ->> 'key') DESC NULLS LAST, s.position, s.id
    LIMIT 1;

    IF FOUND THEN
      next_id := old_status.id;
      UPDATE public."Status" SET name = entry.value ->> 'name', color = entry.value ->> 'color',
        type = next_type, position = entry.ordinality - 1, "inheritedKey" = entry.value ->> 'key', "wipLimit" = next_wip
      WHERE id = next_id AND (name, color, type, position, "inheritedKey", "wipLimit") IS DISTINCT FROM
        (entry.value ->> 'name', entry.value ->> 'color', next_type, (entry.ordinality - 1)::double precision, entry.value ->> 'key', next_wip);

      IF (old_status.type IN ('DONE', 'CLOSED')) <> (next_type IN ('DONE', 'CLOSED')) THEN
        UPDATE public."Task" SET "completedAt" = CASE WHEN next_type IN ('DONE', 'CLOSED') THEN CURRENT_TIMESTAMP ELSE NULL END,
          "updatedAt" = CURRENT_TIMESTAMP WHERE "statusId" = next_id;
      END IF;
    ELSE
      next_id := gen_random_uuid()::text;
      INSERT INTO public."Status" (id, "listId", name, color, type, position, "inheritedKey", "wipLimit")
      VALUES (next_id, list_id, entry.value ->> 'name', entry.value ->> 'color', next_type,
        entry.ordinality - 1, entry.value ->> 'key', next_wip);
    END IF;
    kept_ids := array_append(kept_ids, next_id);
  END LOOP;

  FOR old_status IN SELECT * FROM public."Status" WHERE id = ANY(original_ids) AND NOT (id = ANY(kept_ids)) LOOP
    SELECT * INTO target_status FROM public."Status" s WHERE s.id = ANY(kept_ids)
    ORDER BY (s.type = old_status.type) DESC,
      ((s.type IN ('DONE', 'CLOSED')) = (old_status.type IN ('DONE', 'CLOSED'))) DESC, s.position, s.id LIMIT 1;
    UPDATE public."Task" SET "statusId" = target_status.id, "updatedAt" = CURRENT_TIMESTAMP,
      "completedAt" = CASE WHEN target_status.type IN ('DONE', 'CLOSED') THEN COALESCE("completedAt", CURRENT_TIMESTAMP) ELSE NULL END
    WHERE "statusId" = old_status.id;
    UPDATE public."TaskAutomation" SET enabled = false, "statusId" = NULL
    WHERE "listId" = list_id AND "statusId" = old_status.id;
    DELETE FROM public."Status" WHERE id = old_status.id;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION oc_sync_list_statuses(text, jsonb) FROM PUBLIC;

CREATE FUNCTION oc_apply_list_status_workflow(list_id text, workflow jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF oc_acl('list', list_id) < 3 THEN
    RAISE insufficient_privilege USING MESSAGE = 'List edit permission is required';
  END IF;
  PERFORM oc_sync_list_statuses(list_id, workflow);
END $$;

REVOKE ALL ON FUNCTION oc_apply_list_status_workflow(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION oc_apply_list_status_workflow(text, jsonb) TO open_clickup_request;

CREATE FUNCTION oc_propagate_status_workflow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  placement record;
  target_space text;
  target_folder text;
  effective jsonb;
  space_workflow jsonb;
  defaults constant jsonb := '[
    {"key":"todo","name":"TO DO","color":"#87909e","type":"NOT_STARTED"},
    {"key":"progress","name":"IN PROGRESS","color":"#5b9fff","type":"ACTIVE"},
    {"key":"review","name":"IN REVIEW","color":"#a875ff","type":"ACTIVE"},
    {"key":"complete","name":"COMPLETE","color":"#6bc950","type":"DONE"}
  ]';
BEGIN
  IF TG_TABLE_NAME = 'Folder' THEN
    target_space := NEW."spaceId";
    target_folder := NEW.id;
  ELSE
    target_space := NEW.id;
  END IF;
  SELECT "statusWorkflow" INTO space_workflow FROM public."Space" WHERE id = target_space;

  FOR placement IN
    WITH RECURSIVE descendants(id) AS (
      SELECT target_folder WHERE target_folder IS NOT NULL
      UNION SELECT f.id FROM public."Folder" f JOIN descendants d ON f."parentId" = d.id
      WHERE f."spaceId" = target_space
    )
    SELECT l.id, l."folderId" FROM public."List" l
    WHERE l."spaceId" = target_space AND l."inheritStatuses"
      AND (target_folder IS NULL OR l."folderId" IN (SELECT id FROM descendants))
    ORDER BY l.id
  LOOP
    WITH RECURSIVE ancestors(id, parent_id, workflow, visited) AS (
      SELECT f.id, f."parentId", f."statusWorkflow", ARRAY[f.id]
      FROM public."Folder" f WHERE f.id = placement."folderId"
      UNION ALL
      SELECT f.id, f."parentId", f."statusWorkflow", array_append(a.visited, f.id)
      FROM public."Folder" f JOIN ancestors a ON f.id = a.parent_id
      WHERE f."spaceId" = target_space AND NOT (f.id = ANY(a.visited))
    )
    SELECT workflow INTO effective FROM ancestors WHERE workflow IS NOT NULL ORDER BY cardinality(visited) LIMIT 1;
    PERFORM oc_sync_list_statuses(placement.id, COALESCE(effective, space_workflow, defaults));
  END LOOP;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION oc_propagate_status_workflow() FROM PUBLIC;

CREATE TRIGGER oc_space_status_workflow AFTER UPDATE OF "statusWorkflow" ON "Space"
FOR EACH ROW WHEN (OLD."statusWorkflow" IS DISTINCT FROM NEW."statusWorkflow")
EXECUTE FUNCTION oc_propagate_status_workflow();

CREATE TRIGGER oc_folder_status_workflow AFTER UPDATE OF "statusWorkflow" ON "Folder"
FOR EACH ROW WHEN (OLD."statusWorkflow" IS DISTINCT FROM NEW."statusWorkflow")
EXECUTE FUNCTION oc_propagate_status_workflow();
