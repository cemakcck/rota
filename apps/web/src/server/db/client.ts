import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { findUp } from "../files";
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

/**
 * Retries `fn` on connection-class errors only, with exponential backoff.
 * A retried write may rarely be applied twice (the connection can drop after the server committed
 * but before the reply arrived), so writes should be idempotent, and transaction callbacks must
 * have no side effects outside the database.
 */
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

type Thenable = { execute: () => Promise<unknown> };
const isQuery = (v: unknown): v is Thenable =>
  typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function" && typeof (v as Thenable).execute === "function";

/** Properties that hold drizzle internals or the driver, not queries. */
const PASS_THROUGH = new Set(["$client", "_", "session", "dialect", "$cache"]);

/**
 * Wraps a drizzle object so every way of running a query goes through withDbRetry:
 * - awaiting a builder (`then`, `catch`, `finally` all go through one retried `execute()`),
 * - an explicit `execute()` on a builder, a prepared statement or `db` itself,
 * - relational queries (`db.query.x.findFirst()`), reached by wrapping object properties,
 * - `transaction`, which retries as a whole (a dropped connection rolls it back).
 * Whatever a method returns is wrapped again, so any chain length is covered. Because the wrapper
 * is on the db itself, Better Auth's adapter gets the same protection.
 */
function retrying<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value: unknown = Reflect.get(obj, prop, obj);
      if ((prop === "then" || prop === "catch" || prop === "finally") && isQuery(obj)) {
        const run = withDbRetry(() => obj.execute());
        return (run[prop] as (...a: unknown[]) => unknown).bind(run);
      }
      if (typeof value === "function") {
        const retried = prop === "execute" || prop === "transaction";
        return (...args: unknown[]) => {
          if (retried) return withDbRetry(() => value.apply(obj, args) as Promise<unknown>);
          const result: unknown = value.apply(obj, args);
          return typeof result === "object" && result !== null ? retrying(result) : result;
        };
      }
      if (typeof value === "object" && value !== null && typeof prop === "string" && !PASS_THROUGH.has(prop)) {
        return retrying(value);
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
  // apps/web/drizzle, found from here whether this runs as source or bundled into dist/migrate.mjs.
  const migrationsFolder = await findUp("drizzle", import.meta.url);
  const client = postgres(url ?? process.env.DATABASE_URL ?? DEFAULT_URL, { max: 1, onnotice: () => {} });
  try {
    await withDbRetry(() => migrate(drizzle(client), { migrationsFolder }));
  } finally {
    await client.end();
  }
}

// One pool per process, even across Next.js dev-mode module reloads.
const g = globalThis as unknown as { __rotaDb?: ReturnType<typeof createDb> };
g.__rotaDb ??= createDb();

export const db: Db = g.__rotaDb.db;
