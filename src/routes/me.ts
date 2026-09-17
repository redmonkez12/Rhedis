import type { FastifyInstance } from "fastify";
import { requireSession } from "#src/auth/session";
import { getConcert } from "#src/services/concert";
import { addConcertFavorite } from "#src/services/favorites";
import { addRedisOnlyFavorite } from "#src/services/redis-favorites";

async function requireConcert(concertId: string) {
  const concert = await getConcert(concertId);
  if (!concert) {
    throw Object.assign(new Error("Concert not found"), { statusCode: 404 });
  }
  return concert;
}

export function registerMeRoute(app: FastifyInstance): void {
  app.get("/api/me", async (request) => {
    const session = await requireSession(request);
    const { id, name, email, image, emailVerified } = session.user;
    return { id, name, email, image, emailVerified };
  });

  app.put<{ Params: { concertId: string }}>("/api/me/favorites/:concertId", async (request) => {
    const session = await requireSession(request);

    const concert = await requireConcert(request.params.concertId);

    const { added } = await addConcertFavorite(session.user.id, concert.id);
    return { added };
  });

  app.put<{ Params: { concertId: string } }>("/api/me/redis-favorites/:concertId", async (request) => {
    const session = await requireSession(request);
    const concert = await requireConcert(request.params.concertId);
    const added = await addRedisOnlyFavorite(session.user.id, concert.id);
    return { added };
  });
}
