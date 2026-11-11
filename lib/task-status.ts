export function isCompletedStatus(type: string) {
  return type === "DONE" || type === "CLOSED";
}

type StatusDefinition = { name: string; type: string };

export function sameStatusDefinition(a: StatusDefinition, b: StatusDefinition) {
  return a.type === b.type && a.name.toLowerCase() === b.name.toLowerCase();
}

export function equivalentStatus<T extends StatusDefinition>(statuses: T[], selected: StatusDefinition) {
  return statuses.find((status) => sameStatusDefinition(status, selected))
    ?? statuses.find((status) => status.type === selected.type)
    ?? statuses.find((status) => isCompletedStatus(status.type) === isCompletedStatus(selected.type));
}

export function quickStatus<T extends { type: string }>(current: T, statuses: T[]) {
  if (isCompletedStatus(current.type)) {
    return statuses.find((status) => status.type === "NOT_STARTED")
      ?? statuses.find((status) => !isCompletedStatus(status.type));
  }
  return statuses.find((status) => status.type === "CLOSED")
    ?? statuses.find((status) => status.type === "DONE");
}
