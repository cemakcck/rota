import postgres from "postgres";
import { migrateDb } from "../../src/server/db/client";

const BASE = process.env.TEST_DATABASE_URL ?? "postgres://rota:rota@localhost:5434/rota_test";

function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export default async function setup() {
  const name = new URL(BASE).pathname.slice(1);
  const admin = postgres(withDb(BASE, "postgres"), { max: 1, onnotice: () => {} });
  try {
    const [row] = await admin`SELECT 1 AS ok FROM pg_database WHERE datname = ${name}`;
    if (!row) await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  await migrateDb(BASE);
}
