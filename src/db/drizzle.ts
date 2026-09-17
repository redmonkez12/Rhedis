import { drizzle } from "drizzle-orm/node-postgres";
import { postgres } from "#src/db/postgres";
import * as schema from "#src/db/schema";

export const db = drizzle({ client: postgres, schema });
