import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { count, eq, inArray } from "drizzle-orm";
import Fastify, { type FastifyRequest } from "fastify";
import { Client } from "pg";
import { createClient } from "redis";
import { env } from "#src/config/env";
import { db } from "#src/db/drizzle";
import { popularityOutboxChannel } from "#src/db/outbox-channel";
import { postgres } from "#src/db/postgres";
import { concertFavorites, concerts, popularityOutbox } from "#src/db/schema";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for integration tests");

const testRedis = createClient({ url: redisUrl, disableOfflineQueue: true });
testRedis.on("error", () => {});

const runId = crypto.randomUUID();
const popularityKey = `test:${runId}:concerts:popularity`;
const redisOnlyPopularityKey = `test:${runId}:redis-only:concerts:popularity`;
const concertIds = [1, 2, 3, 4].map((number) => `test-${runId}-concert-${number}`);
const userIds = ["alice", "bob", "carol", "dave"].map((name) => `test-${runId}-${name}`);
const redisOnlyFavoritesKey = (userId: string) => `test:${runId}:redis-only:favorites:${userId}`;
const redisKeys = [popularityKey, redisOnlyPopularityKey, ...userIds.map(redisOnlyFavoritesKey)];
const concertRows = concertIds.map((id) => ({
  id,
  title: `Test ${id}`,
  artist: "Test artist",
  venue: "Test venue",
  city: "Praha",
  startsAt: new Date("2027-01-01T19:00:00+01:00"),
}));
let failProjectionUpdate = false;
const routeRedis = {
  zAdd(key: string, member: { value: string; score: number }, options: { comparison: "GT" }) {
    if (failProjectionUpdate) return Promise.reject(new Error("Simulated Redis update failure"));
    return testRedis.zAdd(key, member, options);
  },
  zRangeWithScores: testRedis.zRangeWithScores.bind(testRedis),
  eval: testRedis.eval.bind(testRedis),
  multi: testRedis.multi.bind(testRedis),
};

mock.module("#src/db/redis", () => ({ redis: routeRedis }));
mock.module("#src/redis/keys", () => ({
  concertsPopularity: () => popularityKey,
  redisOnlyFavoritesKey,
  redisOnlyConcertsPopularity: () => redisOnlyPopularityKey,
}));
mock.module("#src/auth/session", () => ({
  requireSession: async (request: FastifyRequest) => {
    const userId = request.headers["x-test-user-id"];
    if (typeof userId !== "string") {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    }
    return { user: { id: userId, name: userId, email: `${userId}@example.test`, image: null, emailVerified: false } };
  },
}));

const { registerMeRoute } = await import("../src/routes/me");
const { registerConcertsRoute } = await import("../src/routes/concerts");
const { rebuildConcertPopularity, syncConcertPopularity } = await import("../src/services/popularity");
const { processNextPopularityOutboxEvent } = await import("../src/services/popularity-outbox");
const app = Fastify({ logger: false });
registerMeRoute(app);
registerConcertsRoute(app);

beforeAll(async () => {
  await testRedis.connect();
  for (const userId of userIds) {
    await postgres.query(
      'INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)',
      [userId, userId, `${userId}@example.test`],
    );
  }
  await db.insert(concerts).values(concertRows);
  await app.ready();
});

beforeEach(async () => {
  failProjectionUpdate = false;
  await db.delete(popularityOutbox).where(inArray(popularityOutbox.concertId, concertIds));
  await db.delete(concertFavorites).where(inArray(concertFavorites.concertId, concertIds));
  await testRedis.del(redisKeys);
  await testRedis.zAdd(popularityKey, concertIds.map((value) => ({ value, score: 0 })));
  await testRedis.zAdd(redisOnlyPopularityKey, concertIds.map((value) => ({ value, score: 0 })));
});

