import { AsyncLocalStorage } from "node:async_hooks";

type Scope = { userId?: string; workspaceId?: string; publicKind?: "task" | "view" | "form"; publicKey?: string };
const globalContext = globalThis as typeof globalThis & { openClickupAccess?: AsyncLocalStorage<Scope> };
const context = globalContext.openClickupAccess ??= new AsyncLocalStorage<Scope>();

export function withAccessContext<T>(fn: () => T): T {
  return context.run({}, fn);
}

export function accessContext() {
  return context.getStore();
}

export function setAccessActor(userId: string, workspaceId: string): void {
  const scope = accessContext();
  if (scope) Object.assign(scope, { userId, workspaceId, publicKind: undefined, publicKey: undefined });
}

export function setPublicAccess(publicKind: NonNullable<Scope["publicKind"]>, publicKey: string): void {
  const scope = accessContext();
  if (!scope) throw new Error("Missing request access context");
  Object.assign(scope, { userId: undefined, workspaceId: undefined, publicKind, publicKey });
}
