import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "#src/config/env";
import { registerAuthRoutes } from "#src/routes/auth";
import { registerHealthRoute } from "#src/routes/health";
import { registerMeRoute } from "#src/routes/me";
import { registerConcertsRoute } from "#src/routes/concerts";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: env.frontendOrigin, credentials: true });
  registerAuthRoutes(app);
  registerHealthRoute(app);
  registerMeRoute(app);
  registerConcertsRoute(app);
  return app;
}
