import { auth } from "#src/auth/auth";
import { db } from "#src/db/drizzle";
import { postgres } from "#src/db/postgres";
import { redis } from "#src/db/redis";
import { concerts, halls, hallSeats } from "#src/db/schema";
import { redisOnlyConcertsPopularity } from "#src/redis/keys";
import { rebuildConcertPopularity } from "#src/services/popularity";
import { inArray } from "drizzle-orm";

// Fictional concerts with stable IDs, so the seed can be run repeatedly.
const seedConcerts = [
  { id: "concert-01", title: "Jarní ozvěny", artist: "Měsíční linka", hall: { name: "Klub Orion", city: "Praha" }, startsAt: new Date("2027-01-22T19:00:00+01:00") },
  { id: "concert-02", title: "Noční puls", artist: "Neonový sever", hall: { name: "Hala Atlas", city: "Brno" }, startsAt: new Date("2027-02-19T20:00:00+01:00") },
  { id: "concert-03", title: "Tichý proud", artist: "Modré ráno", hall: { name: "Scéna Most", city: "Ostrava" }, startsAt: new Date("2027-03-20T19:30:00+01:00") },
  { id: "concert-04", title: "Světla města", artist: "Papírové nebe", hall: { name: "Klub Kompas", city: "Plzeň" }, startsAt: new Date("2027-04-16T20:00:00+02:00") },
  { id: "concert-05", title: "Elektrické léto", artist: "Satelity", hall: { name: "Letní scéna Jih", city: "Olomouc" }, startsAt: new Date("2027-05-21T19:00:00+02:00") },
  { id: "concert-06", title: "Půlnoční vlna", artist: "Hlubina", hall: { name: "Kulturní dvůr", city: "Liberec" }, startsAt: new Date("2027-06-18T20:00:00+02:00") },
  { id: "concert-07", title: "Nad horizontem", artist: "Dlouhá cesta", hall: { name: "Amfiteátr Sever", city: "Hradec Králové" }, startsAt: new Date("2027-07-16T19:30:00+02:00") },
  { id: "concert-08", title: "Barevný šum", artist: "Třetí patro", hall: { name: "Klub Mlýn", city: "České Budějovice" }, startsAt: new Date("2027-08-20T20:00:00+02:00") },
  { id: "concert-09", title: "Podzimní signál", artist: "Vlnobití", hall: { name: "Scéna Západ", city: "Zlín" }, startsAt: new Date("2027-09-17T19:00:00+02:00") },
  { id: "concert-10", title: "Poslední světlo", artist: "Jantar", hall: { name: "Dům hudby", city: "Pardubice" }, startsAt: new Date("2027-10-22T20:00:00+02:00") },
];

const seatIds = ["A1", "A2", "A3", "A4", "A5"];
const hallKey = (hall: { name: string; city: string }) => JSON.stringify([hall.name, hall.city]);
const seedHalls = [...new Map(seedConcerts.map(({ hall }) => [hallKey(hall), hall])).values()];
const seedUsers = [
  { name: "Alice", email: "alice@example.test" },
  { name: "Bob", email: "bob@example.test" },
  { name: "Carol", email: "carol@example.test" },
];
const seedUserPassword = process.env.SEED_USER_PASSWORD ?? "TestPass123!";

async function seedDemoUsers(): Promise<number> {
  const { rows } = await postgres.query<{ email: string }>(
    'SELECT email FROM "user" WHERE email = ANY($1::text[])',
    [seedUsers.map(({ email }) => email)],
  );
  const existingEmails = new Set(rows.map(({ email }) => email));
  let created = 0;

  for (const user of seedUsers) {
    if (existingEmails.has(user.email)) continue;
    await auth.api.signUpEmail({ body: { ...user, password: seedUserPassword } });
    created++;
  }

  return created;
}

try {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo seed must not run with NODE_ENV=production");
  }
  await redis.connect();
  await db.transaction(async (tx) => {
    await tx.insert(halls).values(seedHalls).onConflictDoNothing();
    const hallRows = await tx.select().from(halls).where(inArray(halls.name, seedHalls.map(({ name }) => name)));
    const hallIds = new Map(hallRows.map((hall) => [hallKey(hall), hall.id]));

    await tx.insert(hallSeats).values(seedHalls.flatMap((hall) => {
      const hallId = hallIds.get(hallKey(hall));
      if (!hallId) throw new Error(`Hall ${hall.name} in ${hall.city} is missing`);
      return seatIds.map((seatId) => ({ hallId, seatId }));
    })).onConflictDoNothing();

    await tx.insert(concerts).values(seedConcerts.map(({ hall, ...concert }) => {
      const hallId = hallIds.get(hallKey(hall));
      if (!hallId) throw new Error(`Hall ${hall.name} in ${hall.city} is missing`);
      return { ...concert, hallId };
    })).onConflictDoNothing();
  });
  await rebuildConcertPopularity();
  await redis.zAdd(
    redisOnlyConcertsPopularity(),
    seedConcerts.map(({ id }) => ({ value: id, score: 0 })),
    { condition: "NX" },
  );
  const createdUsers = await seedDemoUsers();
  console.info(`Seed complete (${seedHalls.length} halls, ${seedHalls.length * seatIds.length} seats, ${seedConcerts.length} demo concerts, ${seedUsers.length} demo users, ${createdUsers} newly created).`);
} finally {
  const redisClose = redis.isReady ? redis.quit() : (redis.isOpen ? redis.destroy() : undefined);
  await Promise.all([postgres.end(), redisClose]);
}
