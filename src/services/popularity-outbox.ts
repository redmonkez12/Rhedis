import { count, eq, inArray } from "drizzle-orm";
import { db } from "#src/db/drizzle";
import { concertFavorites, popularityOutbox } from "#src/db/schema";
import { syncConcertPopularity } from "#src/services/popularity";

// One transaction owns the job until Redis succeeds. A failed Redis call rolls
// back the transaction, so the same job can be picked up on the next attempt.
export async function processNextPopularityOutboxEvent(concertIds?: readonly string[]): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [event] = await tx.select({ id: popularityOutbox.id, concertId: popularityOutbox.concertId })
      .from(popularityOutbox)
      .where(concertIds ? inArray(popularityOutbox.concertId, [...concertIds]) : undefined)
      .orderBy(popularityOutbox.createdAt, popularityOutbox.id)
      .limit(1)
      .for("update", { skipLocked: true });

    if (!event) return false;

    const [row] = await tx.select({ favoriteCount: count() })
      .from(concertFavorites)
      .where(eq(concertFavorites.concertId, event.concertId));

    await syncConcertPopularity(event.concertId, row?.favoriteCount ?? 0);
    await tx.delete(popularityOutbox).where(eq(popularityOutbox.id, event.id));
    return true;
  });
}
