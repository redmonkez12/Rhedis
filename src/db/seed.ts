import { db } from "#src/db/drizzle";
import { postgres } from "#src/db/postgres";
import { redis } from "#src/db/redis";
import { concerts } from "#src/db/schema";
import { redisOnlyConcertsPopularity } from "#src/redis/keys";
import { rebuildConcertPopularity } from "#src/services/popularity";

// Fictional concerts with stable IDs, so the seed can be run repeatedly.
const seedConcerts = [
  { id: "concert-01", title: "Jarní ozvěny", artist: "Měsíční linka", venue: "Klub Orion", city: "Praha", startsAt: new Date("2027-01-22T19:00:00+01:00") },
  { id: "concert-02", title: "Noční puls", artist: "Neonový sever", venue: "Hala Atlas", city: "Brno", startsAt: new Date("2027-02-19T20:00:00+01:00") },
  { id: "concert-03", title: "Tichý proud", artist: "Modré ráno", venue: "Scéna Most", city: "Ostrava", startsAt: new Date("2027-03-20T19:30:00+01:00") },
  { id: "concert-04", title: "Světla města", artist: "Papírové nebe", venue: "Klub Kompas", city: "Plzeň", startsAt: new Date("2027-04-16T20:00:00+02:00") },
  { id: "concert-05", title: "Elektrické léto", artist: "Satelity", venue: "Letní scéna Jih", city: "Olomouc", startsAt: new Date("2027-05-21T19:00:00+02:00") },
  { id: "concert-06", title: "Půlnoční vlna", artist: "Hlubina", venue: "Kulturní dvůr", city: "Liberec", startsAt: new Date("2027-06-18T20:00:00+02:00") },
  { id: "concert-07", title: "Nad horizontem", artist: "Dlouhá cesta", venue: "Amfiteátr Sever", city: "Hradec Králové", startsAt: new Date("2027-07-16T19:30:00+02:00") },
  { id: "concert-08", title: "Barevný šum", artist: "Třetí patro", venue: "Klub Mlýn", city: "České Budějovice", startsAt: new Date("2027-08-20T20:00:00+02:00") },
  { id: "concert-09", title: "Podzimní signál", artist: "Vlnobití", venue: "Scéna Západ", city: "Zlín", startsAt: new Date("2027-09-17T19:00:00+02:00") },
  { id: "concert-10", title: "Poslední světlo", artist: "Jantar", venue: "Dům hudby", city: "Pardubice", startsAt: new Date("2027-10-22T20:00:00+02:00") },
] satisfies (typeof concerts.$inferInsert)[];

try {
  await redis.connect();
  await db.insert(concerts).values(seedConcerts).onConflictDoNothing();
  await rebuildConcertPopularity();
  await redis.zAdd(
    redisOnlyConcertsPopularity(),
    seedConcerts.map(({ id }) => ({ value: id, score: 0 })),
    { condition: "NX" },
  );
  console.info(`Concert seed complete (${seedConcerts.length} demo concerts).`);
} finally {
  const redisClose = redis.isReady ? redis.quit() : (redis.isOpen ? redis.destroy() : undefined);
  await Promise.all([postgres.end(), redisClose]);
}
