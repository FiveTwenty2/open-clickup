"use client";

import { createContext, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { addDays, differenceInCalendarDays, format, isValid, startOfDay } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/lib/api";
import { embedAddress, type ViewKind } from "@/lib/view-kind";
import { isCompletedStatus } from "@/lib/task-status";
import type { ViewState } from "@/lib/view-state";

export type ViewTask = {
  id: string; name: string; parentId?: string | null; listId?: string;
  list?: { name: string }; status: { name: string; color?: string; type?: string };
  priority?: string | null; startDate?: Date | string | null; dueDate?: Date | string | null;
  milestone?: boolean; timeEstimate?: number | null;
  mapLatitude?: number | null; mapLongitude?: number | null;
  assigned?: boolean; assignees?: { user: { id: string; name: string } }[];
};
type ViewProps = {
  type: Exclude<ViewKind, "CALENDAR" | "GANTT">; tasks: ViewTask[]; onOpen?: (task: ViewTask) => void;
  editable?: boolean; embedUrl?: string | null; onEmbedChange?: (url: string | null) => void;
  onDatesChange?: (task: ViewTask, dates: { startDate?: string; dueDate?: string }) => void;
  mindMap?: ViewState["mindMap"];
  onMindMapChange?: (map: NonNullable<ViewState["mindMap"]>) => void;
  boardStatuses?: { name: string; id: string; listId: string }[];
  onStatusChange?: (task: ViewTask, statusId: string) => void;
  wrapTask?: (task: ViewTask, element: ReactNode) => ReactNode;
  statusCell?: (task: ViewTask) => ReactNode;
  selection?: { ids: Set<string>; toggle: (id: string) => void; toggleAll: () => void };
  groupBy?: ViewState["groupBy"];
};

const button = "rounded border border-cu-border bg-cu-panel px-3 py-1.5 text-sm hover:bg-cu-hover disabled:opacity-50";
const TaskWrapper = createContext<ViewProps["wrapTask"]>(undefined);

function TaskName({ task, onOpen }: { task: ViewTask; onOpen?: (task: ViewTask) => void }) {
  const wrapTask = useContext(TaskWrapper);
  const text = <>{task.milestone && "◆ "}{task.name}</>;
  const element = onOpen
    ? <button onClick={() => onOpen(task)} className="text-left text-sm font-medium hover:text-cu-purple hover:underline">{text}</button>
    : <span className="text-sm font-medium">{text}</span>;
  return wrapTask ? wrapTask(task, element) : element;
}

export function ViewRenderer(props: ViewProps) {
  return <TaskWrapper.Provider value={props.wrapTask}><ViewBody {...props} /></TaskWrapper.Provider>;
}

function ViewBody(props: ViewProps) {
  switch (props.type) {
    case "TIMELINE":
      return <Timeline {...props} />;
    case "TEAM":
      return <Team {...props} />;
    case "MIND_MAP":
      return <MindMapMode {...props} />;
    case "MAP":
      return <TaskMap {...props} />;
    case "EMBED":
      return <Embed key={props.embedUrl ?? ""} {...props} />;
    case "BOARD":
      return <Board {...props} />;
    default:
      return <TaskTable {...props} />;
  }
}

function TaskTable({ tasks, onOpen, statusCell, selection, groupBy = "none" }: ViewProps) {
  const groups = groupedTasks(tasks, (task) => {
    if (groupBy === "status") return task.status.name;
    if (groupBy === "priority") return task.priority ? task.priority[0] + task.priority.slice(1).toLowerCase() : "No priority";
    if (groupBy === "assignee") return task.assignees?.map(({ user }) => user.name).join(", ") || (task.assigned ? "Assigned" : "Unassigned");
    return "";
  });
  return <div className="overflow-auto rounded border border-cu-border">
    <table className="w-full text-left text-sm">
      <thead className="bg-cu-panel"><tr>
        {selection && <th scope="col" className="w-10 px-4 py-2"><input type="checkbox"
          aria-label="Select all tasks" checked={tasks.length > 0 && selection.ids.size === tasks.length}
          disabled={!tasks.length || tasks.length > 500} onChange={selection.toggleAll} /></th>}
        {["Task", "Status", "Priority", "Due"].map((label) => <th key={label} scope="col" className="px-4 py-2">{label}</th>)}
      </tr></thead>
      {[...groups].map(([name, rows]) => <tbody key={name}>
      {name && <tr className="border-t border-cu-border bg-cu-panel"><th scope="rowgroup" colSpan={selection ? 5 : 4}
        className="px-4 py-2 text-xs font-semibold">{name}</th></tr>}
      {rows.map((task) => <tr key={task.id} className="border-t border-cu-border">
        {selection && <td className="px-4 py-2"><input type="checkbox" aria-label={`Select ${task.name}`}
          checked={selection.ids.has(task.id)} disabled={!selection.ids.has(task.id) && selection.ids.size >= 500}
          onChange={() => selection.toggle(task.id)} /></td>}
        <td className="px-4 py-2"><TaskName task={task} onOpen={onOpen} />{task.list && <span className="ml-2 text-xs text-cu-text-secondary">{task.list.name}</span>}</td>
        <td className="px-4 py-2">{statusCell?.(task) ?? task.status.name}</td>
        <td className="px-4 py-2 capitalize">{task.priority?.toLowerCase() ?? "—"}</td>
        <td className="px-4 py-2">{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}</td>
      </tr>)}</tbody>)}
    </table>
    {!tasks.length && <p className="p-4 text-sm text-cu-text-secondary">No tasks match this view.</p>}
  </div>;
}

function groupedTasks(tasks: ViewTask[], keyOf: (task: ViewTask) => string) {
  const groups = new Map<string, ViewTask[]>();
  for (const task of tasks) {
    const key = keyOf(task);
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }
  return groups;
}

function Board({ tasks, onOpen, boardStatuses, onStatusChange }: ViewProps) {
  const columns = groupedTasks(tasks, (task) => task.status.name);
  for (const status of boardStatuses ?? []) if (!columns.has(status.name)) columns.set(status.name, []);
  function statusFor(task: ViewTask, name: string) {
    return boardStatuses?.find((status) => status.name === name && status.listId === task.listId);
  }
  return <div className="flex gap-3 overflow-x-auto">
    {[...columns].map(([name, cards]) => <section key={name} aria-label={name} className="min-w-52 flex-1 rounded bg-cu-panel p-3"
      onDragOver={onStatusChange ? (event) => event.preventDefault() : undefined}
      onDrop={onStatusChange ? (event) => {
        event.preventDefault();
        const task = tasks.find(({ id }) => id === event.dataTransfer.getData("application/x-open-clickup-task"));
        const status = task && statusFor(task, name);
        if (task && status && task.status.name !== name) onStatusChange(task, status.id);
      } : undefined}>
      <h2 className="mb-2 text-sm font-semibold">{name} <span className="text-cu-text-secondary">({cards.length})</span></h2>
      <ul className="space-y-2">{cards.map((task) => <li key={task.id} className="rounded border border-cu-border p-2"
        draggable={!!onStatusChange}
        onDragStart={onStatusChange ? (event) => {
          event.dataTransfer.setData("application/x-open-clickup-task", task.id);
          event.dataTransfer.effectAllowed = "move";
        } : undefined}><TaskName task={task} onOpen={onOpen} />
        {onStatusChange && boardStatuses?.some((status) => status.listId === task.listId) && <select
          aria-label={`Change status for ${task.name}`} className="mt-2 block max-w-full rounded border border-cu-border bg-cu-panel text-xs"
          value={statusFor(task, task.status.name)?.id ?? ""}
          onChange={(event) => onStatusChange(task, event.target.value)}>
          {boardStatuses.filter((status) => status.listId === task.listId).map((status) =>
            <option key={status.id} value={status.id}>{status.name}</option>)}
        </select>}
      </li>)}</ul>
    </section>)}
    {!tasks.length && <p className="text-sm text-cu-text-secondary">No tasks match this view.</p>}
  </div>;
}

function dates(task: ViewTask) {
  const start = task.startDate ?? task.dueDate;
  const due = task.dueDate ?? task.startDate;
  if (!start || !due) return null;
  const from = startOfDay(new Date(start));
  const to = startOfDay(new Date(due));
  return isValid(from) && isValid(to) && from <= to ? { from, to } : null;
}

function Timeline({ tasks, onOpen, onDatesChange, editable }: ViewProps) {
  const scheduled = useMemo(() => tasks.flatMap((task) => {
    const span = dates(task);
    return span ? [{ task, ...span }] : [];
  }), [tasks]);
  const [start, setStart] = useState(() => startOfDay(new Date()));
  const [windowSize, setWindowSize] = useState(28);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropError, setDropError] = useState(false);
  const end = addDays(start, windowSize);
  const days = Array.from({ length: windowSize }, (_, index) => addDays(start, index));
  const visible = scheduled.filter((row) => row.from < end && row.to >= start);
  const unscheduled = tasks.filter((task) => !dates(task));
  const range = `${format(start, "MMM d")} – ${format(addDays(end, -1), "MMM d, yyyy")}`;

  function drop(taskId: string, day: Date) {
    setDrag(null);
    const item = scheduled.find(({ task }) => task.id === taskId);
    if (!item || !onDatesChange) return;
    const shift = differenceInCalendarDays(day, item.from);
    const shifted = (value: Date | string) => addDays(new Date(value), shift).toISOString();
    setDropError(false);
    try {
      onDatesChange(item.task, {
        ...(item.task.startDate && { startDate: shifted(item.task.startDate) }),
        ...(item.task.dueDate && { dueDate: shifted(item.task.dueDate) }),
      });
    } catch { setDropError(true); }
  }

  return <section aria-label="Timeline schedule" className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <button className={button} onClick={() => setStart(addDays(start, -windowSize))}>Previous</button>
      <button className={button} onClick={() => setStart(startOfDay(new Date()))}>Today</button>
      <button className={button} onClick={() => setStart(addDays(start, windowSize))}>Next</button>
      <label className="text-sm">Period <select className={button} value={windowSize} onChange={(event) => setWindowSize(Number(event.target.value))}>
        <option value={7}>7 days</option><option value={28}>28 days</option><option value={84}>84 days</option>
      </select></label>
      <label className="text-sm">Jump to date <input className={button} type="date" value={format(start, "yyyy-MM-dd")} onChange={(event) => {
        if (event.target.value) setStart(new Date(event.target.value + "T00:00:00"));
      }} /></label>
      <button className={button} aria-expanded={showUnscheduled} onClick={() => setShowUnscheduled(!showUnscheduled)}>Unscheduled ({unscheduled.length})</button>
      <span className="text-sm text-cu-text-secondary">{range}</span>
    </div>
    {dropError && <p role="alert">Could not reschedule task.</p>}
    <div className="overflow-auto rounded border border-cu-border">
      <div className="min-w-max" style={{ width: Math.max(760, windowSize * 26 + 240) }}>
        <div className="flex border-b border-cu-border bg-cu-panel">
          <div className="w-60 shrink-0 px-3 py-2 text-sm font-semibold">Task</div>
          <div className="relative flex flex-1">
            {days.map((day) => <div key={day.toISOString()} className="flex-1 border-l border-cu-border py-2 text-center text-xs" title={format(day, "PPP")}
              onDragOver={(event) => { if (drag) event.preventDefault(); }}
              onDrop={(event) => { event.preventDefault(); drop(event.dataTransfer.getData("text/plain"), day); }}>
              {format(day, "d")}
            </div>)}
          </div>
        </div>
        {visible.map(({ task, from, to }) => {
          const left = Math.max(0, differenceInCalendarDays(from, start));
          const right = Math.min(windowSize, differenceInCalendarDays(to, start) + 1);
          return <div key={task.id} className="flex border-b border-cu-border last:border-b-0">
            <div className="w-60 shrink-0 px-3 py-2"><TaskName task={task} onOpen={onOpen} /></div>
            <div className="relative min-h-9 flex-1">
              <div className="absolute bottom-1 top-1 flex items-center truncate rounded bg-cu-purple/15 px-2 text-xs text-cu-text"
                draggable={!!editable && !!onDatesChange}
                onDragStart={(event) => { event.dataTransfer.setData("text/plain", task.id); setDrag(task.id); }}
                onDragEnd={() => setDrag(null)}
                style={{ left: `${left / windowSize * 100}%`, width: `${(right - left) / windowSize * 100}%`, borderLeft: `3px solid ${task.status.color ?? "#7b68ee"}` }}
                title={`${task.name} · ${format(from, "PP")} – ${format(to, "PP")}`}>
                {task.milestone ? "◆" : task.name}
              </div>
            </div>
          </div>;
        })}
        {!visible.length && <p className="p-4 text-sm text-cu-text-secondary">No scheduled tasks in this period.</p>}
      </div>
    </div>
    {showUnscheduled && <ul className="space-y-1">{unscheduled.map((task) => <li key={task.id}><TaskName task={task} onOpen={onOpen} /></li>)}</ul>}
  </section>;
}

