import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import { auth } from "#src/auth/auth";
import { env } from "#src/config/env";

export function registerAuthRoutes(app: FastifyInstance): void {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, env.authUrl);
      const headers = fromNodeHeaders(request.headers);
      const response = await auth.handler(new Request(url, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      }));

      response.headers.forEach((value, name) => {
        if (name !== "set-cookie" && name !== "content-length") reply.header(name, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.code(response.status).send(response.body ? await response.text() : null);
    },
  });
}
