import { getLogger } from "@logtape/logtape";
import { postgres } from "#src/db/postgres";
import { redis } from "#src/db/redis";
import { configureLogging } from "#src/logging";
import { rebuildConcertPopularity } from "#src/services/popularity";

const logger = getLogger(["redis-practice", "script", "rebuild-popularity"]);
configureLogging();

try {
  await redis.connect();
  await rebuildConcertPopularity();
  logger.info("Concert popularity rebuilt from PostgreSQL favorites");
} finally {
  const redisClose = redis.isReady ? redis.quit() : (redis.isOpen ? redis.destroy() : undefined);
  await Promise.all([postgres.end(), redisClose]);
}
