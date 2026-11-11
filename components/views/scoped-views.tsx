"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";
import { ViewOptions } from "@/components/views/view-options";
import { ViewRenderer, type ViewTask } from "@/components/views/special-views";
import { CalendarView } from "@/components/views/calendar-view";
import { GanttChart } from "@/components/views/gantt-view";
import { TaskContextMenu } from "@/components/task/task-context-menu";
import { StatusControl } from "@/components/menus/status-control";
import { BulkBar } from "@/components/views/bulk-bar";
import { useBulk } from "@/lib/hooks";
import { FilterMenu, GroupMenu, SortMenu } from "@/components/views/filter-sort";
import { applyViewState, EMPTY_VIEW_STATE, type ViewState } from "@/lib/view-state";
import { VIEW_KINDS, VIEW_LABELS, type ViewKind } from "@/lib/view-kind";
import { savedViewConfig } from "@/lib/saved-view-config";
import type { ScopedView } from "@/lib/generated/prisma/client";
import type { getScopedViewTasks } from "@/lib/scoped-views";
import type { TaskPatch } from "@/lib/tasks";
import type { StatusModel } from "@/lib/queries";
import { isCompletedStatus } from "@/lib/task-status";

type Result = { name: string; views: ScopedView[]; tasks: Awaited<ReturnType<typeof getScopedViewTasks>>;
  lists: { id: string; name: string; statuses: StatusModel[] }[];
  dependencies: { id: string; blockerId: string; blockedId: string }[];
};
const control = "rounded border border-cu-border bg-cu-panel px-3 py-1.5 text-sm hover:bg-cu-hover disabled:opacity-50";

function viewConfig(value: unknown): ViewState {
  const parsed = savedViewConfig.safeParse(value ?? {});
  return parsed.success ? parsed.data : EMPTY_VIEW_STATE;
}

