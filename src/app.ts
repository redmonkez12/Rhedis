import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "#src/config/env";
import { registerAuthRoutes } from "#src/routes/auth";
import { registerHealthRoute } from "#src/routes/health";
import { registerHallsRoute } from "#src/routes/halls";
import { registerMeRoute } from "#src/routes/me";
import { registerConcertsRoute } from "#src/routes/concerts";
import { registerReservationsRoute } from "#src/routes/reservations";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: env.frontendOrigin, credentials: true });
  registerAuthRoutes(app);
  registerHealthRoute(app);
  await app.register(async (v1) => {
    registerHallsRoute(v1);
    registerMeRoute(v1);
    registerConcertsRoute(v1);
    registerReservationsRoute(v1);
  }, { prefix: "/api/v1" });
  return app;
}