function Team({ tasks, onOpen }: ViewProps) {
  const [filter, setFilter] = useState("");
  const groups = new Map<string, { name: string; tasks: ViewTask[] }>();
  function add(id: string, name: string, task: ViewTask) {
    const group = groups.get(id) ?? { name, tasks: [] };
    group.tasks.push(task);
    groups.set(id, group);
  }
  for (const task of tasks) {
    if (task.assignees?.length) {
      for (const { user } of task.assignees) add(user.id, user.name, task);
    } else add(task.assigned ? "assigned" : "unassigned", task.assigned ? "Assigned" : "Unassigned", task);
  }
  return <section aria-label="Team workload" className="space-y-3">
    {groups.size > 0 && <label className="text-sm">Teammate <select className={button} value={filter} onChange={(event) => setFilter(event.target.value)}>
      <option value="">Everyone</option>
      {[...groups].map(([id, group]) => <option key={id} value={id}>{group.name}</option>)}
    </select></label>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {[...groups].filter(([id]) => !filter || filter === id).map(([id, group]) => {
        const done = group.tasks.filter(({ status }) => isCompletedStatus(status.type ?? "")).length;
        const hours = group.tasks.reduce((sum, task) => sum + (task.timeEstimate ?? 0), 0) / 60;
        return <section key={id} className="rounded border border-cu-border bg-cu-panel p-3">
          <h2 className="text-sm font-semibold">{group.name}</h2>
          <p className="mt-1 text-xs text-cu-text-secondary">{group.tasks.length - done} open · {done} complete{hours > 0 && ` · ${Number(hours.toFixed(1))} h estimated`}</p>
          <ul className="mt-2 divide-y divide-cu-border">{group.tasks.map((task) => <li key={task.id} className="py-2"><TaskName task={task} onOpen={onOpen} /></li>)}</ul>
        </section>;
      })}
    </div>
    {!groups.size && <p className="text-sm text-cu-text-secondary">No tasks match this view.</p>}
  </section>;
}

function MindMapMode({ mindMap, onMindMapChange, ...props }: ViewProps) {
  const map = mindMap ?? { mode: "tasks" as const, nodes: [] };
  const [draft, setDraft] = useState<{ parentId: string | null; id?: string; label: string } | null>(null);
  function renderNodes(parentId: string | null): ReactNode {
    return <ul className="space-y-2 pl-5">{map.nodes.filter((node) => node.parentId === parentId).map((node) =>
      <li key={node.id} className="border-l border-cu-border pl-3">
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <span className="rounded border border-cu-border px-3 py-1 text-sm">{node.label}</span>
          {onMindMapChange && <>
            <button className={button} aria-label={`Add child to ${node.label}`} disabled={map.nodes.length >= 200}
              onClick={() => setDraft({ parentId: node.id, label: "" })}>Add child</button>
            <button className={button} aria-label={`Rename ${node.label}`} onClick={() => setDraft(node)}>Rename</button>
            <button className={button} aria-label={`Delete branch ${node.label}`} onClick={() => {
              const deleted = new Set([node.id]);
              for (const child of map.nodes) if (child.parentId && deleted.has(child.parentId)) deleted.add(child.id);
              setDraft(null);
              onMindMapChange({ ...map, nodes: map.nodes.filter(({ id }) => !deleted.has(id)) });
            }}>Delete branch</button>
          </>}
        </div>
        {renderNodes(node.id)}
      </li>)}</ul>;
  }
  return <section className="space-y-3">
    {onMindMapChange && <label className="flex items-center gap-2 text-sm">Mind map mode
      <select className={button} value={map.mode} onChange={(event) => {
        setDraft(null);
        onMindMapChange({ ...map, mode: event.target.value === "freeform" ? "freeform" : "tasks" });
      }}><option value="tasks">Tasks</option><option value="freeform">Freeform</option></select>
    </label>}
    {map.mode === "tasks" ? <MindMap {...props} /> : <section aria-label="Freeform mind map" className="space-y-3">
      {onMindMapChange && <button className={button} disabled={map.nodes.length >= 200}
        onClick={() => setDraft({ parentId: null, label: "" })}>Add root node</button>}
      {draft && onMindMapChange && <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
        event.preventDefault();
        const label = draft.label.trim();
        if (!label || (!draft.id && map.nodes.length >= 200)) return;
        const nodes = draft.id ? map.nodes.map((node) => node.id === draft.id ? { ...node, label } : node)
          : [...map.nodes, { id: crypto.randomUUID(), label, parentId: draft.parentId }];
        onMindMapChange({ ...map, nodes });
        setDraft(null);
      }}><label className="flex items-center gap-2 text-sm">Node label
        <input className={button} required maxLength={160} value={draft.label}
          onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
      </label><button className={button} disabled={!draft.label.trim()}>Save node</button>
        <button type="button" className={button} onClick={() => setDraft(null)}>Cancel</button>
      </form>}
      {renderNodes(null)}
    </section>}
  </section>;
}