afterAll(async () => {
  await app.close();
  await db.delete(popularityOutbox).where(inArray(popularityOutbox.concertId, concertIds));
  await db.delete(concertFavorites).where(inArray(concertFavorites.concertId, concertIds));
  await db.delete(concerts).where(inArray(concerts.id, concertIds));
  await postgres.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [userIds]);
  await postgres.end();
  if (testRedis.isReady) {
    await testRedis.del(redisKeys);
    await testRedis.quit();
  } else if (testRedis.isOpen) {
    testRedis.destroy();
  }
});

function putFavorite(userId: string, concertId: string) {
  return app.inject({
    method: "PUT",
    url: `/api/me/favorites/${concertId}`,
    headers: { "x-test-user-id": userId },
  });
}

function putRedisOnlyFavorite(userId: string, concertId: string) {
  return app.inject({
    method: "PUT",
    url: `/api/me/redis-favorites/${concertId}`,
    headers: { "x-test-user-id": userId },
  });
}

async function favoriteCount(concertId: string) {
  const [row] = await db.select({ value: count() })
    .from(concertFavorites)
    .where(eq(concertFavorites.concertId, concertId));
  return row?.value ?? 0;
}

async function pendingEvents(concertId: string) {
  const [row] = await db.select({ value: count() })
    .from(popularityOutbox)
    .where(eq(popularityOutbox.concertId, concertId));
  return row?.value ?? 0;
}

async function drainTestOutbox() {
  let processed = 0;
  while (await processNextPopularityOutboxEvent(concertIds)) {
    if (++processed > 20) throw new Error("Unexpected number of outbox events");
  }
  return processed;
}

test("repeated favorite creates one PostgreSQL row and one leaderboard point", async () => {
  const first = await putFavorite(userIds[0]!, concertIds[0]!);
  const second = await putFavorite(userIds[0]!, concertIds[0]!);

  expect(first.statusCode).toBe(200);
  expect((first.json() as { added: boolean }).added).toBe(true);
  expect(second.statusCode).toBe(200);
  expect((second.json() as { added: boolean }).added).toBe(false);
  expect(await favoriteCount(concertIds[0]!)).toBe(1);
  expect(await pendingEvents(concertIds[0]!)).toBe(1);
  expect(await testRedis.zScore(popularityKey, concertIds[0]!)).toBe(0);
  expect(await drainTestOutbox()).toBe(1);
  expect(await testRedis.zScore(popularityKey, concertIds[0]!)).toBe(1);
});

