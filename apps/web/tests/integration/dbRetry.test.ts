import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, db } from "@/server/db/client";
import { user } from "@/server/db/schema";

it("a query survives its pooled connection being killed (Neon waking up)", async () => {
  await db.execute(sql`select 1`); // make sure the pool holds a live connection
  const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`;
  } finally {
    await admin.end();
  }
  await expect(db.select().from(user).limit(1)).resolves.toBeInstanceOf(Array);
  await expect(db.transaction((tx) => tx.execute(sql`select 1`))).resolves.toBeDefined();
});

// A port nothing listens on: every attempt is ECONNREFUSED, so a retried query takes the full
// backoff (250 + 500 + 1000 ms) before giving up, while an unwrapped one fails at once.
describe("every query form is retried", () => {
  const dead = createDb("postgres://rota:rota@127.0.0.1:1/none");
  afterAll(() => dead.client.end({ timeout: 0 }));

  async function elapsed(run: () => Promise<unknown>) {
    const t = Date.now();
    await run().catch(() => undefined);
    return Date.now() - t;
  }
  const forms: [string, () => Promise<unknown>][] = [
    ["awaited select", async () => await dead.db.select().from(user).limit(1)],
    ["select().execute()", () => dead.db.select().from(user).limit(1).execute()],
    ["select().catch()", () => dead.db.select().from(user).limit(1).catch(() => undefined) as Promise<unknown>],
    ["db.query.x.findFirst()", async () => await dead.db.query.user.findFirst()],
    ["db.query.x.findFirst().execute()", () => dead.db.query.user.findFirst().execute()],
    ["prepare().execute()", () => dead.db.select().from(user).prepare("retry_probe").execute()],
    ["db.execute()", () => dead.db.execute(sql`select 1`)],
  ];
  it.each(forms)("%s", async (_name, run) => {
    expect(await elapsed(run)).toBeGreaterThanOrEqual(1500);
  }, 10_000);
});