function MindMap({ tasks, onOpen }: ViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const ids = new Set(tasks.map(({ id }) => id));
  const children = groupedTasks(tasks, (task) => task.parentId && ids.has(task.parentId) ? task.parentId : "");
  function branch(task: ViewTask, ancestors: Set<string>): ReactNode {
    if (ancestors.has(task.id)) return null;
    const nested = children.get(task.id) ?? [];
    const next = new Set(ancestors).add(task.id);
    return <li key={task.id} className="relative pl-4 before:absolute before:left-0 before:top-4 before:w-4 before:border-t before:border-cu-border">
      <div className="inline-flex items-center gap-2 rounded border border-cu-border bg-cu-panel px-3 py-1.5">
        {nested.length > 0 && <button aria-expanded={!collapsed.has(task.id)} aria-label={`Toggle branches for ${task.name}`} onClick={() => {
          const updated = new Set(collapsed);
          if (updated.has(task.id)) updated.delete(task.id); else updated.add(task.id);
          setCollapsed(updated);
        }}>{collapsed.has(task.id) ? "+" : "−"}</button>}
        <TaskName task={task} onOpen={onOpen} />
      </div>
      {nested.length > 0 && !collapsed.has(task.id) && <ul className="ml-4 mt-2 space-y-2 border-l border-cu-border">{nested.map((child) => branch(child, next))}</ul>}
    </li>;
  }
  return <section aria-label="Task mind map" className="overflow-auto p-2">
    <h2 className="inline-block rounded bg-cu-purple/15 px-4 py-2 text-sm font-semibold">Tasks</h2>
    <ul className="ml-4 mt-2 space-y-2 border-l border-cu-border">{(children.get("") ?? []).map((task) => branch(task, new Set()))}</ul>
    {!tasks.length && <p className="mt-2 text-sm text-cu-text-secondary">No tasks match this view.</p>}
  </section>;
}

