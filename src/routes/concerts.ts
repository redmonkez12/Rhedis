import { FastifyInstance } from "fastify";
import { redis } from "#src/db/redis";
import { concertsPopularity } from "#src/redis/keys";
import { getConcertsById } from "#src/services/concert";

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
}
