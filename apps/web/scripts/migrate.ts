import { migrateDb } from "../src/server/db/client";

migrateDb()
  .then(() => {
    console.info("Migrated.");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
