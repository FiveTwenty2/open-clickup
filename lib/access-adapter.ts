import { PrismaPg } from "@prisma/adapter-pg";
import { accessContext } from "@/lib/access-context";

type PgAdapter = Awaited<ReturnType<PrismaPg["connect"]>>;
type PgTransaction = Awaited<ReturnType<PgAdapter["startTransaction"]>>;
type SqlQuery = Parameters<PgAdapter["queryRaw"]>[0];

const statement = (sql: string): SqlQuery => ({ sql, args: [], argTypes: [] });

async function closeTransaction(tx: PgTransaction, commit: boolean) {
  try {
    await tx.executeRaw(statement(commit ? "COMMIT" : "ROLLBACK"));
  } finally {
    await (commit ? tx.commit() : tx.rollback());
  }
}

export class AccessPrismaPg extends PrismaPg {
  override async connect(): Promise<PgAdapter> {
    const adapter = await super.connect();
    const startScoped = async (...args: Parameters<PgAdapter["startTransaction"]>) => {
      const scope = accessContext();
      const tx = await adapter.startTransaction(...args);
      if (!scope) return tx;
      try {
        await tx.executeRaw(statement("SET LOCAL ROLE open_clickup_request"));
        const values = [scope.userId ?? "", scope.workspaceId ?? "", scope.publicKind ?? "", scope.publicKey ?? ""];
        await tx.queryRaw({
          sql: "SELECT set_config('open_clickup.user_id', $1, true), set_config('open_clickup.workspace_id', $2, true), set_config('open_clickup.public_kind', $3, true), set_config('open_clickup.public_key', $4, true)",
          args: values,
          argTypes: values.map(() => ({ scalarType: "string", dbType: "TEXT", arity: "scalar" })),
        });
        return tx;
      } catch (error) {
        await closeTransaction(tx, false);
        throw error;
      }
    };

    async function scopedQuery<M extends "queryRaw" | "executeRaw">(method: M, query: SqlQuery) {
      if (!accessContext()) return adapter[method](query);
      const tx = await startScoped();
      let result: Awaited<ReturnType<PgTransaction[M]>>;
      try {
        result = await tx[method](query) as Awaited<ReturnType<PgTransaction[M]>>;
      } catch (error) {
        await closeTransaction(tx, false);
        throw error;
      }
      await closeTransaction(tx, true);
      return result;
    }

    return new Proxy(adapter, {
      get(target, key, receiver) {
        if (key === "startTransaction") return startScoped;
        if (key === "queryRaw") return (query: SqlQuery) => scopedQuery("queryRaw", query);
        if (key === "executeRaw") return (query: SqlQuery) => scopedQuery("executeRaw", query);
        const value = Reflect.get(target, key, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
}
