import { sql } from "drizzle-orm";
import postgres from "postgres";
import { expect, it } from "vitest";
import { db } from "@/server/db/client";
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
