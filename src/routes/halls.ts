import type { FastifyInstance } from "fastify";
import { requireSession } from "#src/auth/session";
import { requireVenueAdmin } from "#src/auth/venue-permissions";
import { pathParamsSchema } from "#src/routes/params-schema";
import { getAllHalls, getHall } from "#src/services/halls";
import {
  appendSeat,
  getAccessibleSeats,
  getAllSeats,
  getVenueLayout,
  updateSeatCategory,
  type VenueSeat,
} from "#src/services/venue";

const hallIdParams = { id: "uuid" } as const;
type HallIdParams = { id: string };
type SeatCategoryParams = HallIdParams & { seatId: string };
type AppendSeatParams = HallIdParams & { sectionId: string };

const categoryBodySchema = {
  type: "object",
  required: ["category"],
  additionalProperties: false,
  properties: {
    category: { type: "string", minLength: 1 },
  },
};

const seatBodySchema = {
  type: "object",
  required: ["id", "category", "accessible"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    category: { type: "string", minLength: 1 },
    accessible: { type: "boolean" },
  },
};

export function registerHallsRoute(app: FastifyInstance): void {
  app.get("/halls", async () => getAllHalls());

  app.get<{ Params: HallIdParams }>("/halls/:id", {
    schema: {
      params: pathParamsSchema(hallIdParams),
    },
  }, async (request, reply) => {
    const hall = await getHall(request.params.id);

    if (!hall) {
      return reply.code(404).send({ error: "Hall not found" });
    }

    return hall;
  });

  app.get<{ Params: HallIdParams }>("/halls/:id/layout", {
    schema: {
      params: pathParamsSchema(hallIdParams),
    },
  }, async (request, reply) => {
    const layout = await getVenueLayout(request.params.id);

    if (layout === null) {
      return reply.code(404).send({ error: "Hall layout not found" });
    }

    return layout;
  });

  app.get<{ Params: HallIdParams }>("/halls/:id/seats", {
    schema: {
      params: pathParamsSchema(hallIdParams),
    },
  }, async (request, reply) => {
    const seats = await getAllSeats(request.params.id);

    if (seats === null) {
      return reply.code(404).send({ error: "Hall layout not found" });
    }

    return seats;
  });

  app.get<{ Params: HallIdParams }>("/halls/:id/seats/accessible", {
    schema: {
      params: pathParamsSchema(hallIdParams),
    },
  }, async (request, reply) => {
    const seats = await getAccessibleSeats(request.params.id);

    if (seats === null) {
      return reply.code(404).send({ error: "Hall layout not found" });
    }

    return seats;
  });

  app.patch<{ Params: SeatCategoryParams; Body: { category: string } }>(
    "/halls/:id/seats/:seatId/category",
    {
      schema: {
        params: pathParamsSchema({ ...hallIdParams, seatId: "text" }),
        body: categoryBodySchema,
      },
    },
    async (request, reply) => {
      const session = await requireSession(request);
      requireVenueAdmin(session.user.id);
      const { id, seatId } = request.params;
      const { category } = request.body;
      const updated = await updateSeatCategory(id, seatId, category);

      if (!updated) {
        return reply.code(404).send({ error: "Seat or hall layout not found" });
      }

      return { id: seatId, category };
    },
  );

  app.post<{ Params: AppendSeatParams; Body: VenueSeat }>(
    "/halls/:id/sections/:sectionId/seats",
    {
      schema: {
        params: pathParamsSchema({ ...hallIdParams, sectionId: "text" }),
        body: seatBodySchema,
      },
    },
    async (request, reply) => {
      const session = await requireSession(request);
      requireVenueAdmin(session.user.id);
      const { id, sectionId } = request.params;
      await appendSeat(id, sectionId, request.body);
      return reply.code(201).send(request.body);
    },
  );
}
