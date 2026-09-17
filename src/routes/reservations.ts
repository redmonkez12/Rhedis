import { FastifyInstance } from "fastify";
import { requireSession } from "#src/auth/session";
import { requireConcert, requireSeat } from "#src/routes/require-entities";
import { redis } from "#src/db/redis";
import { seatReservationKey } from "#src/redis/keys";

export function registerReservationsRoute(app: FastifyInstance): void {
    app.post<{
        Params: { concertId: string, seatId: string }
    }>("/concerts/:concertId/seats/:seatId/reservation", async (req, res) => {
        const session = await requireSession(req);
        const { concertId, seatId } = req.params;
        await requireConcert(concertId);
        await requireSeat(concertId, seatId);

        const reservationId = crypto.randomUUID();

        const result = await redis.set(seatReservationKey(concertId, seatId), JSON.stringify({
            userId: session.user.id,
            reservationId,
        }), {
            NX: true,
            EX: 60,
        });

        if (!result) {
            return res.code(409).send({ error: "Seat already reserved"})
        }

        return res.code(201).send({ reservationId });
    });

    app.get<{
        Params: { concertId: string, seatId: string }
    }>("/concerts/:concertId/seats/:seatId/reservation", async (req) => {
        await requireSession(req);
        const { concertId, seatId } = req.params;
        await requireConcert(concertId);
        await requireSeat(concertId, seatId);

        const remainingSeconds = await redis.ttl(seatReservationKey(concertId, seatId));
        if (remainingSeconds === -2) {
            return { reserved: false, remainingSeconds: 0 };
        }
        if (remainingSeconds === -1) {
            throw Object.assign(new Error("Reservation has no expiration"), { statusCode: 500 });
        }
        if (remainingSeconds < 0) {
            throw new Error(`Unexpected reservation TTL: ${remainingSeconds}`);
        }

        return { reserved: true, remainingSeconds };
    });
}
