import { db } from "#src/db/drizzle";
import { concerts, halls } from "#src/db/schema";
import { eq, inArray } from "drizzle-orm";

const concertDetails = {
    id: concerts.id,
    title: concerts.title,
    artist: concerts.artist,
    venue: halls.name,
    city: halls.city,
    startsAt: concerts.startsAt,
};

export async function getConcert(concertId: string) {
    const [concert] = await db
        .select(concertDetails)
        .from(concerts)
        .innerJoin(halls, eq(concerts.hallId, halls.id))
        .where(eq(concerts.id, concertId))
        .limit(1);

    return concert;
}

export async function getConcertsById(concertIds: string[]) {
    return db.select(concertDetails)
        .from(concerts)
        .innerJoin(halls, eq(concerts.hallId, halls.id))
        .where(inArray(concerts.id, concertIds));
}
