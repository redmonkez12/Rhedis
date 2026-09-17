import { db } from "#src/db/drizzle";
import { concerts, hallSeats } from "#src/db/schema";
import { and, eq } from "drizzle-orm";

export async function getSeat(concertId: string, seatId: string) {
    const [seat] = await db
        .select({ hallId: hallSeats.hallId, seatId: hallSeats.seatId })
        .from(hallSeats)
        .innerJoin(concerts, eq(hallSeats.hallId, concerts.hallId))
        .where(and(eq(concerts.id, concertId), eq(hallSeats.seatId, seatId)))
        .limit(1);

    return seat;
}
