import { Pool } from "pg";
import { getLogger } from "@logtape/logtape";
import { env } from "#src/config/env";

const logger = getLogger(["redis-practice", "db", "postgres"]);

export const postgres = new Pool({
  connectionString: env.databaseUrl,
  connectionTimeoutMillis: 3000,
  query_timeout: 3000,
});

postgres.on("error", (error) => {
  logger.error("PostgreSQL idle client error", { error });
});
