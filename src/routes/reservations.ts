import { FastifyInstance } from "fastify";
import { requireSession } from "#src/auth/session";
import { requireConcert, requireSeat } from "#src/routes/require-entities";
import { pathParamsSchema } from "#src/routes/params-schema";
import { redis } from "#src/db/redis";
import { seatReservationKey } from "#src/redis/keys";
import { recordCompletedActivity } from "#src/services/activity";

const cancelReservationScript = `
    local value = redis.call("GET", KEYS[1])
    if not value then return 0 end

    local reservation = cjson.decode(value)
    if reservation.userId ~= ARGV[1] then return -1 end
    if reservation.reservationId ~= ARGV[2] then return -2 end

    return redis.call("DEL", KEYS[1])
`;

const seatParams = { concertId: "text", seatId: "text" } as const;
const reservationParams = { ...seatParams, reservationId: "uuid" } as const;

type SeatParams = { concertId: string; seatId: string };
type ReservationParams = SeatParams & { reservationId: string };

export function registerReservationsRoute(app: FastifyInstance): void {
    app.post<{ Params: SeatParams }>("/concerts/:concertId/seats/:seatId/reservation", {
        schema: { params: pathParamsSchema(seatParams) },
    }, async (req, res) => {
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

        await recordCompletedActivity(session.user.id, "reservation_created", concertId);
        return res.code(201).send({ reservationId });
    });

    app.get<{ Params: SeatParams }>("/concerts/:concertId/seats/:seatId/reservation", {
        schema: { params: pathParamsSchema(seatParams) },
    }, async (req) => {
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

    app.delete<{ Params: ReservationParams }>("/concerts/:concertId/seats/:seatId/reservations/:reservationId", {
        schema: { params: pathParamsSchema(reservationParams) },
    }, async (req, res) => {
        const session = await requireSession(req);
        const { concertId, seatId, reservationId } = req.params;
        await requireConcert(concertId);
        await requireSeat(concertId, seatId);

        const result = await redis.eval(cancelReservationScript, {
            keys: [seatReservationKey(concertId, seatId)],
            arguments: [session.user.id, reservationId],
        });

        if (result === 0) {
            throw Object.assign(new Error("Reservation not found"), { statusCode: 404 });
        }
        if (result === -1) {
            throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
        }
        if (result === -2) {
            throw Object.assign(new Error("Reservation ID is no longer current"), { statusCode: 409 });
        }
        if (result !== 1) {
            throw new Error(`Unexpected reservation cancellation result: ${result}`);
        }

        await recordCompletedActivity(session.user.id, "reservation_cancelled", concertId);
        return res.code(204).send();
    });
}
