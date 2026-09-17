import { db } from "#src/db/drizzle";
import { concerts } from "#src/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function getConcert(concertId: string) {
    const [concert] = await db
        .select()
        .from(concerts)
        .where(eq(concerts.id, concertId))
        .limit(1);

    return concert;
}

export async function getConcertsById(concertIds: string[]) {
    return db.select().from(concerts).where(inArray(concerts.id, concertIds));
}
