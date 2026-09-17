import { createClient } from "redis";
import { env } from "#src/config/env";

export const redis = createClient({ url: env.redisUrl, disableOfflineQueue: true });

redis.on("error", (error) => {
  console.error("Redis client error:", error instanceof Error ? error.message : error);
});