test("a new outbox event wakes PostgreSQL listeners", async () => {
  const concertId = concertIds[0]!;
  const listener = new Client({ connectionString: env.databaseUrl });
  await listener.connect();

  try {
    await listener.query(`LISTEN ${popularityOutboxChannel}`);
    const notification = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Outbox notification timed out")), 2000);
      listener.on("notification", (message) => {
        if (message.channel === popularityOutboxChannel) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const response = await putFavorite(userIds[0]!, concertId);
    expect(response.statusCode).toBe(200);
    await notification;
    expect(await pendingEvents(concertId)).toBe(1);
  } finally {
    await listener.end();
  }
});

test("concurrent favorites from one user remain idempotent", async () => {
  const responses = await Promise.all(
    Array.from({ length: 20 }, () => putFavorite(userIds[0]!, concertIds[0]!)),
  );

  expect(responses.every((response) => response.statusCode === 200)).toBe(true);
  expect(responses.filter((response) => response.json().added === true)).toHaveLength(1);
  expect(await favoriteCount(concertIds[0]!)).toBe(1);
  expect(await pendingEvents(concertIds[0]!)).toBe(1);
  await drainTestOutbox();
  expect(await testRedis.zScore(popularityKey, concertIds[0]!)).toBe(1);
});

test("two users create two favorites", async () => {
  const responses = await Promise.all([
    putFavorite(userIds[0]!, concertIds[0]!),
    putFavorite(userIds[1]!, concertIds[0]!),
  ]);

  expect(responses.map((response) => response.json())).toEqual([{ added: true }, { added: true }]);
  expect(await favoriteCount(concertIds[0]!)).toBe(2);
  expect(await pendingEvents(concertIds[0]!)).toBe(2);
  await drainTestOutbox();
  expect(await testRedis.zScore(popularityKey, concertIds[0]!)).toBe(2);
});

test("an older count cannot overwrite a newer leaderboard score", async () => {
  await Promise.all([
    putFavorite(userIds[0]!, concertIds[0]!),
    putFavorite(userIds[1]!, concertIds[0]!),
  ]);

  await drainTestOutbox();

  await syncConcertPopularity(concertIds[0]!, 1);

  expect(await favoriteCount(concertIds[0]!)).toBe(2);
  expect(await testRedis.zScore(popularityKey, concertIds[0]!)).toBe(2);
});

test("unknown concert returns 404 without creating a favorite", async () => {
  const missingId = `test-${runId}-missing`;
  const response = await putFavorite(userIds[0]!, missingId);
  const redisOnlyResponse = await putRedisOnlyFavorite(userIds[0]!, missingId);

  expect(response.statusCode).toBe(404);
  expect(redisOnlyResponse.statusCode).toBe(404);
  expect(await favoriteCount(missingId)).toBe(0);
  expect(await pendingEvents(missingId)).toBe(0);
  expect(await testRedis.zScore(popularityKey, missingId)).toBeNull();
  expect(await testRedis.sIsMember(redisOnlyFavoritesKey(userIds[0]!), missingId)).toBe(0);
  expect(await testRedis.zScore(redisOnlyPopularityKey, missingId)).toBeNull();
});

test("favorite endpoint requires a session", async () => {
  const response = await app.inject({ method: "PUT", url: `/api/me/favorites/${concertIds[0]}` });
  const redisOnlyResponse = await app.inject({ method: "PUT", url: `/api/me/redis-favorites/${concertIds[0]}` });

  expect(response.statusCode).toBe(401);
  expect(redisOnlyResponse.statusCode).toBe(401);
  expect(await favoriteCount(concertIds[0]!)).toBe(0);
  expect(await pendingEvents(concertIds[0]!)).toBe(0);
});

test("failed Redis delivery leaves the outbox event for automatic retry", async () => {
  const first = await putFavorite(userIds[0]!, concertIds[0]!);

  expect(first.statusCode).toBe(200);
  expect((first.json() as { added: boolean }).added).toBe(true);
  expect(await favoriteCount(concertIds[0]!)).toBe(1);
  expect(await testRedis.zScore(popularityKey, concertIds[0]!)).toBe(0);
  expect(await pendingEvents(concertIds[0]!)).toBe(1);

  failProjectionUpdate = true;
  await expect(processNextPopularityOutboxEvent(concertIds)).rejects.toThrow("Simulated Redis update failure");
  failProjectionUpdate = false;

  expect(await pendingEvents(concertIds[0]!)).toBe(1);
  expect(await drainTestOutbox()).toBe(1);
  expect(await favoriteCount(concertIds[0]!)).toBe(1);
  expect(await testRedis.zScore(popularityKey, concertIds[0]!)).toBe(1);
  expect(await pendingEvents(concertIds[0]!)).toBe(0);
});

test("redelivered event sets the count instead of incrementing it twice", async () => {
  await putFavorite(userIds[0]!, concertIds[0]!);
  await drainTestOutbox();
  await db.insert(popularityOutbox).values({ concertId: concertIds[0]! });

  expect(await drainTestOutbox()).toBe(1);
  expect(await favoriteCount(concertIds[0]!)).toBe(1);
  expect(await testRedis.zScore(popularityKey, concertIds[0]!)).toBe(1);
});

test("top three keeps Redis order and includes PostgreSQL concert details", async () => {
  await Promise.all([
    putFavorite(userIds[0]!, concertIds[1]!),
    putFavorite(userIds[1]!, concertIds[1]!),
    putFavorite(userIds[2]!, concertIds[1]!),
    putFavorite(userIds[0]!, concertIds[3]!),
    putFavorite(userIds[1]!, concertIds[3]!),
    putFavorite(userIds[0]!, concertIds[0]!),
  ]);
  await drainTestOutbox();

  const response = await app.inject({ method: "GET", url: "/api/concerts/popular" });
  const top = response.json() as Array<{ id: string; title: string; favoritesCount: number }>;

  expect(response.statusCode).toBe(200);
  expect(top.map((concert) => concert.id)).toEqual([concertIds[1]!, concertIds[3]!, concertIds[0]!]);
  expect(top.map((concert) => concert.favoritesCount)).toEqual([3, 2, 1]);
  expect(top[0]?.title).toBe(`Test ${concertIds[1]}`);
});

test("leaderboard can be rebuilt from PostgreSQL after Redis data is lost", async () => {
  await putFavorite(userIds[0]!, concertIds[0]!);
  await putFavorite(userIds[1]!, concertIds[0]!);
  await drainTestOutbox();
  await testRedis.del(popularityKey);

  await rebuildConcertPopularity();

  expect(await favoriteCount(concertIds[0]!)).toBe(2);
  expect(await testRedis.zScore(popularityKey, concertIds[0]!)).toBe(2);
  expect(await testRedis.zScore(popularityKey, concertIds[1]!)).toBe(0);
});

test("Redis-only favorite is idempotent and does not write to PostgreSQL", async () => {
  const first = await putRedisOnlyFavorite(userIds[0]!, concertIds[0]!);
  const second = await putRedisOnlyFavorite(userIds[0]!, concertIds[0]!);

  expect(first.statusCode).toBe(200);
  expect((first.json() as { added: boolean }).added).toBe(true);
  expect(second.statusCode).toBe(200);
  expect((second.json() as { added: boolean }).added).toBe(false);
  expect(await testRedis.sCard(redisOnlyFavoritesKey(userIds[0]!))).toBe(1);
  expect(await testRedis.zScore(redisOnlyPopularityKey, concertIds[0]!)).toBe(1);
  expect(await favoriteCount(concertIds[0]!)).toBe(0);
  expect(await pendingEvents(concertIds[0]!)).toBe(0);
  expect(await testRedis.zScore(popularityKey, concertIds[0]!)).toBe(0);
});

test("concurrent Redis-only favorites from one user increase the score once", async () => {
  const responses = await Promise.all(
    Array.from({ length: 20 }, () => putRedisOnlyFavorite(userIds[0]!, concertIds[0]!)),
  );

  expect(responses.every((response) => response.statusCode === 200)).toBe(true);
  expect(responses.filter((response) => response.json().added === true)).toHaveLength(1);
  expect(await testRedis.sCard(redisOnlyFavoritesKey(userIds[0]!))).toBe(1);
  expect(await testRedis.zScore(redisOnlyPopularityKey, concertIds[0]!)).toBe(1);
  expect(await favoriteCount(concertIds[0]!)).toBe(0);
});

test("Redis-only sorted set ranks concerts independently", async () => {
  await Promise.all([
    putRedisOnlyFavorite(userIds[0]!, concertIds[1]!),
    putRedisOnlyFavorite(userIds[1]!, concertIds[1]!),
    putRedisOnlyFavorite(userIds[2]!, concertIds[1]!),
    putRedisOnlyFavorite(userIds[0]!, concertIds[3]!),
    putRedisOnlyFavorite(userIds[1]!, concertIds[3]!),
    putRedisOnlyFavorite(userIds[0]!, concertIds[0]!),
  ]);

  const top = await testRedis.zRangeWithScores(redisOnlyPopularityKey, 0, 2, { REV: true });

  expect(top.map(({ value }) => value)).toEqual([concertIds[1]!, concertIds[3]!, concertIds[0]!]);
  expect(top.map(({ score }) => score)).toEqual([3, 2, 1]);
  expect(await favoriteCount(concertIds[1]!)).toBe(0);
});
