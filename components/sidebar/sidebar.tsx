"use client";

import { useState, type ReactElement } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { HierarchyDragRow } from "@/components/sidebar/hierarchy-drag";
import { ListTemplatesDialog, type ListTemplateTarget } from "@/components/views/list-templates";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Search,
  House,
  LayoutGrid,
  Ellipsis,
  Folder as FolderIcon,
  FolderOpen,
  List as ListIcon,
  Settings,
  Bell,
  PanelLeftClose,
  Trash2,
  Pencil,
  FolderPlus,
  LogOut,
  Star,
  FileText,
  Target,
  ClipboardList,
  CalendarDays,
  Gauge,
  Archive,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";
import { useHierarchy } from "@/lib/hooks";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { InboxButton } from "@/components/sidebar/inbox";
import { ProfileDialog } from "@/components/profile-dialog";
import { ApiTokensDialog } from "@/components/api-tokens-dialog";
import type { SpaceNode, FolderNode, ListNode } from "@/lib/queries";
import { Avatar } from "@/components/ui/avatar";
import { openItemSharing } from "@/components/sharing/item-sharing";

export function Sidebar({ onCollapse }: { onCollapse?: () => void }) {
  const { workspace, favorites, currentUser } = useWorkspace();
  const { createSpace } = useHierarchy();
  const [template, setTemplate] = useState<ListTemplateTarget | null>(null);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const favLists = workspace.spaces
    .flatMap((s) => [...s.lists, ...s.folders.flatMap((f) => f.lists)])
    .filter((l) => favorites.includes(l.id));

  return (
    <aside className="flex h-full w-[var(--sidebar-w,260px)] shrink-0 flex-col border-r border-cu-border bg-cu-sidebar text-cu-text">
      {/* Workspace header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button aria-label="Workspace members" onClick={() => router.push("/workspace")} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-cu-hover-strong">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
            style={{ backgroundColor: workspace.color }}
          >
            {workspace.name[0]}
          </span>
          <span className="truncate text-sm font-semibold">{workspace.name}</span>
          <ChevronDown className="ml-auto h-3.5 w-3.5 text-cu-text-tertiary" />
        </button>
        <button
          onClick={onCollapse}
          className="rounded p-1 text-cu-text-tertiary hover:bg-cu-hover-strong hover:text-cu-text"
          title="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <button
          onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
          className="flex w-full items-center gap-2 rounded-md border border-cu-border bg-cu-panel px-2.5 py-1.5 text-[13px] text-cu-text-tertiary hover:border-cu-border-strong"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search</span>
          <kbd className="ml-auto rounded bg-cu-hover px-1.5 py-0.5 text-[10px] text-cu-text-tertiary">⌘K</kbd>
        </button>
      </div>

      {/* Primary nav */}
      <nav className="px-2">
        <NavItem
          icon={<House className="h-4 w-4" />}
          label="Home"
          active={pathname === "/home"}
          onClick={() => router.push("/home")}
        />
        <InboxButton />
        <NavItem icon={<Gauge className="h-4 w-4" />} label="Workload" active={pathname === "/workload"} onClick={() => router.push("/workload")} />
        <NavItem icon={<CalendarDays className="h-4 w-4" />} label="Calendar" active={pathname === "/calendar"} onClick={() => router.push("/calendar")} />
        {workspace.members.find((member) => member.userId === currentUser.id)?.role !== "GUEST" && (
          <NavItem icon={<MessageSquare className="h-4 w-4" />} label="Messages" active={pathname === "/messages"} onClick={() => router.push("/messages")} />
        )}
        {workspace.members.some((member) => member.userId === currentUser.id && (member.role === "OWNER" || member.role === "ADMIN")) && (
          <NavItem icon={<ClipboardList className="h-4 w-4" />} label="Audit log" active={pathname === "/audit"} onClick={() => router.push("/audit")} />
        )}
        <NavItem icon={<ListIcon className="h-4 w-4" />} label="All tasks" active={pathname === "/tasks" || pathname === "/views/workspace"} onClick={() => router.push("/views/workspace")} />
        <NavItem icon={<LayoutGrid className="h-4 w-4" />} label="Dashboards" active={pathname === "/dashboards"} onClick={() => router.push("/dashboards")} />
        <NavItem icon={<FileText className="h-4 w-4" />} label="Docs" active={pathname === "/docs"} onClick={() => router.push("/docs")} />
        <NavItem icon={<Target className="h-4 w-4" />} label="Goals" active={pathname === "/goals"} onClick={() => router.push("/goals")} />
        <NavItem icon={<Trash2 className="h-4 w-4" />} label="Archive and Trash" active={pathname === "/recovery"} onClick={() => router.push("/recovery")} />
      </nav>

      {favLists.length > 0 && (
        <div className="mt-1 px-2">
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-cu-text-tertiary">
            Favorites
          </div>
          {favLists.map((l) => (
            <button
              key={l.id}
              onClick={() => router.push(`/l/${l.id}`)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-cu-text hover:bg-cu-hover-strong"
            >
              <Star className="h-3.5 w-3.5 fill-[#ffcc00] text-[#ffcc00]" />
              <span className="truncate">{l.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mx-3 my-2 border-t border-cu-border" />

      {/* Spaces */}
      <div className="flex items-center justify-between px-4 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-cu-text-tertiary">Spaces</span>
        <button
          onClick={() => setCreatingSpace(true)}
          className="rounded p-0.5 text-cu-text-tertiary hover:bg-cu-hover-strong hover:text-cu-text"
          title="New Space"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-2 pb-3">
        {workspace.spaces.map((space) => (
          <SpaceItem key={space.id} space={space} onTemplate={setTemplate} />
        ))}
        {creatingSpace && (
          <InlineInput
            depth={0}
            placeholder="Space name"
            onSubmit={(name) => {
              createSpace.mutate(name);
              setCreatingSpace(false);
            }}
            onCancel={() => setCreatingSpace(false)}
          />
        )}
      </div>

      {template && <ListTemplatesDialog target={template} onClose={() => setTemplate(null)} />}
      <Link href="/workspace/task-types" className="px-4 py-2 text-xs text-cu-text-secondary hover:text-cu-purple">Task types</Link>
      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-cu-border px-3 py-2">
        <UserSwitcher />
        <div className="ml-auto flex items-center gap-0.5">
          <ThemeToggle />
          <button className="rounded p-1 text-cu-text-tertiary hover:bg-cu-hover-strong hover:text-cu-text">
            <Bell className="h-4 w-4" />
          </button>
          <button aria-label="Open workspace settings" onClick={() => router.push("/workspace")} className="rounded p-1 text-cu-text-tertiary hover:bg-cu-hover-strong hover:text-cu-text">
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function NavItem({
  icon,
  label,
  badge,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-cu-text hover:bg-cu-hover-strong",
        active && "bg-cu-sidebar-active font-medium",
      )}
    >
      <span className="text-cu-text-secondary">{icon}</span>
      <span>{label}</span>
      {badge != null && (
        <span className="ml-auto rounded-full bg-cu-purple px-1.5 py-px text-[10px] font-semibold text-white">{badge}</span>
      )}
    </button>
  );
}

function UserSwitcher() {
  const { currentUser } = useWorkspace();
  const [profileOpen, setProfileOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);

  async function logout() {
    await apiSend("/api/auth/logout", "POST");
    window.location.href = "/login";
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-cu-hover-strong">
          <Avatar user={currentUser} size="md" />
          <span className="truncate text-[13px] font-medium">{currentUser.name}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-50 min-w-[220px] rounded-lg border border-cu-border bg-cu-panel p-1 shadow-lg"
        >
          <DropdownMenu.Item
            onSelect={() => setProfileOpen(true)}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none hover:bg-cu-hover focus:bg-cu-hover"
          >
            <Settings className="h-4 w-4" /> Edit profile
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => setTokensOpen(true)} className="cursor-pointer rounded px-2 py-1.5 text-[13px] outline-none focus:bg-cu-hover">
            API tokens
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={logout}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] text-cu-text-secondary outline-none hover:bg-cu-hover focus:bg-cu-hover"
          >
            <LogOut className="h-4 w-4" /> Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
      {tokensOpen && <ApiTokensDialog onClose={() => setTokensOpen(false)} />}
    </DropdownMenu.Root>
  );
}

function SpaceItem({ space, onTemplate }: { space: SpaceNode; onTemplate: (target: ListTemplateTarget) => void }) {
  const router = useRouter();
  const { createList, createFolder, rename, remove } = useHierarchy();
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState<"list" | "folder" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const hasChildren = space.folders.length > 0 || space.lists.length > 0;

  if (renaming) {
    return (
      <InlineInput
        depth={0}
        initial={space.name}
        leading={
          <span className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-white" style={{ backgroundColor: space.color }}>
            {space.icon ?? space.name[0]}
          </span>
        }
        onSubmit={(name) => {
          rename.mutate({ kind: "spaces", id: space.id, name });
          setRenaming(false);
        }}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  return (
    <div className="select-none">
      <HierarchyDragRow kind="space" id={space.id} name={space.name}>
      <SidebarContext actions={[
        { label: "Space views", run: () => router.push(`/views/space/${space.id}`), readOnly: true },
        { label: "New List", run: () => { setOpen(true); setCreating("list"); } },
        { label: "New Folder", run: () => { setOpen(true); setCreating("folder"); } },
        { label: "New List from template", run: () => onTemplate({ spaceId: space.id }) },
        { label: "Rename space", run: () => setRenaming(true) },
        { label: "Sharing & permissions", run: () => openItemSharing("space", space.id, space.name), readOnly: true },
      ]}><div><Row
        depth={0}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        hasChildren={hasChildren}
        leading={
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white" style={{ backgroundColor: space.color }}>
            {space.icon ?? space.name[0]}
          </span>
        }
        label={space.name}
        bold
        onRename={() => setRenaming(true)}
        onDelete={() => remove.mutate({ kind: "spaces", id: space.id })}
        onSharing={() => openItemSharing("space", space.id, space.name)}
        addMenu={
          <>
            <MenuItem icon={<ListIcon className="h-4 w-4" />} label="Space views" onSelect={() => router.push(`/views/space/${space.id}`)} />
            <MenuItem icon={<ListIcon className="h-4 w-4" />} label="New List" onSelect={() => { setOpen(true); setCreating("list"); }} />
            <MenuItem icon={<FileText className="h-4 w-4" />} label="New List from template" onSelect={() => onTemplate({ spaceId: space.id })} />
            <MenuItem icon={<FolderPlus className="h-4 w-4" />} label="New Folder" onSelect={() => { setOpen(true); setCreating("folder"); }} />
          </>
        }
      /></div></SidebarContext></HierarchyDragRow>
      {open && (
        <div>
          {space.folders.filter((folder) => !folder.parentId).map((folder) => (
            <FolderItem key={folder.id} folder={folder} folders={space.folders} depth={1} onTemplate={onTemplate} />
          ))}
          {space.lists.map((list) => (
            <ListItemRow key={list.id} list={list} depth={1} onTemplate={onTemplate} />
          ))}
          {creating === "list" && (
            <InlineInput
              depth={1}
              placeholder="List name"
              leading={<ListIcon className="h-4 w-4 text-cu-text-secondary" />}
              onSubmit={async (name) => {
                const l = await createList.mutateAsync({ spaceId: space.id, name });
                setCreating(null);
                router.push(`/l/${l.id}`);
              }}
              onCancel={() => setCreating(null)}
            />
          )}
          {creating === "folder" && (
            <InlineInput
              depth={1}
              placeholder="Folder name"
              leading={<FolderIcon className="h-4 w-4 text-cu-text-secondary" />}
              onSubmit={(name) => {
                createFolder.mutate({ spaceId: space.id, name });
                setCreating(null);
              }}
              onCancel={() => setCreating(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FolderItem({ folder, folders, depth, onTemplate }: { folder: FolderNode; folders: FolderNode[]; depth: number; onTemplate: (target: ListTemplateTarget) => void }) {
  const router = useRouter();
  const { createList, createFolder, rename, remove } = useHierarchy();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<"list" | "folder" | null>(null);
  const children = folders.filter((child) => child.parentId === folder.id);
  const [renaming, setRenaming] = useState(false);

  if (renaming) {
    return (
      <InlineInput
        depth={depth}
        initial={folder.name}
        leading={<FolderIcon className="h-4 w-4 text-cu-text-secondary" />}
        onSubmit={(name) => {
          rename.mutate({ kind: "folders", id: folder.id, name });
          setRenaming(false);
        }}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  return (
    <div>
      <HierarchyDragRow kind="folder" id={folder.id} name={folder.name}>
      <SidebarContext actions={[
        { label: "Folder views", run: () => router.push(`/views/folder/${folder.id}`), readOnly: true },
        { label: "New List", run: () => { setOpen(true); setCreating("list"); } },
        { label: "New List from template", run: () => onTemplate({ spaceId: folder.spaceId, folderId: folder.id }) },
        ...(depth < 8 ? [{ label: "New subfolder", run: () => { setOpen(true); setCreating("folder"); } }] : []),
        { label: "Rename folder", run: () => setRenaming(true) },
        { label: "Sharing & permissions", run: () => openItemSharing("folder", folder.id, folder.name), readOnly: true },
      ]}><div><Row
        depth={depth}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        hasChildren={folder.lists.length > 0 || children.length > 0}
        leading={open ? <FolderOpen className="h-4 w-4 text-cu-text-secondary" /> : <FolderIcon className="h-4 w-4 text-cu-text-secondary" />}
        label={folder.name}
        onRename={() => setRenaming(true)}
        onDelete={() => remove.mutate({ kind: "folders", id: folder.id })}
        onSharing={() => openItemSharing("folder", folder.id, folder.name)}
        addMenu={<>
          <MenuItem icon={<ListIcon className="h-4 w-4" />} label="Folder views" onSelect={() => router.push(`/views/folder/${folder.id}`)} />
          {depth < 8 && <MenuItem icon={<FolderPlus className="h-4 w-4" />} label="New subfolder" onSelect={() => { setOpen(true); setCreating("folder"); }} />}
          <MenuItem icon={<ListIcon className="h-4 w-4" />} label="New List" onSelect={() => { setOpen(true); setCreating("list"); }} />
          <MenuItem icon={<FileText className="h-4 w-4" />} label="New List from template" onSelect={() => onTemplate({ spaceId: folder.spaceId, folderId: folder.id })} />
        </>}
      /></div></SidebarContext></HierarchyDragRow>
      {open && (
        <>
          {children.map((child) => <FolderItem key={child.id} folder={child} folders={folders} depth={depth + 1} onTemplate={onTemplate} />)}
          {folder.lists.map((list) => (
            <ListItemRow key={list.id} list={list} depth={depth + 1} onTemplate={onTemplate} />
          ))}
          {creating === "folder" && <InlineInput depth={depth + 1} placeholder="Subfolder name"
            onSubmit={(name) => createFolder.mutate({ spaceId: folder.spaceId, parentId: folder.id, name }, { onSuccess: () => setCreating(null) })}
            onCancel={() => setCreating(null)} />}
          {createFolder.isError && <p role="alert" className="pl-6 text-xs text-cu-urgent">Could not create the subfolder.</p>}
          {creating === "list" && (
            <InlineInput
              depth={depth + 1}
              placeholder="List name"
              leading={<ListIcon className="h-4 w-4 text-cu-text-secondary" />}
              onSubmit={async (name) => {
                const l = await createList.mutateAsync({ spaceId: folder.spaceId, folderId: folder.id, name });
                setCreating(null);
                router.push(`/l/${l.id}`);
              }}
              onCancel={() => setCreating(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function ListItemRow({ list, depth, onTemplate }: { list: ListNode; depth: number; onTemplate: (target: ListTemplateTarget) => void }) {
  const params = useParams();
  const router = useRouter();
  const { rename } = useHierarchy();
  const { currentUser, workspace } = useWorkspace();
  const canWrite = workspace.members.some((member) => member.userId === currentUser.id && member.role !== "GUEST");
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: () => apiSend(`/api/lists/${list.id}`, "PATCH", { archived: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bootstrap"] });
      if (active) router.push("/recovery?mode=lists");
    },
  });
  const [renaming, setRenaming] = useState(false);
  const active = params?.listId === list.id;

  if (renaming) {
    return (
      <InlineInput
        depth={depth}
        initial={list.name}
        leading={<ListIcon className="h-4 w-4 text-cu-text-secondary" />}
        onSubmit={(name) => {
          rename.mutate({ kind: "lists", id: list.id, name });
          setRenaming(false);
        }}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  return (
    <HierarchyDragRow kind="list" id={list.id} name={list.name}>
    <SidebarContext actions={[
      { label: "Open list", run: () => router.push(`/l/${list.id}`), readOnly: true },
      { label: "Rename list", run: () => setRenaming(true) },
      { label: "Task statuses", run: () => router.push(`/l/${list.id}?settings=statuses`) },
      { label: "Save or update list template", run: () => onTemplate({ sourceListId: list.id }) },
      { label: "Archive list", run: () => archive.mutate() },
      { label: "Sharing & permissions", run: () => openItemSharing("list", list.id, list.name), readOnly: true },
    ]}><div className={cn(
        "group flex items-center gap-2 rounded-md py-1.5 pr-2 text-[13px]",
        active ? "bg-cu-sidebar-active font-medium text-cu-purple-dark" : "text-cu-text hover:bg-cu-hover-strong",
      )}
      style={{ paddingLeft: depth * 14 + 8 }}
    >
      <Link href={`/l/${list.id}`} className="flex min-w-0 flex-1 items-center gap-2"
        onDoubleClick={(event) => { if (canWrite) { event.preventDefault(); setRenaming(true); } }}>
        <ListIcon
          className={cn("h-4 w-4 shrink-0", active ? "text-cu-purple" : "text-cu-text-secondary")}
          style={list.color && !active ? { color: list.color } : undefined}
        />
        <span className="truncate">{list.name}</span>
      </Link>
      <span className="ml-auto flex items-center gap-1">
        <span className="hidden text-[11px] text-cu-text-tertiary group-hover:inline">{list._count.tasks}</span>
        <RowMenu label={`Options for ${list.name}`} onRename={canWrite ? () => setRenaming(true) : undefined} onArchive={canWrite ? () => archive.mutate() : undefined} onTemplate={canWrite ? () => onTemplate({ sourceListId: list.id }) : undefined} onSharing={() => openItemSharing("list", list.id, list.name)} />
        {archive.isError && <span role="alert" className="text-xs text-cu-urgent">Archive failed</span>}
      </span>
    </div></SidebarContext></HierarchyDragRow>
  );
}

function SidebarContext({ actions, children }: { actions: { label: string; run: () => void; readOnly?: boolean }[]; children: ReactElement }) {
  const { workspace, currentUser } = useWorkspace();
  const canWrite = workspace.members.some((member) => member.userId === currentUser.id && member.role !== "GUEST");
  const available = actions.filter((action) => action.readOnly || canWrite);
  if (!available.length) return children;
  return <ContextMenu.Root>
    <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Content className="z-[60] min-w-44 rounded border border-cu-border bg-cu-panel p-1 shadow-lg">
      {available.map(({ label, run }) => <ContextMenu.Item key={label} onSelect={run}
        className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none focus:bg-cu-hover">{label}</ContextMenu.Item>)}
    </ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>;
}

function Row({
  depth,
  open,
  onToggle,
  hasChildren,
  leading,
  label,
  bold,
  onRename,
  onDelete,
  onSharing,
  onAdd,
  addMenu,
}: {
  depth: number;
  open: boolean;
  onToggle: () => void;
  hasChildren: boolean;
  leading: React.ReactNode;
  label: string;
  bold?: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  onSharing?: () => void;
  onAdd?: () => void;
  addMenu?: React.ReactNode;
}) {
  return (
    <div
      className="group flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-[13px] text-cu-text hover:bg-cu-hover-strong"
      style={{ paddingLeft: depth * 14 + 4 }}
    >
      <button onClick={onToggle} className="flex h-4 w-4 items-center justify-center text-cu-text-tertiary">
        {hasChildren ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
      </button>
      <button aria-label={label} onClick={onToggle} onDoubleClick={onRename} className="flex min-w-0 flex-1 items-center gap-1.5">
        {leading}
        <span className={cn("truncate", bold && "font-semibold")}>{label}</span>
      </button>
      {(onRename || onDelete || onSharing) && <RowMenu onRename={onRename} onDelete={onDelete} onSharing={onSharing} />}
      {addMenu ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="hidden rounded p-0.5 text-cu-text-tertiary hover:bg-cu-hover group-hover:block" title="Add">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content sideOffset={4} align="end" className="z-50 min-w-[160px] rounded-lg border border-cu-border bg-cu-panel p-1 shadow-lg">
              {addMenu}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : onAdd ? (
        <button onClick={onAdd} className="hidden rounded p-0.5 text-cu-text-tertiary hover:bg-cu-hover group-hover:block" title="New List">
          <Plus className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function RowMenu({ label = "Options", onRename, onDelete, onArchive, onTemplate, onSharing }: { label?: string; onRename?: () => void; onDelete?: () => void; onArchive?: () => void; onTemplate?: () => void; onSharing?: () => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label={label}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="rounded p-0.5 text-cu-text-tertiary opacity-0 hover:bg-cu-hover focus:opacity-100 group-hover:opacity-100"
        >
          <Ellipsis className="h-3.5 w-3.5" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={4} align="end" className="z-50 min-w-[150px] rounded-lg border border-cu-border bg-cu-panel p-1 shadow-lg">
          {onRename && <MenuItem icon={<Pencil className="h-4 w-4" />} label="Rename" onSelect={onRename} />}
          {onSharing && <MenuItem icon={<Settings className="h-4 w-4" />} label="Sharing & permissions" onSelect={onSharing} />}
          {onTemplate && <MenuItem icon={<FileText className="h-4 w-4" />} label="Save or update list template" onSelect={onTemplate} />}
          {onArchive && <MenuItem icon={<Archive className="h-4 w-4" />} label="Archive list" onSelect={onArchive} />}
          {onDelete && <MenuItem icon={<Trash2 className="h-4 w-4" />} label="Delete" onSelect={onDelete} danger />}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuItem({
  icon,
  label,
  onSelect,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none hover:bg-cu-hover focus:bg-cu-hover",
        danger && "text-cu-urgent",
      )}
    >
      {icon}
      {label}
    </DropdownMenu.Item>
  );
}

function InlineInput({
  depth,
  placeholder,
  initial,
  leading,
  onSubmit,
  onCancel,
}: {
  depth: number;
  placeholder?: string;
  initial?: string;
  leading?: React.ReactNode;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial ?? "");
  return (
    <div className="flex items-center gap-1.5 rounded-md py-1 pr-2" style={{ paddingLeft: depth * 14 + 22 }}>
      {leading}
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim()) onSubmit(v.trim());
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => (v.trim() ? onSubmit(v.trim()) : onCancel())}
        placeholder={placeholder}
        className="w-full rounded border border-cu-purple bg-cu-panel px-1.5 py-0.5 text-[13px] outline-none"
      />
    </div>
  );
}
