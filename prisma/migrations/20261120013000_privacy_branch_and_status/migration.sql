CREATE FUNCTION oc_public_status(status_id text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT oc_actor() IS NULL AND EXISTS (
    SELECT 1 FROM public."Task" t WHERE t."statusId" = status_id AND oc_public_scope('task', t.id, 1)
  )
$$;
ALTER POLICY oc_select ON "Status" USING (oc_can('list', "listId", 1) OR oc_public_status(id));

CREATE FUNCTION oc_can_manage_task_branch(task_id text, minimum integer) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH RECURSIVE branch(id) AS (
    SELECT task_id
    UNION
    SELECT t.id FROM public."Task" t JOIN branch b ON t."parentId" = b.id
  )
  SELECT NOT EXISTS (SELECT 1 FROM branch b WHERE oc_acl('task', b.id) < minimum)
$$;
