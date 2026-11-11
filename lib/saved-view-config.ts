import { z } from "zod";
import { EMPTY_VIEW_STATE } from "@/lib/view-state";
import { embedAddress } from "@/lib/view-kind";

export const savedViewConfig = z.object({
  filters: z.object({
    priorities: z.array(z.enum(["URGENT", "HIGH", "NORMAL", "LOW"])).default([]),
    assignees: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    completion: z.enum(["open", "closed", "all"]).optional(),
    due: z.enum(["overdue", "week", "none", "all"]).optional(),
    assignment: z.enum(["unassigned", "all"]).optional(),
    recurrence: z.enum(["recurring", "all"]).optional(),
  }).default(EMPTY_VIEW_STATE.filters),
  sort: z.object({ field: z.enum(["priority", "dueDate", "name", "created"]).nullable(), dir: z.enum(["asc", "desc"]) }).default(EMPTY_VIEW_STATE.sort),
  groupBy: z.enum(["none", "status", "priority", "assignee"]).default("status"),
  subtasks: z.enum(["collapsed", "expanded", "separate"]).optional(),
  statusIds: z.array(z.string()).optional(),
  hideClosedSubtasks: z.boolean().optional(),
  embedUrl: z.string().max(2000).refine((url) => !!embedAddress(url), "Enter a valid HTTPS address").nullable().optional(),
  mindMap: z.object({
    mode: z.enum(["tasks", "freeform"]),
    nodes: z.array(z.object({ id: z.uuid(), parentId: z.uuid().nullable(), label: z.string().trim().min(1).max(160) })).max(200)
      .refine((nodes) => {
        const seen = new Set<string>();
        for (const node of nodes) {
          if (seen.has(node.id) || (node.parentId && !seen.has(node.parentId))) return false;
          seen.add(node.id);
        }
        return true;
      }, "Each node needs a unique ID and an earlier parent"),
  }).optional(),
});

export type SavedViewConfig = z.output<typeof savedViewConfig>;
