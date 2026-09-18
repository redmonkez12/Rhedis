import type { FastifyInstance } from "fastify";
import { pathParamsSchema } from "#src/routes/params-schema";
import { getAllHalls, getHall } from "#src/services/halls";

export function registerHallsRoute(app: FastifyInstance): void {
  app.get("/halls", async () => getAllHalls());

  app.get<{ Params: { id: string } }>("/halls/:id", {
    schema: {
      params: pathParamsSchema({ id: "uuid" }),
    },
  }, async (request, reply) => {
    const hall = await getHall(request.params.id);

    if (!hall) {
      return reply.code(404).send({ error: "Hall not found" });
    }

    return hall;
  });
}
