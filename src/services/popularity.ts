import { redis } from "#src/db/redis";
import { concertsPopularity } from "#src/redis/keys";
import { getConcertPopularityCounts } from "#src/services/favorites";

export async function syncConcertPopularity(concertId: string, favoriteCount: number) {
  // With add-only favorites, GT prevents an older concurrent count from overwriting a newer one.
  await redis.zAdd(concertsPopularity(), { value: concertId, score: favoriteCount }, { comparison: "GT" });
}

export async function rebuildConcertPopularity() {
  const counts = await getConcertPopularityCounts();
  const key = concertsPopularity();
  const transaction = redis.multi().del(key);

  if (counts.length > 0) {
    transaction.zAdd(key, counts.map(({ concertId, favoriteCount }) => ({
      value: concertId,
      score: favoriteCount,
    })));
  }

  await transaction.exec();
}
