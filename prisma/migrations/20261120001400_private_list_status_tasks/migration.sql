-- A direct status edit applies to every task using that status, including tasks
-- the status editor cannot read. The caller receives no private task data.
CREATE FUNCTION oc_update_status_tasks(status_id text, replacement_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  list_id text;
  completed boolean;
BEGIN
  SELECT s."listId", s.type IN ('DONE', 'CLOSED') INTO list_id, completed
  FROM public."Status" s WHERE s.id = status_id;
  IF NOT FOUND OR oc_acl('list', list_id) < 3 THEN
    RAISE insufficient_privilege USING MESSAGE = 'List edit permission is required';
  END IF;

  IF replacement_id IS NOT NULL THEN
    SELECT s.type IN ('DONE', 'CLOSED') INTO completed FROM public."Status" s
    WHERE s.id = replacement_id AND s."listId" = list_id AND s.id <> status_id;
    IF NOT FOUND THEN
      RAISE invalid_parameter_value USING MESSAGE = 'Choose another status from this list';
    END IF;
  END IF;

  UPDATE public."Task" SET
    "statusId" = COALESCE(replacement_id, status_id),
    "completedAt" = CASE WHEN completed THEN COALESCE("completedAt", CURRENT_TIMESTAMP) ELSE NULL END,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE "statusId" = status_id AND (replacement_id IS NOT NULL OR completed = ("completedAt" IS NULL));

  IF replacement_id IS NOT NULL THEN
    UPDATE public."TaskAutomation" SET enabled = false, "statusId" = NULL
    WHERE "listId" = list_id AND "statusId" = status_id;
    DELETE FROM public."Status" WHERE id = status_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION oc_update_status_tasks(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION oc_update_status_tasks(text, text) TO open_clickup_request;
