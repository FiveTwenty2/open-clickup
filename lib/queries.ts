import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { visibleSecondaryListIds, visibleSecondaryTaskIds } from "@/lib/task-placements";
import { sameStatusDefinition } from "@/lib/task-status";

// ----------------------------------------------------------------------------
// Reusable include shapes (single source of truth for API <-> client types)
// ----------------------------------------------------------------------------

export const commentFileSelect = { id: true, name: true, size: true } as const;

export const userSelect = {
  id: true,
  name: true,
  email: true,
  color: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

export const taskInclude = {
  taskType: { select: { id: true, name: true, color: true } },
  status: true,
  assignees: { include: { user: { select: userSelect } } },
  tags: { include: { tag: true } },
  customFieldValues: true,
  subtasks: {
    where: { archived: false, deletedAt: null },
    orderBy: { position: "asc" },
    include: {
      status: true,
      assignees: { include: { user: { select: userSelect } } },
    },
  },
  _count: { select: { comments: true, subtasks: { where: { archived: false, deletedAt: null } }, checklists: true } },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }> & { homeStatuses?: StatusModel[] };
export type SubtaskWithRelations = TaskWithRelations["subtasks"][number];
export type UserLite = Prisma.UserGetPayload<{ select: typeof userSelect }>;

// ----------------------------------------------------------------------------
// Workspace tree (for sidebar)
// ----------------------------------------------------------------------------

export async function getWorkspaceTree(workspaceId: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId },
    include: {
      members: { include: { user: { select: userSelect } } },
      spaces: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        include: {
          folders: {
            orderBy: [{ position: "asc" }, { id: "asc" }],
            include: {
              lists: {
                where: { archivedAt: null },
                orderBy: { position: "asc" },
                include: { _count: { select: { tasks: { where: { archived: false, deletedAt: null, parentId: null } } } } },
              },
            },
          },
          lists: {
            where: { folderId: null, archivedAt: null },
            orderBy: { position: "asc" },
            include: { _count: { select: { tasks: { where: { archived: false, deletedAt: null, parentId: null } } } } },
          },
        },
      },
    },
  });
  return workspace;
}

export type WorkspaceTree = NonNullable<Awaited<ReturnType<typeof getWorkspaceTree>>>;
export type SpaceNode = WorkspaceTree["spaces"][number];
export type FolderNode = SpaceNode["folders"][number];
export type ListNode = SpaceNode["lists"][number];

// ----------------------------------------------------------------------------
// List detail (statuses, custom fields, views, tasks)
// ----------------------------------------------------------------------------

export async function getListData(listId: string, viewerId: string) {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    include: {
      space: { select: { id: true, name: true, color: true, icon: true, workspaceId: true } },
      folder: { select: { id: true, name: true } },
      statuses: { orderBy: { position: "asc" } },
      customFields: {
        orderBy: { position: "asc" },
        include: { options: { orderBy: { position: "asc" } } },
      },
      views: {
        where: { OR: [{ privateOwnerId: null }, { privateOwnerId: viewerId }, { readers: { some: { userId: viewerId } } }] },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!list) return null;

  const secondaryIds = list.archivedAt ? [] : await visibleSecondaryTaskIds(prisma, listId);
  const allTasks = await prisma.task.findMany({
    where: {
      archived: false, deletedAt: null,
      OR: [{ listId }, { id: { in: secondaryIds } }],
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    include: {
      ...taskInclude,
      listMemberships: { where: { listId }, select: { position: true } },
      list: { select: { statuses: { orderBy: { position: "asc" } } } },
    },
  });

  const visibleIds = new Set(allTasks.map((task) => task.id));
  const displayed = allTasks.map(({ listMemberships, list: home, ...task }) => {
    if (task.listId === listId) return { ...task, homeStatuses: undefined };
    const matching = list.statuses.find((status) => sameStatusDefinition(status, task.status));
    return {
      ...task,
      homeStatuses: home.statuses,
      statusId: matching?.id ?? task.statusId,
      position: listMemberships[0]?.position ?? task.position,
      parentId: task.parentId && visibleIds.has(task.parentId) ? task.parentId : null,
    };
  }).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const tasks = displayed.filter((task) => !task.parentId);

  // dependency edges between visible tasks (for Gantt arrows)
  const taskIds = tasks.map((t) => t.id);
  const dependencies = taskIds.length
    ? await prisma.taskDependency.findMany({
        where: { blockerId: { in: taskIds }, blockedId: { in: taskIds } },
        select: { id: true, blockerId: true, blockedId: true },
      })
    : [];

  return { list, tasks, allTasks: displayed, dependencies };
}

export type ListData = NonNullable<Awaited<ReturnType<typeof getListData>>>;
export type ListWithMeta = ListData["list"];
export type StatusModel = ListWithMeta["statuses"][number];
export type CustomFieldWithOptions = ListWithMeta["customFields"][number];

// ----------------------------------------------------------------------------
// Task detail (full, for the task modal)
// ----------------------------------------------------------------------------

export async function getTaskDetail(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      ...taskInclude,
      createdBy: { select: userSelect },
      watchers: { include: { user: { select: userSelect } } },
      attachments: { orderBy: { createdAt: "desc" } },
      timeEntries: {
        orderBy: { startedAt: "desc" },
        include: { user: { select: userSelect } },
      },
      blockedBy: {
        include: {
          blocker: {
            select: { id: true, name: true, listId: true, status: { select: { name: true, color: true, type: true } } },
          },
        },
      },
      blocking: {
        include: {
          blocked: {
            select: { id: true, name: true, listId: true, status: { select: { name: true, color: true, type: true } } },
          },
        },
      },
      checklists: {
        orderBy: { position: "asc" },
        include: { items: { orderBy: { position: "asc" } } },
      },
      comments: {
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: userSelect },
          reactions: true,
          files: { select: commentFileSelect },
        },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { user: { select: userSelect } },
      },
      list: {
        select: {
          id: true,
          name: true,
          spaceId: true,
          statuses: { orderBy: { position: "asc" } },
          customFields: {
            orderBy: { position: "asc" },
            include: { options: { orderBy: { position: "asc" } } },
          },
        },
      },
    },
  });
  if (!task) return null;
  const secondaryIds = await visibleSecondaryListIds(prisma, taskId);
  const additionalLists = secondaryIds.length ? await prisma.list.findMany({
    where: { id: { in: secondaryIds } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true, name: true,
      customFields: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } },
    },
  }) : [];
  return { ...task, additionalLists };
}

export type TaskDetail = NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>;
