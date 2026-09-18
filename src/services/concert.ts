import { getLogger } from "@logtape/logtape";
import { eq, inArray } from "drizzle-orm";
import { db } from "#src/db/drizzle";
import { redis } from "#src/db/redis";
import { concerts, halls } from "#src/db/schema";
import { concertCacheKey } from "#src/redis/keys";

const logger = getLogger(["redis-practice", "concert"]);
let detailPostgresReads = 0;

export function getConcertDetailPostgresReadCount(): number {
    return detailPostgresReads;
}

type ConcertDetail = {
    id: string;
    title: string;
    artist: string;
    venue: string;
    city: string;
    startsAt: Date;
};

type CachedConcertDetail = Omit<ConcertDetail, "startsAt"> & { startsAt: string };

const concertDetails = {
    id: concerts.id,
    title: concerts.title,
    artist: concerts.artist,
    venue: halls.name,
    city: halls.city,
    startsAt: concerts.startsAt,
};

export async function getConcertDetail(concertId: string): Promise<ConcertDetail | undefined> {
    const key = concertCacheKey(concertId);
    const cached = await redis.get(key);

    if (cached !== null) {
        logger.info("cache hit", { concertId });
        const concert = JSON.parse(cached) as CachedConcertDetail;
        return { ...concert, startsAt: new Date(concert.startsAt) };
    }

    logger.info("cache miss", { concertId });

    const [concert] = await db
        .select(concertDetails)
        .from(concerts)
        .innerJoin(halls, eq(concerts.hallId, halls.id))
        .where(eq(concerts.id, concertId))
        .limit(1);

    detailPostgresReads++;
    logger.info("concert detail read from PostgreSQL", { concertId, detailPostgresReads });

    if (!concert) {
        return undefined;
    }

    await redis.set(key, JSON.stringify(concert), { EX: 60 });
    return concert;
}

export async function updateConcert(
    concertId: string,
    changes: { title?: string; startsAt?: Date },
): Promise<boolean> {
    if (changes.title === undefined && changes.startsAt === undefined) {
        throw new Error("At least one concert field must be updated");
    }

    const updated = await db.transaction(async (tx) => {
        const [concert] = await tx.update(concerts)
            .set(changes)
            .where(eq(concerts.id, concertId))
            .returning({ id: concerts.id });
        return concert !== undefined;
    });

    if (!updated) return false;

    // The transaction has committed before its promise resolves.
    await redis.del(concertCacheKey(concertId));
    logger.info("concert cache invalidated", { concertId });
    return true;
}

export async function getConcertsById(concertIds: string[]) {
    return db.select(concertDetails)
        .from(concerts)
        .innerJoin(halls, eq(concerts.hallId, halls.id))
        .where(inArray(concerts.id, concertIds));
}
