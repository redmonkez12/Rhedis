import cors from "@fastify/cors";
import { getLogTapeFastifyLogger } from "@logtape/fastify";
import Fastify, { LogController } from "fastify";
import type { FastifyBaseLogger } from "fastify";
import { env } from "#src/config/env";
import { configureLogging } from "#src/logging";
import { registerAuthRoutes } from "#src/routes/auth";
import { registerHealthRoute } from "#src/routes/health";
import { registerHallsRoute } from "#src/routes/halls";
import { registerMeRoute } from "#src/routes/me";
import { registerConcertsRoute } from "#src/routes/concerts";
import { registerReservationsRoute } from "#src/routes/reservations";

export async function buildApp() {
  configureLogging();
  const app = Fastify({
    // The adapter implements Fastify's runtime logger API, but its declared type is narrower.
    loggerInstance: getLogTapeFastifyLogger({ category: ["redis-practice", "http"] }) as unknown as FastifyBaseLogger,
    logController: new LogController({ disableRequestLogging: true }),
  });
  app.addHook("onError", (request, reply, error, done) => {
    const statusCode = error.statusCode ?? (reply.statusCode >= 400 ? reply.statusCode : 500);
    if (statusCode >= 500) {
      request.log.error({ error, statusCode }, "request failed");
    }
    done();
  });
  app.addHook("onResponse", (request, reply, done) => {
    request.log.info({
      method: request.method,
      url: request.routeOptions.url ?? request.url.split("?")[0],
      statusCode: reply.statusCode,
    }, "request completed");
    done();
  });
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
