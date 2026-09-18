import { FastifyInstance } from "fastify";
import { requireSession } from "#src/auth/session";
import { requireVenueAdmin } from "#src/auth/venue-permissions";
import { redis } from "#src/db/redis";
import { concertsPopularity } from "#src/redis/keys";
import { pathParamsSchema } from "#src/routes/params-schema";
import { getConcertDetail, getConcertsById, updateConcert } from "#src/services/concert";

type ConcertDetailParams = { concertId: string };
type ConcertUpdateBody = { title?: string; startsAt?: string };

const concertUpdateBodySchema = {
    type: "object",
    minProperties: 1,
    additionalProperties: false,
    properties: {
        title: { type: "string", minLength: 1 },
        startsAt: { type: "string", format: "date-time" },
    },
};

export function registerConcertsRoute(app: FastifyInstance): void {
    app.get("/concerts/popular", async (req, res) => {
        const top = await redis.zRangeWithScores(concertsPopularity(), 0, 2, { REV: true });

        if (top.length === 0) {
            return [];
        }

        const concerts = await getConcertsById(top.map(concert => concert.value));

        const byId = new Map(concerts.map((concert) => [concert.id, concert]));

        return top.map(({ value, score }) => {
            const concert = byId.get(value);

            if (!concert) {
                throw new Error(`Concert ${value} is missing in PostgreSQL`);
            }

            return { ...concert, favoritesCount: score };
        });
    });

    app.get<{ Params: ConcertDetailParams }>("/concerts/:concertId", {
        schema: { params: pathParamsSchema({ concertId: "text" }) },
    }, async (request, reply) => {
        const concert = await getConcertDetail(request.params.concertId);
        if (!concert) return reply.code(404).send({ error: "Concert not found" });
        return concert;
    });

    app.patch<{ Params: ConcertDetailParams; Body: ConcertUpdateBody }>("/concerts/:concertId", {
        schema: {
            params: pathParamsSchema({ concertId: "text" }),
            body: concertUpdateBodySchema,
        },
    }, async (request, reply) => {
        const session = await requireSession(request);
        requireVenueAdmin(session.user.id);

        const title = request.body.title?.trim();
        if (request.body.title !== undefined && !title) {
            return reply.code(400).send({ error: "Title must not be empty" });
        }

        const startsAt = request.body.startsAt === undefined
            ? undefined
            : new Date(request.body.startsAt);
        if (startsAt !== undefined && Number.isNaN(startsAt.getTime())) {
            return reply.code(400).send({ error: "Invalid concert date" });
        }

        const updated = await updateConcert(request.params.concertId, { title, startsAt });
        if (!updated) return reply.code(404).send({ error: "Concert not found" });
        return reply.code(204).send();
    });
}
