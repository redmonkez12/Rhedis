# Concerts — Redis Practice Backend

A TypeScript backend for exploring Redis through a concert application: user favorites, popularity rankings, and temporary seat reservations.

Built as a hands-on learning project for the **Redis Associate Developer certification, JavaScript track**, using **node-redis**.

## Project status

The first exercise is complete: ten sample concerts, user favorites, and a top-three popularity ranking. Adding the same concert to a user's favorites again does not increase its score. A separate script demonstrates pipelines and optimistic ticket purchases with `WATCH`.

Temporary seat reservations are available under `/api/v1`. This is a learning project under active development.

## Stack

| Technology | Purpose |
| --- | --- |
| TypeScript | Application code |
| Bun | Runtime and package management |
| Fastify | HTTP API |
| LogTape | Structured application and HTTP logging |
| Better Auth | Authentication and session handling |
| PostgreSQL | Authentication, concerts, halls, seats, and favorites |
| Redis | Favorites, rankings, temporary seat reservations, and recent activity |
| node-redis (`redis`) | Redis client for JavaScript and TypeScript |
| Docker Compose | Local infrastructure |

The target local environment is **Redis 8**. This is a project choice, not a claim that the certification requires a particular server version.

## Features

- Ten sample concerts, each linked to a hall with seats A1–A5.
- Favorites associated with the authenticated user.
- Unique favorites per user and concert.
- Popularity ranking based on the number of users who added a concert to their favorites.
- Top-three concert lookup.
- An atomic Redis operation that adds a favorite and increments popularity only when that favorite is new.
- Temporary seat reservations with a 60-second expiration and a status endpoint.
- The authenticated user's 20 most recent successful actions.
- Public concert detail cached in Redis for 60 seconds.

### Concert detail cache

`GET /api/v1/concerts/:concertId` first checks `app:cache:concert:<id>`. On a miss, it reads PostgreSQL and caches a found concert for 60 seconds. Missing concerts return `404` and are not cached. LogTape records `cache hit`, `cache miss`, and each PostgreSQL detail read with a process-local `detailPostgresReads` count. The count resets when the process restarts.

An authorized venue admin can change a concert's title, start time, or both with `PATCH /api/v1/concerts/:concertId` and a JSON body such as `{ "title": "New title", "startsAt": "2027-02-02T20:30:00Z" }`. The PostgreSQL transaction commits before the endpoint deletes that concert's Redis cache key. The next sequential GET misses the cache and reads the updated detail. A missing concert returns `404` without deleting a cache entry.

TTL limits how long a cached detail can remain without another write; invalidation makes a sequential read see an update immediately after the commit. Neither guarantees consistency when requests overlap. The integration test reproduces this order:

1. Reader A misses the cache and reads the old title from PostgreSQL, then pauses before writing to Redis.
2. Request B commits a new title in PostgreSQL and deletes the cache key.
3. Reader A resumes and writes its old snapshot to Redis with a fresh 60-second TTL. A later GET returns the old title even though PostgreSQL contains the new one.

Deleting the key cannot cancel a read already in flight. This exercise demonstrates the race but does not prevent it. If Redis deletion fails after a commit, the cached value can also remain until its TTL expires. A test checks the initial 60-second TTL and shortens it to one second to exercise expiration without making every test wait a full minute.

## Halls and seats

`halls` stores a hall's name and city once. `hall_seats` stores its seat IDs, with `(hall_id, seat_id)` as the primary key. Each concert references a hall through `concerts.hall_id`; seats in the same hall can therefore be used by multiple concerts. Temporary reservations remain scoped to a concert and seat in Redis.

Run `bun run db:migrate` before `bun run db:seed`. The migration links existing concerts to halls based on their former venue and city fields. The seed adds the ten demo halls and A1–A5 for each, then inserts any missing demo concerts. It also creates three Better Auth demo users. Repeating the seed does not duplicate halls, seats, concerts, or users.

The demo users are `alice@example.test`, `bob@example.test`, and `carol@example.test`. All use the password `TestPass123!` by default. Set `SEED_USER_PASSWORD` when running the seed to choose another password for newly created users. Existing accounts and their passwords are left as they are. The seed refuses to run with `NODE_ENV=production` because these accounts have known credentials.

### Venue layout in RedisJSON

Run `bun run venue:seed-layout` to save the Main Hall layout under `app:venue:<hall UUID>:layout`. Layout reads are public. Editing a seat category or appending a seat through `/api/v1/halls/:id` requires a signed-in user whose Better Auth user ID is listed in `VENUE_ADMIN_USER_IDS` (comma-separated in `.env`). An empty list denies all layout writes. Use `/api/v1/me` to see your user ID.

