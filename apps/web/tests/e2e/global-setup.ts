import postgres from "postgres";
import { migrateDb } from "../../src/server/db/client";
import { E2E_DATABASE_URL } from "./env";

/** Creates and migrates the e2e database, and forgets earlier runs' rate limits (sign-ups and demos per IP per day). */
export default async function setup() {
  const name = new URL(E2E_DATABASE_URL).pathname.slice(1);
  const adminUrl = new URL(E2E_DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    const [row] = await admin`SELECT 1 AS ok FROM pg_database WHERE datname = ${name}`;
    if (!row) await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  await migrateDb(E2E_DATABASE_URL);
  const db = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await db`DELETE FROM rate_limits`;
  } finally {
    await db.end();
  }
}
