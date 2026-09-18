import { getLogger } from "@logtape/logtape";
import { and, eq } from "drizzle-orm";
import { db } from "#src/db/drizzle";
import { postgres } from "#src/db/postgres";
import { redis } from "#src/db/redis";
import { halls, hallSeats } from "#src/db/schema";
import { layoutKey } from "#src/redis/keys";
import { configureLogging } from "#src/logging";

const logger = getLogger(["redis-practice", "script", "seed-venue-layout"]);
const hallCity = "Praha";

const layout = {
  name: "Main Hall",
  sections: [
    {
      id: "floor",
      seats: [
        { id: "A1", category: "standard", accessible: true },
        { id: "A2", category: "standard", accessible: false },
      ],
    },
    {
      id: "balcony",
      seats: [
        { id: "B1", category: "premium", accessible: false },
      ],
    },
  ],
};

configureLogging();

try {
  const hallId = await db.transaction(async (tx) => {
    await tx.insert(halls).values({ name: layout.name, city: hallCity }).onConflictDoNothing();
    const [hall] = await tx.select({ id: halls.id }).from(halls)
      .where(and(eq(halls.name, layout.name), eq(halls.city, hallCity)))
      .limit(1);
    if (!hall) throw new Error("Main Hall was not found after seeding");

    await tx.insert(hallSeats).values(
      layout.sections.flatMap((section) => section.seats.map((seat) => ({
        hallId: hall.id,
        seatId: seat.id,
      }))),
    ).onConflictDoNothing();
    return hall.id;
  });

  await redis.connect();
  const key = layoutKey(hallId);
  await redis.json.set(key, "$", layout);
  logger.info("Venue layout saved", { key, hall: layout.name, city: hallCity });
} finally {
  const redisClose = redis.isReady ? redis.quit() : (redis.isOpen ? redis.destroy() : undefined);
  await Promise.all([postgres.end(), redisClose]);
}