function Embed({ embedUrl, editable, onEmbedChange }: ViewProps) {
  const [address, setAddress] = useState(embedUrl ?? "");
  const [error, setError] = useState("");
  const [load, setLoad] = useState(false);
  const safe = embedUrl ? embedAddress(embedUrl) : null;
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = address ? embedAddress(address) : null;
    if (address && !value) { setError("Enter a valid HTTPS address."); return; }
    setError("");
    onEmbedChange?.(value);
  }
  return <section aria-label="Embedded content" className="space-y-3">
    {editable && <form className="flex flex-wrap gap-2" onSubmit={submit}>
      <label className="flex flex-1 flex-wrap items-center gap-2 text-sm">Embed URL <input type="url" className={button + " min-w-48 flex-1"} maxLength={2000}
        value={address} placeholder="https://" onChange={(event) => setAddress(event.target.value)} /></label>
      <button className={button} type="submit">Save embed</button>
    </form>}
    {error && <p role="alert" className="text-sm text-cu-urgent">{error}</p>}
    {safe ? <>
      <div className="flex gap-2"><Link href={safe} target="_blank" rel="noreferrer noopener" className={button}>Open source</Link>
        {!load && <button className={button} onClick={() => setLoad(true)}>Load embedded content</button>}</div>
      {load && <iframe title="Embedded website" className="h-[70vh] w-full rounded border border-cu-border"
        src={safe} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" />}
    </> : <p className="text-sm text-cu-text-secondary">No website has been added to this view.</p>}
  </section>;
}

