/** Where the end-to-end suite runs its server, and the database it alone uses. */
export const E2E_PORT = 3401;
export const E2E_URL = `http://localhost:${E2E_PORT}`;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://rota:rota@localhost:5434/rota_e2e";
