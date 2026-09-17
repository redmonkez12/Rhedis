import type { FastifyInstance } from "fastify";
import { requireSession } from "#src/auth/session";
import { addConcertFavorite } from "#src/services/favorites";
import { addRedisOnlyFavorite } from "#src/services/redis-favorites";
import { requireConcert } from "#src/routes/require-entities";

export function registerMeRoute(app: FastifyInstance): void {
  app.get("/me", async (request) => {
    const session = await requireSession(request);
    const { id, name, email, image, emailVerified } = session.user;
    return { id, name, email, image, emailVerified };
  });

  app.put<{ Params: { concertId: string }}>("/me/favorites/:concertId", async (request) => {
    const session = await requireSession(request);

    const concert = await requireConcert(request.params.concertId);

    const { added } = await addConcertFavorite(session.user.id, concert.id);
    return { added };
  });

  app.put<{ Params: { concertId: string } }>("/me/redis-favorites/:concertId", async (request) => {
    const session = await requireSession(request);
    const concert = await requireConcert(request.params.concertId);
    const added = await addRedisOnlyFavorite(session.user.id, concert.id);
    return { added };
  });
}
