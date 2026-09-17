import { redis } from "#src/db/redis";
import { redisOnlyConcertsPopularity, redisOnlyFavoritesKey } from "#src/redis/keys";

const addFavoriteScript = `
  local added = redis.call("SADD", KEYS[1], ARGV[1])
  if added == 1 then
    redis.call("ZINCRBY", KEYS[2], 1, ARGV[1])
  end
  return added
`;

export async function addRedisOnlyFavorite(userId: string, concertId: string): Promise<boolean> {
  const added = await redis.eval(addFavoriteScript, {
    keys: [redisOnlyFavoritesKey(userId), redisOnlyConcertsPopularity()],
    arguments: [concertId],
  });
  return added === 1;
}