const TILE = 256;
const MAP_WIDTH = 768;
const MAP_HEIGHT = 416;
const MAX_LATITUDE = 85.05112878;

function project(latitude: number, longitude: number, zoom: number) {
  const size = TILE * 2 ** zoom;
  const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude)) * Math.PI / 180;
  return { x: (longitude + 180) / 360 * size, y: (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * size };
}

function TaskMap({ tasks, onOpen, editable }: ViewProps) {
  const located = tasks.filter((task) => task.mapLatitude != null && task.mapLongitude != null);
  const first = located[0];
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [zoom, setZoom] = useState(2);
  const [loadTiles, setLoadTiles] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [coordinates, setCoordinates] = useState({ lat: "", lon: "" });
  const active = tasks.find((task) => task.id === selectedId);
  const target = center ?? { lat: first?.mapLatitude ?? 0, lon: first?.mapLongitude ?? 0 };
  const origin = project(target.lat, target.lon, zoom);
  const left = origin.x - MAP_WIDTH / 2;
  const top = origin.y - MAP_HEIGHT / 2;
  const extent = 2 ** zoom;
  const tiles: { x: number; y: number; tileX: number }[] = [];
  for (let y = Math.floor(top / TILE); y <= Math.floor((top + MAP_HEIGHT) / TILE); y++) {
    if (y < 0 || y >= extent) continue;
    for (let x = Math.floor(left / TILE); x <= Math.floor((left + MAP_WIDTH) / TILE); x++) {
      tiles.push({ x, y, tileX: (x % extent + extent) % extent });
    }
  }
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (point: { latitude: number | null; longitude: number | null }) =>
      apiSend(`/api/tasks/${active?.id}/map-location`, "PATCH", point),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["scoped-views"] });
      void client.invalidateQueries({ queryKey: ["list"] });
    },
  });

  function pick(task: ViewTask) {
    setSelectedId(task.id);
    setCoordinates({ lat: task.mapLatitude?.toString() ?? "", lon: task.mapLongitude?.toString() ?? "" });
    if (task.mapLatitude != null && task.mapLongitude != null) setCenter({ lat: task.mapLatitude, lon: task.mapLongitude });
  }

  function pan(lat: number, lon: number) {
    const factor = 90 / 2 ** zoom;
    setCenter({ lat: Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, target.lat + lat * factor)), lon: (target.lon + lon * factor + 540) % 360 - 180 });
  }

  return <section aria-label="Task map" className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <button className={button} aria-label="Zoom in" disabled={zoom >= 16} onClick={() => setZoom(zoom + 1)}>+</button>
      <button className={button} aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(zoom - 1)}>−</button>
      {([["North", 1, 0], ["South", -1, 0], ["West", 0, -1], ["East", 0, 1]] as const).map(([label, lat, lon]) =>
        <button key={label} className={button} onClick={() => pan(lat, lon)}>{label}</button>)}
      <button className={button} aria-pressed={loadTiles} onClick={() => setLoadTiles(!loadTiles)}>{loadTiles ? "Hide basemap" : "Load OpenStreetMap basemap"}</button>
    </div>
    <div className="overflow-auto rounded border border-cu-border bg-cu-panel">
      <div className="relative overflow-hidden" style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}>
        {loadTiles && tiles.map(({ x, y, tileX }) => (
          // Raster tiles are displayed at their native dimensions and cached by the browser.
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${zoom}:${x}:${y}`} src={`https://tile.openstreetmap.org/${zoom}/${tileX}/${y}.png`} alt=""
            width={TILE} height={TILE} referrerPolicy="origin" className="pointer-events-none absolute"
            style={{ left: x * TILE - left, top: y * TILE - top }} />
        ))}
        {located.map((task) => {
          const point = project(task.mapLatitude!, task.mapLongitude!, zoom);
          const size = TILE * extent;
          const x = ((point.x - left) % size + size) % size;
          const y = point.y - top;
          if (x > MAP_WIDTH || y < 0 || y > MAP_HEIGHT) return null;
          return <button key={task.id} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white p-1.5 shadow"
            style={{ left: x, top: y, background: task.status.color ?? "#7b68ee" }} title={task.name}
            aria-label={`Map pin for ${task.name}`} onClick={() => pick(task)} />;
        })}
        {loadTiles && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer"
          className="absolute bottom-0 right-0 bg-white px-1 text-xs text-black">© OpenStreetMap contributors</a>}
      </div>
    </div>
    <label className="text-sm">Task <select className={button} value={selectedId} onChange={(event) => {
      const task = tasks.find(({ id }) => id === event.target.value);
      if (task) pick(task); else setSelectedId("");
    }}>
      <option value="">Select a task</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
    </select></label>
    {active && <div className="space-y-2 rounded border border-cu-border p-3">
      <TaskName task={active} onOpen={onOpen} />
      {active.mapLatitude != null && active.mapLongitude != null && <p className="text-xs text-cu-text-secondary">{active.mapLatitude}, {active.mapLongitude}</p>}
      {editable && <form className="flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ latitude: Number(coordinates.lat), longitude: Number(coordinates.lon) });
      }}>
        <label className="text-sm">Latitude <input className={button + " w-32"} type="number" min={-90} max={90} step="any" required value={coordinates.lat}
          onChange={(event) => setCoordinates({ ...coordinates, lat: event.target.value })} /></label>
        <label className="text-sm">Longitude <input className={button + " w-32"} type="number" min={-180} max={180} step="any" required value={coordinates.lon}
          onChange={(event) => setCoordinates({ ...coordinates, lon: event.target.value })} /></label>
        <button className={button} disabled={save.isPending}>Save location</button>
        {active.mapLatitude != null && <button className={button} type="button" disabled={save.isPending} onClick={() => {
          setCoordinates({ lat: "", lon: "" });
          save.mutate({ latitude: null, longitude: null });
        }}>Remove location</button>}
      </form>}
      {save.isError && <p role="alert" className="text-sm text-cu-urgent">Could not save this task location.</p>}
    </div>}
    {!located.length && <p className="text-sm text-cu-text-secondary">No tasks have a map location.</p>}
  </section>;
}
