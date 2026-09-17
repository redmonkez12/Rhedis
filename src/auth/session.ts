import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { auth } from "#src/auth/auth";

export async function requireSession(request: FastifyRequest) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
  return session;
}
