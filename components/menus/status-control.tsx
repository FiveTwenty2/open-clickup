"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatusModel } from "@/lib/queries";
import { isCompletedStatus, quickStatus } from "@/lib/task-status";

/** ClickUp-style status circle: outline (todo), filled ring (active), check (done). */
export function StatusCircle({
  status,
  size = 16,
  className,
}: {
  status: Pick<StatusModel, "color" | "type">;
  size?: number;
  className?: string;
}) {
  const done = isCompletedStatus(status.type);
  if (done) {
    return (
      <span
        className={cn("inline-flex items-center justify-center rounded-full", className)}
        style={{ width: size, height: size, backgroundColor: status.color }}
      >
        <Check className="text-white" style={{ width: size * 0.62, height: size * 0.62 }} strokeWidth={3} />
      </span>
    );
  }
  const active = status.type === "ACTIVE";
  return (
    <span
      className={cn("inline-block rounded-full", className)}
      style={{
        width: size,
        height: size,
        border: `2px solid ${status.color}`,
        background: active
          ? `conic-gradient(${status.color} 50%, transparent 0)`
          : "transparent",
      }}
    />
  );
}

export function StatusControl({
  current,
  statuses,
  onChange,
  variant = "circle",
  taskName,
}: {
  current: StatusModel;
  statuses: StatusModel[];
  onChange: (statusId: string) => void;
  variant?: "circle" | "badge";
  taskName?: string;
}) {
  const target = quickStatus(current, statuses);
  const label = taskName ? `Change status for ${taskName}` : "Change status";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {variant === "circle" ? (
          <button
            className="flex items-center justify-center rounded-full hover:scale-110 transition-transform"
            onClick={(e) => e.stopPropagation()}
            aria-label={label}
            title={`Change status: ${current.name}`}
          >
            <StatusCircle status={current} />
          </button>
        ) : (
          <button
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide outline-none hover:opacity-90"
            style={{ color: current.color, backgroundColor: `${current.color}1f` }}
          >
            <StatusCircle status={current} size={12} />
            {current.name}
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={6}
          align="start"
          className="z-50 min-w-[200px] rounded-lg border border-cu-border bg-cu-panel p-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-cu-text-tertiary">
            Status
          </div>
          {target && (
            <DropdownMenu.Item
              onSelect={() => onChange(target.id)}
              className="cursor-pointer rounded px-2 py-1.5 text-[13px] font-medium text-cu-purple outline-none focus:bg-cu-hover"
            >
              {isCompletedStatus(current.type) ? "Reopen task" : "Close task"}
            </DropdownMenu.Item>
          )}
          {statuses.map((s) => (
            <DropdownMenu.Item
              key={s.id}
              onSelect={() => onChange(s.id)}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none hover:bg-cu-hover focus:bg-cu-hover"
            >
              <StatusCircle status={s} size={14} />
              <span className="font-medium uppercase text-[11px] tracking-wide" style={{ color: s.color }}>
                {s.name}
              </span>
              {s.id === current.id && <Check className="ml-auto h-3.5 w-3.5 text-cu-purple" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
