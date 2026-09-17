import type { SecondaryStorage } from "better-auth";
import { redis } from "#src/db/redis";

const authKey = (key: string) => `auth:${key}`;

function validTtl(ttl: number): number {
  if (!Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new TypeError("Auth Redis TTL must be a positive integer in seconds");
  }
  return ttl;
}

export const secondaryStorage: SecondaryStorage = {
  get: (key) => redis.get(authKey(key)),
  getAndDelete: (key) => redis.getDel(authKey(key)),
  async increment(key, ttl) {
    // MULTI/EXEC is atomic; NX preserves the original expiration on later increments.
    const [value] = await redis.multi().incr(authKey(key)).expire(authKey(key), validTtl(ttl), "NX").execTyped();
    return value;
  },
  async set(key, value, ttl) {
    if (ttl !== undefined) {
      await redis.set(authKey(key), value, { EX: validTtl(ttl) });
    } else {
      await redis.set(authKey(key), value);
    }
  },
  async delete(key) {
    await redis.del(authKey(key));
  },
};

