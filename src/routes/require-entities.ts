import { getConcert } from "#src/services/concert";
import { getSeat } from "#src/services/seat";

export async function requireSeat(concertId: string, seatId: string) {
    const seat = await getSeat(concertId, seatId);
    if (!seat) {
        throw Object.assign(new Error("Seat not found"), { statusCode: 404 });
    }

    return seat;
}

export async function requireConcert(concertId: string) {
    const concert = await getConcert(concertId);
    if (!concert) {
        throw Object.assign(new Error("Concert not found"), { statusCode: 404 });
    }
    return concert;
}
