import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "#src/db/drizzle";
import { redis } from "#src/db/redis";

export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/health", async (_request, reply) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!redis.isReady) throw new Error("Redis is not ready");
      await Promise.race([
        Promise.all([db.execute(sql`select 1`), redis.ping()]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Health check timed out")), 3000);
        }),
      ]);
      return { status: "ok" };
    } catch (error) {
      app.log.error({ err: error }, "Health check failed");
      return reply.code(503).send({ status: "unavailable" });
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}
