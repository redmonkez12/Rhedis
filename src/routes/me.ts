import type { FastifyInstance } from "fastify";
import { requireSession } from "#src/auth/session";
import { addConcertFavorite } from "#src/services/favorites";
import { addRedisOnlyFavorite } from "#src/services/redis-favorites";
import { requireConcert } from "#src/routes/require-entities";
import { getRecentActivities, recordCompletedActivity } from "#src/services/activity";

export function registerMeRoute(app: FastifyInstance): void {
  app.get("/me", async (request) => {
    const session = await requireSession(request);
    const { id, name, email, image, emailVerified } = session.user;
    return { id, name, email, image, emailVerified };
  });

  app.get<{ Querystring: { offset: number; limit: number } }>("/me/activities", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          offset: { type: "integer", minimum: 0, default: 0 },
          limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
        },
      },
    },
  }, async (request) => {
    const session = await requireSession(request);
    return getRecentActivities(session.user.id, request.query.offset, request.query.limit);
  });

  app.put<{ Params: { concertId: string }}>("/me/favorites/:concertId", async (request) => {
    const session = await requireSession(request);

    const concert = await requireConcert(request.params.concertId);

    const { added } = await addConcertFavorite(session.user.id, concert.id);
    if (added) {
      await recordCompletedActivity(session.user.id, "favorite_added", concert.id);
    }
    return { added };
  });

  app.put<{ Params: { concertId: string } }>("/me/redis-favorites/:concertId", async (request) => {
    const session = await requireSession(request);
    const concert = await requireConcert(request.params.concertId);
    const added = await addRedisOnlyFavorite(session.user.id, concert.id);
    if (added) {
      await recordCompletedActivity(session.user.id, "favorite_added", concert.id);
    }
    return { added };
  });
}
