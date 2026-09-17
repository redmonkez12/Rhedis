import { sql } from "drizzle-orm";
import { buildApp } from "#src/app";
import { env } from "#src/config/env";
import { db } from "#src/db/drizzle";
import { postgres } from "#src/db/postgres";
import { redis } from "#src/db/redis";
import { rebuildConcertPopularity } from "#src/services/popularity";

const app = await buildApp();
let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  const redisClose = redis.isReady ? redis.quit() : (redis.isOpen ? redis.destroy() : undefined);
  await Promise.allSettled([app.close(), redisClose, postgres.end()]);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}

try {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([redis.connect(), db.execute(sql`select 1`)]),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Database connection timed out")), 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  await rebuildConcertPopularity();
  await app.listen({ port: env.port, host: "127.0.0.1" });
} catch (error) {
  app.log.error({ err: error }, "Unable to start server");
  await shutdown();
  process.exitCode = 1;
}
