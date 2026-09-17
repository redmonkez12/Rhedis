import { postgres } from "#src/db/postgres";
import { redis } from "#src/db/redis";
import { rebuildConcertPopularity } from "#src/services/popularity";

try {
  await redis.connect();
  await rebuildConcertPopularity();
  console.info("Concert popularity rebuilt from PostgreSQL favorites.");
} finally {
  const redisClose = redis.isReady ? redis.quit() : (redis.isOpen ? redis.destroy() : undefined);
  await Promise.all([postgres.end(), redisClose]);
}