export function ScopedViews({ spaceId, folderId }: { spaceId?: string; folderId?: string }) {
  const { workspace, currentUser } = useWorkspace();
  const role = workspace.members.find((member) => member.userId === currentUser.id)?.role;
  const admin = role === "OWNER" || role === "ADMIN";
  const writable = role !== "GUEST" && !!role;
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ViewKind>("LIST");
  const [privateView, setPrivateView] = useState(false);
  const [localConfig, setLocalConfig] = useState<{ id: string; value: ViewState } | null>(null);
  const [checked, setChecked] = useState<{ viewId: string | undefined; ids: Set<string> }>();
  const key = ["scoped-views", spaceId, folderId];
  const params = new URLSearchParams();
  if (spaceId) params.set("spaceId", spaceId);
  if (folderId) params.set("folderId", folderId);
  const query = useQuery({
    queryKey: key, queryFn: () => apiGet<Result>(`/api/scoped-views?${params}`), retry: false,
  });
  const views = query.data?.views ?? [];
  const fallback = views.find((view) => !view.privateOwnerId);
  const active = views.find((view) => view.id === search.get("view")) ?? fallback;
  const config = localConfig?.id === (active?.id ?? "") ? localConfig.value : viewConfig(active?.config);
  const canEdit = writable && !!active && (!active.privateOwnerId || active.privateOwnerId === currentUser.id) && (!active.protected || admin);
  const all = query.data?.tasks ?? [];
  const includeChildren = config.subtasks
    ? config.subtasks !== "collapsed"
    : active?.type === "MIND_MAP" || active?.type === "CALENDAR";
  const tasks = applyViewState(all.filter((task) => !task.parentId
    || (includeChildren && (!config.hideClosedSubtasks || !isCompletedStatus(task.status.type)))), config);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const statusesByList = new Map(query.data?.lists.map(({ id, statuses }) => [id, statuses]));
  for (const task of tasks) if (!statusesByList.has(task.listId)) statusesByList.set(task.listId, task.list.statuses);
  const editableGrid = writable && (!active || active.type === "LIST" || active.type === "TABLE");
  const taskGrid = !active || active.type === "LIST" || active.type === "TABLE";
  const selected = new Set(editableGrid && checked?.viewId === active?.id
    ? [...(checked?.ids ?? [])].filter((id) => taskById.has(id)) : []);
  const selectedLists = [...new Set([...selected].map((id) => taskById.get(id)!.listId))];
  const availableStatuses = (statusesByList.get(selectedLists[0]) ?? []).filter((status) => selectedLists.every((id) =>
    statusesByList.get(id)?.some((other) => other.type === status.type && other.name.toLowerCase() === status.name.toLowerCase())));
  const bulk = useBulk(undefined);
  function changeBulk(change: Omit<Parameters<typeof bulk.mutate>[0], "ids">) {
    if (!selected.size || bulk.isPending) return;
    bulk.mutate({ ...change, ids: [...selected] }, { onSuccess: () => {
      if (change.delete || change.patch?.archived) setChecked(undefined);
      void client.invalidateQueries({ queryKey: key });
    } });
  }
  const create = useMutation({
    mutationFn: () => apiSend<ScopedView>("/api/scoped-views", "POST", { spaceId, folderId, name, type, private: privateView }),
    onSuccess: async (view) => {
      await client.invalidateQueries({ queryKey: key });
      selectView(view);
      setAdding(false); setName(""); setPrivateView(false); setType("LIST");
    },
  });
  const save = useMutation({
    scope: { id: "scoped-view-config" },
    mutationFn: ({ id, state }: { id: string; state: ViewState }) => apiSend<ScopedView>(
      `/api/scoped-views/${id}`, "PATCH", { config: state }, { keepalive: true }),
    onSuccess: (updated, { id, state }) => {
      client.setQueryData<Result>(key, (current) => current && {
        ...current, views: current.views.map((view) => view.id === id ? updated : view),
      });
      setLocalConfig((draft) => draft?.id === id && draft.value === state ? null : draft);
    },
  });
  const reschedule = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) => apiSend(`/api/tasks/${id}`, "PATCH", patch),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });

  function selectView(view: { id: string } | null) {
    setLocalConfig(null);
    router.replace(view ? `${pathname}?view=${view.id}` : pathname);
  }
  function update(next: ViewState) {
    setLocalConfig({ id: active?.id ?? "", value: next });
    if (canEdit && active) save.mutate({ id: active.id, state: next });
  }
  function openTask(task: ViewTask) {
    if (task.listId) router.push(`/l/${task.listId}?task=${task.id}`);
  }

  return <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-7">
    <h1 className="text-xl font-semibold">{query.data?.name ?? "Saved views"}</h1>
    {query.isPending && <p role="status" className="mt-3 text-sm">Loading views…</p>}
    {query.isError && <p role="alert" className="mt-3 text-sm text-cu-urgent">This location is unavailable.</p>}
    {query.data && <>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-cu-border pb-2">
        {views.map((view) => <ViewOptions key={view.id} view={view} active={view.id === active?.id}
          allowDelete isDefault={view.id === fallback?.id} selectView={selectView} locationHref={pathname} apiBase="/api/scoped-views"
          canEdit={writable && (!view.privateOwnerId || view.privateOwnerId === currentUser.id) && (!view.protected || admin)}
          canManage={admin && (!view.privateOwnerId || view.privateOwnerId === currentUser.id)}
          canShare={view.privateOwnerId ? view.privateOwnerId === currentUser.id : admin}
          tab={<button className={control + (view.id === active?.id ? " border-cu-purple" : "")}
            onClick={() => selectView(view)}>{view.name}{view.privateOwnerId && <span aria-hidden> · Private</span>}</button>} />)}
        {writable && <button className={control} aria-expanded={adding} onClick={() => setAdding(!adding)}>Add view</button>}
      </div>
      {adding && <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate(); }}>
        <label className="grid gap-1 text-sm">View name<input className={control} value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} /></label>
        <label className="grid gap-1 text-sm">View type<select className={control} value={type} onChange={(event) => setType(event.target.value as ViewKind)}>
          {VIEW_KINDS.map((kind) => <option key={kind} value={kind}>{VIEW_LABELS[kind]}</option>)}</select></label>
        <label className="flex items-center gap-2 px-2 py-1.5 text-sm"><input type="checkbox" checked={privateView} onChange={(event) => setPrivateView(event.target.checked)} /> Private view</label>
        <button className={control} disabled={!name.trim() || create.isPending}>Create view</button>
        {create.isError && <p role="alert" className="text-sm text-cu-urgent">Could not create the view.</p>}
      </form>}
      <div className="my-3 flex flex-wrap gap-2">
        <FilterMenu state={config} onChange={update} tasks={all} />
        <SortMenu state={config} onChange={update} />
        {taskGrid && <GroupMenu state={config} onChange={update} />}
        {active?.type !== "EMBED" && <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeChildren}
              onChange={(event) => update({ ...config, subtasks: event.target.checked ? "separate" : "collapsed" })} />
            Show subtasks
          </label>
          {includeChildren && <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!config.hideClosedSubtasks}
              onChange={(event) => update({ ...config, hideClosedSubtasks: event.target.checked })} />
            Hide closed subtasks
          </label>}
        </>}
        {active?.protected && !admin && <span className="text-xs text-cu-text-secondary">Filters apply for this session.</span>}
      </div>
      {save.isError && <p role="alert" className="mb-2 text-sm text-cu-urgent">Could not save the view settings.</p>}
      {save.isPending && <p role="status" className="mb-2 text-sm text-cu-text-secondary">Saving view settings…</p>}
      {reschedule.isError && <p role="alert" className="mb-2 text-sm text-cu-urgent">Could not update the task.</p>}
      {bulk.isError && <p role="alert" className="mb-2 text-sm text-cu-urgent">Could not update the selected tasks.</p>}
      {active?.type === "CALENDAR" ? <CalendarView tasks={tasks} lists={query.data.lists} canSchedule={writable} includeSubtasks={includeChildren}
        onOpenTask={(id, listId) => router.push(`/l/${listId}?task=${id}`)} /> : active?.type === "GANTT" ?
        <GanttChart tasks={tasks} dependencies={query.data.dependencies}
          onOpenTask={(id) => { const task = taskById.get(id); if (task) openTask(task); }}
          onReschedule={writable ? (id, patch) => reschedule.mutate({ id, patch }) : undefined}
          wrapRow={(task, row) => {
            const fullTask = taskById.get(task.id)!;
            const statuses = statusesByList.get(fullTask.listId);
            return <TaskContextMenu task={fullTask} statuses={statuses} onOpen={() => openTask(fullTask)}><div>{row}</div></TaskContextMenu>;
          }} /> : <ViewRenderer
        type={active?.type ?? "LIST"} tasks={tasks} onOpen={openTask} editable={active?.type === "EMBED" ? canEdit : writable}
        groupBy={config.groupBy}
        embedUrl={config.embedUrl} onEmbedChange={(embedUrl) => update({ ...config, embedUrl })}
        mindMap={config.mindMap} onMindMapChange={canEdit ? (mindMap) => update({ ...config, mindMap }) : undefined}
        wrapTask={(task, element) => {
          const fullTask = taskById.get(task.id)!;
          return <TaskContextMenu task={fullTask} statuses={statusesByList.get(fullTask.listId)}
            onOpen={() => openTask(fullTask)}><span>{element}</span></TaskContextMenu>;
        }}
        boardStatuses={[...statusesByList.values()].flat()}
        selection={editableGrid ? {
          ids: selected,
          toggle: (id) => {
            if (selected.has(id)) selected.delete(id);
            else if (selected.size < 500) selected.add(id);
            setChecked({ viewId: active?.id, ids: new Set(selected) });
          },
          toggleAll: () => setChecked({ viewId: active?.id,
            ids: selected.size === tasks.length ? new Set() : new Set(tasks.slice(0, 500).map(({ id }) => id)) }),
        } : undefined}
        statusCell={editableGrid ? (task) => {
          const fullTask = taskById.get(task.id)!;
          return <StatusControl variant="badge" taskName={task.name} current={fullTask.status}
            statuses={statusesByList.get(fullTask.listId) ?? []}
            onChange={(statusId) => reschedule.mutate({ id: task.id, patch: { statusId } })} />;
        } : undefined}
        onStatusChange={writable ? (task, statusId) => reschedule.mutate({ id: task.id, patch: { statusId } }) : undefined}
        onDatesChange={(task, patch) => reschedule.mutate({ id: task.id, patch })} />}
      {selected.size > 0 && <BulkBar count={selected.size} statuses={availableStatuses}
        onSetStatus={(id) => {
          const status = availableStatuses.find((option) => option.id === id);
          if (status) changeBulk({ patch: { status: { name: status.name, type: status.type } } });
        }}
        onSetPriority={(priority) => changeBulk({ patch: { priority } })}
        onSetAssignees={(assigneeIds) => changeBulk({ patch: { assigneeIds } })}
        onDueDate={(dueDate) => changeBulk({ patch: { dueDate } })}
        onArchive={() => changeBulk({ patch: { archived: true } })}
        onDelete={() => changeBulk({ delete: true })}
        onClear={() => setChecked(undefined)} />}
    </>}
  </main>;
}
