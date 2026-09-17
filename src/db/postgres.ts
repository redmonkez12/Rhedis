import { Pool } from "pg";
import { env } from "#src/config/env";

export const postgres = new Pool({
  connectionString: env.databaseUrl,
  connectionTimeoutMillis: 3000,
  query_timeout: 3000,
});

postgres.on("error", (error) => {
  console.error("PostgreSQL idle client error:", error);
});
