export const VIEW_KINDS = ["LIST", "BOARD", "CALENDAR", "GANTT", "TABLE", "TIMELINE", "TEAM", "MIND_MAP", "MAP", "EMBED"] as const;
export type ViewKind = typeof VIEW_KINDS[number];
export const VIEW_LABELS: Record<ViewKind, string> = {
  LIST: "List", BOARD: "Board", CALENDAR: "Calendar", GANTT: "Gantt", TABLE: "Table",
  TIMELINE: "Timeline", TEAM: "Team", MIND_MAP: "Mind Map", MAP: "Map", EMBED: "Embed",
};

export const SPECIAL_VIEW_KINDS = ["TIMELINE", "TEAM", "MIND_MAP", "MAP", "EMBED"] as const;
export function isSpecialView(kind: ViewKind): kind is typeof SPECIAL_VIEW_KINDS[number] {
  return (SPECIAL_VIEW_KINDS as readonly ViewKind[]).includes(kind);
}

export function embedAddress(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch { /* Invalid URL. */ }
  return null;
}
