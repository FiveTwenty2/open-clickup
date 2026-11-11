export function isCompletedStatus(type: string) {
  return type === "DONE" || type === "CLOSED";
}

export function quickStatus<T extends { type: string }>(current: T, statuses: T[]) {
  if (isCompletedStatus(current.type)) {
    return statuses.find((status) => status.type === "NOT_STARTED")
      ?? statuses.find((status) => !isCompletedStatus(status.type));
  }
  return statuses.find((status) => status.type === "CLOSED")
    ?? statuses.find((status) => status.type === "DONE");
}