Appending a seat adds its ID to `hall_seats` in PostgreSQL and its properties to RedisJSON, so the reservation routes can recognize it. A duplicate seat ID in the hall returns `409`; a missing layout or section returns `404`. Temporary reservations remain separate Redis string keys with their own expiration.

## Redis data model

The following names illustrate the key convention; the application's key helpers define the actual names.

| Key example | Type | Contents |
| --- | --- | --- |
| `app:user:<userId>:favorites` | Set | Unique concert IDs favorited by a user |
| `app:concerts:popularity` | Sorted set | Concert IDs scored by favorite count |
| `app:concert:<concertId>:seat:<seatId>:reservation` | String | Serialized reservation with a 60-second expiration |
| `app:cache:concert:<concertId>` | String | Serialized concert detail with a 60-second expiration |
| `app:user:<userId>:activity` | List | The 20 most recent activities, newest first |

### Favorites and popularity

The initial Redis exercise uses a Lua script to perform two related operations:

1. Add the concert ID to the user's favorites with `SADD`.
2. Increment its popularity with `ZINCRBY` only if `SADD` reports a new member.

Other clients cannot interleave commands during script execution. This keeps successful concurrent additions from counting the same user's favorite twice.

**Atomic execution does not provide rollback:** if a script fails after a write, earlier writes are not automatically undone. Key types and script inputs must be valid before dependent writes run.

The user's identity comes from the verified session, rather than a user ID supplied in the request body.

### Recent activity

`GET /api/v1/me/activities?offset=0&limit=10` returns the signed-in user's activities, newest first. `offset` defaults to 0 and `limit` to 10 (maximum 20). An empty list returns `[]`. Each entry has a unique `id`, a `type` (`favorite_added`, `reservation_created`, or `reservation_cancelled`), `concertId`, and ISO `createdAt` timestamp. Adding either kind of favorite records an activity only when it was newly added. Successful reservation creation and cancellation also record activities; duplicate favorites, occupied seats, and rejected cancellations do not.

For each activity, Redis runs `LPUSH` followed by `LTRIM key 0 19` in one `MULTI/EXEC` transaction. `LRANGE key offset (offset + limit - 1)` reads a page. The transaction prevents concurrent writers from leaving more than 20 entries.

This bounded list is **not a complete audit history**: `LTRIM` permanently discards older entries, Redis data can be evicted or lost, and writing the activity after the underlying PostgreSQL or reservation operation is not part of the same transaction. If the history write fails, the successful action still returns success and the missing entry is logged. Use a durable event log or database table when every action must be retained and reconstructable.

## Local development

Prerequisites: Bun, Docker, and Docker Compose.

> Setup commands below follow the planned skeleton conventions. Confirm script names, environment variable names, migration commands, and the API port against the repository before using them.

Install dependencies:

```bash
bun install
```

Create a local configuration from the repository's example:

```bash
cp .env.example .env
```

Configure the PostgreSQL and Redis connection URLs, Better Auth secret and base URL, and any allowed frontend origin. Use a generated secret and keep `.env` out of version control.

LogTape writes JSON lines to the console for the API, worker, and maintenance scripts. Set `LOG_LEVEL` in `.env` to `trace`, `debug`, `info` (default), `warning`, `error`, or `fatal` to control verbosity.

Start the databases:

```bash
docker compose up -d
```

Open Adminer at `http://localhost:8080` to inspect PostgreSQL. Select **PostgreSQL**, use `postgres` as the server, and sign in with `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` from `.env`. Set `ADMINER_PORT` in `.env` if port 8080 is already in use.

Apply the repository's authentication/database migrations before starting the API. Use the configured migration workflow if an ORM such as Drizzle manages the schema.

Start development mode, assuming the skeleton's `dev` script is present:

```bash
bun run dev
```

Run TypeScript checks, assuming the skeleton's `typecheck` script is present:

```bash
bun run typecheck
```

Run integration tests with PostgreSQL and Redis available:

```bash
bun run test
```

The test command creates a separate temporary PostgreSQL database, applies the Better Auth and Drizzle migrations, runs the tests, and removes the database afterward. The database user in `DATABASE_URL` needs permission to create databases. Redis test keys use a unique prefix. The development outbox worker can keep running because it cannot read the temporary test database. Run tests through this command rather than calling `bun test` directly.

## API examples

These examples assume the API runs at `http://localhost:3100`.
Application routes use the `/api/v1` prefix; Better Auth stays at `/api/auth` and health at `/health`.

### WebStorm HTTP Client

Open `api.http`, choose the `local` environment, and click the green run icon next to `signIn`. After that, run `me`, `addFavorite`, `addRedisFavorite`, `recentActivities`, `popularConcerts`, `reserveSeatA1`, or `seatA1ReservationStatus` with one click. WebStorm saves the session cookie and sends it to the same local API automatically.

