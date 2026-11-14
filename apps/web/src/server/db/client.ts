import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

const DEFAULT_URL = "postgres://rota:rota@localhost:5434/rota";

/** Errors that mean "the connection went away", e.g. Neon waking from sleep. Nothing else is retried. */
const RETRYABLE = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "CONNECTION_ENDED",
  "CONNECTION_CLOSED",
  "57P01",
  "08006",
  "08001",
]);

function isConnectionError(err: unknown): boolean {
  // Drizzle wraps driver errors ("Failed query") with the original as `cause`.
  for (let e = err, depth = 0; e && typeof e === "object" && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && RETRYABLE.has(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  { attempts = 4, baseDelayMs = 250 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isConnectionError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
}

type Thenable = { then: unknown; execute: () => Promise<unknown> };
const isQuery = (v: unknown): v is Thenable =>
  typeof v === "object" && v !== null && typeof (v as Thenable).then === "function" && typeof (v as Thenable).execute === "function";

/**
 * Wraps a drizzle object so every query it runs goes through withDbRetry. Query builders are
 * thenables whose `then` calls `execute()`; the proxy replaces `then` with a retried `execute()`
 * and re-wraps whatever a builder method returns, so `db.select().from(t).where(...)` is covered
 * however long the chain. `transaction` retries as a whole (a dropped connection rolls it back).
 * Because the wrapper is on the db itself, Better Auth's adapter gets the same protection.
 */
function retrying<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value: unknown = Reflect.get(obj, prop, obj);
      if (prop === "then" && isQuery(obj)) {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          withDbRetry(() => obj.execute()).then(resolve, reject);
      }
      if (prop === "transaction" && typeof value === "function") {
        return (...args: unknown[]) => withDbRetry(() => value.apply(obj, args) as Promise<unknown>);
      }
      if (prop === "query" && typeof value === "object" && value !== null) return retrying(value);
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          const result: unknown = value.apply(obj, args);
          return typeof result === "object" && result !== null ? retrying(result) : result;
        };
      }
      return value;
    },
  });
}

export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_URL) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const raw = drizzle(client, { schema });
  return { db: retrying(raw), client };
}

export type Db = ReturnType<typeof createDb>["db"];

export async function migrateDb(url?: string): Promise<void> {
  const client = postgres(url ?? process.env.DATABASE_URL ?? DEFAULT_URL, { max: 1, onnotice: () => {} });
  try {
    await withDbRetry(() =>
      migrate(drizzle(client), { migrationsFolder: path.join(import.meta.dirname, "../../../drizzle") }),
    );
  } finally {
    await client.end();
  }
}

// One pool per process, even across Next.js dev-mode module reloads.
const g = globalThis as unknown as { __rotaDb?: ReturnType<typeof createDb> };
g.__rotaDb ??= createDb();

export const db: Db = g.__rotaDb.db;
