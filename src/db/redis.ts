import { createClient } from "redis";
import { getLogger } from "@logtape/logtape";
import { env } from "#src/config/env";

const logger = getLogger(["redis-practice", "db", "redis"]);

export const redis = createClient({ url: env.redisUrl, disableOfflineQueue: true });

redis.on("error", (error) => {
  logger.error("Redis client error", { error });
});