Edit `http-client.env.json` to change the API URL, demo email, or concert ID. The password is in the Git-ignored `http-client.private.env.json`; change it there if your seeded users have a different password. If the API is not running yet, start it with `bun run dev`. Run `reserveSeatA1` before `seatA1ReservationStatus` to see the remaining time.

### cURL

Sign in as a demo user and save the session cookie:

```bash
curl -c cookies.txt -X POST http://localhost:3100/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.test","password":"TestPass123!"}'
```

If you seeded with `SEED_USER_PASSWORD`, use that password instead.

Read the current user:

```bash
curl -b cookies.txt http://localhost:3100/api/v1/me
```

Add a concert to favorites:

```bash
curl -X PUT -b cookies.txt \
  http://localhost:3100/api/v1/me/favorites/concert-01
```

Repeat the request to check that the popularity score does not increase again.

## Temporary seat reservations

These endpoints require a Better Auth session and a seat belonging to the concert's hall:

```text
POST /api/v1/concerts/:concertId/seats/:seatId/reservation
GET  /api/v1/concerts/:concertId/seats/:seatId/reservation
DELETE /api/v1/concerts/:concertId/seats/:seatId/reservations/:reservationId
```

The POST stores the authenticated user's ID and a unique reservation ID as a JSON string in Redis. One `SET` with `NX` and `EX 60` creates the hold and its expiration atomically. It returns `201` with `reservationId`, or `409` when the seat is already held, including by the same user. A rejected attempt does not extend the existing hold.

The GET returns `reserved` and `remainingSeconds` from Redis `TTL`. A missing key (`-2`) means the seat is free; a key without expiration (`-1`) is treated as a server error. Once the key expires, another POST can reserve the seat. The unversioned `/api/concerts/...` path is intentionally not exposed.

The DELETE cancels the reservation only when both its ID and owner match. A Redis script checks and removes the key atomically, so an expired reservation cannot cause a newer hold to be deleted. It returns `204` on success, `404` for a missing or expired reservation, `403` when another user owns the current reservation, and `409` when the owner supplies an outdated reservation ID.

This exercise models temporary holds only. Payments and permanent ticket ownership are outside its scope.

## Verification checklist

These are expected behaviors to verify, not a report of automated test results.

- [ ] Adding a new favorite increases popularity by one.
- [ ] Repeating the same favorite request leaves popularity unchanged.
- [ ] A different user's favorite increases popularity independently.
- [ ] Concurrent duplicate requests create only one favorite contribution.
- [ ] The ranking returns the three highest-scoring concerts, or fewer if fewer are ranked.
- [ ] Unauthenticated favorite requests are rejected.
- [ ] Simultaneous requests for the same free seat have exactly one winner.
- [ ] Rejected requests do not refresh reservation TTL.
- [ ] An expired reservation no longer blocks a new one.
- [ ] Canceling an expired reservation does not remove a newer hold.
- [ ] After 25 activity writes, only activities 25–6 remain; pages of 10 return 25–16 and 15–6.
- [ ] Users without activity get `[]`, users' histories stay separate, and concurrent writes retain at most 20 entries.

## Further learning goals

- Model nested venue layouts with RedisJSON.
- Practice cache-aside reads and invalidation.
- Compare transactions and Lua scripts.
- Explore persistence, eviction, and recovery behavior.

## Pipelines and transactions exercise

Run `bun run redis:pipelines-transactions` with Redis running and `REDIS_URL` set (for example, via `.env`). The script writes 1,000 identical test concerts under each of `app:exercise:pipelines-transactions:sequential` and `app:exercise:pipelines-transactions:pipeline`, measures the two write loops, and verifies every stored value. The measured time excludes verification; it is a local comparison, not a guaranteed speedup.

It then resets `app:exercise:pipelines-transactions:tickets:last-tickets:{available,sold}` to 10 and 0 and starts 50 simultaneous purchases. `buyTicket(concertId)` uses a dedicated pool connection for `WATCH`, the stock read, and `MULTI/EXEC`, with at most 50 attempts per purchase. The output distinguishes purchases, sold-out responses, and attempts exhausted by conflicts. The script checks that stock is nonnegative, `available = 10 - purchases`, and `sold = purchases`; a failed check exits with an error. The exercise keys remain in Redis for inspection, and a later run overwrites them.

`execAsPipeline()` batches commands to reduce round trips but provides no isolation between clients. `exec()` executes a Redis transaction; paired with `WATCH`, it aborts if another client changes the observed ticket state before the transaction commits.

## Resources

- [Redis Associate Developer certification](https://redis.io/certifications/developer/)
- [Redis JavaScript client documentation](https://redis.io/docs/latest/develop/clients/nodejs/)
- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Better Auth documentation](https://better-auth.com/docs)
