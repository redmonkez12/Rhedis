import { count, eq, sql } from "drizzle-orm";
import { db } from "#src/db/drizzle";
import { popularityOutboxChannel } from "#src/db/outbox-channel";
import { concertFavorites, concerts, popularityOutbox } from "#src/db/schema";

export async function addConcertFavorite(userId: string, concertId: string) {
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(concertFavorites)
      .values({ userId, concertId })
      .onConflictDoNothing()
      .returning({ userId: concertFavorites.userId });

    if (inserted.length === 1) {
      await tx.insert(popularityOutbox).values({ concertId });
      // PostgreSQL sends this only after the transaction commits. The outbox
      // row, not the notification, remains the durable source of work.
      await tx.execute(sql`select pg_notify(${popularityOutboxChannel}, '')`);
    }

    return { added: inserted.length === 1 };
  });
}

export async function getConcertPopularityCounts() {
  return db.select({
    concertId: concerts.id,
    favoriteCount: count(concertFavorites.userId),
  })
    .from(concerts)
    .leftJoin(concertFavorites, eq(concertFavorites.concertId, concerts.id))
    .groupBy(concerts.id);
}
