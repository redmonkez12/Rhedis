# Concerts — Redis Practice Backend

A TypeScript backend for exploring Redis through a concert application: user favorites, popularity rankings, and temporary seat reservations.

Built as a hands-on learning project for the **Redis Associate Developer certification, JavaScript track**, using **node-redis**.

## Project status

The first exercise is complete: ten sample concerts, user favorites, and a top-three popularity ranking. Adding the same concert to a user's favorites again does not increase its score.

Temporary seat reservations are the next exercise. This is a learning project under active development.

## Stack

| Technology | Purpose |
| --- | --- |
| TypeScript | Application code |
| Bun | Runtime and package management |
| Fastify | HTTP API |
| Better Auth | Authentication and session handling |
| PostgreSQL | Authentication, concerts, halls, seats, and favorites |
| Redis | Favorites, rankings, and upcoming reservation exercises |
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

## Halls and seats

`halls` stores a hall's name and city once. `hall_seats` stores its seat IDs, with `(hall_id, seat_id)` as the primary key. Each concert references a hall through `concerts.hall_id`; seats in the same hall can therefore be used by multiple concerts. Temporary reservations remain scoped to a concert and seat in Redis.

Run `bun run db:migrate` before `bun run db:seed`. The migration links existing concerts to halls based on their former venue and city fields. The seed adds the ten demo halls and A1–A5 for each, then inserts any missing demo concerts. It also creates three Better Auth demo users. Repeating the seed does not duplicate halls, seats, concerts, or users.

The demo users are `alice@example.test`, `bob@example.test`, and `carol@example.test`. All use the password `TestPass123!` by default. Set `SEED_USER_PASSWORD` when running the seed to choose another password for newly created users. Existing accounts and their passwords are left as they are. The seed refuses to run with `NODE_ENV=production` because these accounts have known credentials.

## Redis data model

The following names illustrate the key convention; the application's key helpers define the actual names.

| Key example | Type | Contents |
| --- | --- | --- |
| `app:user:<userId>:favorites` | Set | Unique concert IDs favorited by a user |
| `app:concerts:popularity` | Sorted set | Concert IDs scored by favorite count |
| `app:concert:<concertId>:seat:<seatId>:reservation` | String, planned | Serialized reservation with an expiration |

### Favorites and popularity

The initial Redis exercise uses a Lua script to perform two related operations:

1. Add the concert ID to the user's favorites with `SADD`.
2. Increment its popularity with `ZINCRBY` only if `SADD` reports a new member.

Other clients cannot interleave commands during script execution. This keeps successful concurrent additions from counting the same user's favorite twice.

**Atomic execution does not provide rollback:** if a script fails after a write, earlier writes are not automatically undone. Key types and script inputs must be valid before dependent writes run.

The user's identity comes from the verified session, rather than a user ID supplied in the request body.

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

## API examples

These examples assume the API runs at `http://localhost:3100`.

### WebStorm HTTP Client

Open `api.http`, choose the `local` environment, and click the green run icon next to `signIn`. After that, run `me`, `addFavorite`, `addRedisFavorite`, or `popularConcerts` with one click. WebStorm saves the session cookie and sends it to the same local API automatically.

Edit `http-client.env.json` to change the API URL, demo email, or concert ID. The password is in the Git-ignored `http-client.private.env.json`; change it there if your seeded users have a different password. If the API is not running yet, start it with `bun run dev`. The seat reservation endpoint is still unfinished, so it is not included in the runnable requests.

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
curl -b cookies.txt http://localhost:3100/api/me
```

Add a concert to favorites:

```bash
curl -X PUT -b cookies.txt \
  http://localhost:3100/api/me/favorites/concert-01
```

Repeat the request to check that the popularity score does not increase again.

## Next exercise: temporary seat reservations

- Reserve an existing seat for 60 seconds.
- Use a single `SET` operation with `NX` and `EX`.
- Store the authenticated user's ID and a unique reservation ID.
- Return `201` for a new reservation and `409` if the seat is already held.
- Keep the existing expiration unchanged when a reservation attempt is rejected.
- Expose the remaining reservation time.
- Allow the seat to be reserved again after expiration.

This exercise models temporary holds only. Payments and permanent ticket ownership are outside its scope.

## Verification checklist

These are expected behaviors to verify, not a report of automated test results.

- [ ] Adding a new favorite increases popularity by one.
- [ ] Repeating the same favorite request leaves popularity unchanged.
- [ ] A different user's favorite increases popularity independently.
- [ ] Concurrent duplicate requests create only one favorite contribution.
- [ ] The ranking returns the three highest-scoring concerts, or fewer if fewer are ranked.
- [ ] Unauthenticated favorite requests are rejected.
- [ ] Planned: simultaneous requests for the same free seat have exactly one winner.
- [ ] Planned: rejected requests do not refresh reservation TTL.
- [ ] Planned: an expired reservation no longer blocks a new one.

## Further learning goals

- Safely cancel a reservation using its owner and reservation ID.
- Model nested venue layouts with RedisJSON.
- Practice cache-aside reads and invalidation.
- Compare pipelines, transactions, and Lua scripts.
- Explore persistence, eviction, and recovery behavior.

## Resources

- [Redis Associate Developer certification](https://redis.io/certifications/developer/)
- [Redis JavaScript client documentation](https://redis.io/docs/latest/develop/clients/nodejs/)
- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Better Auth documentation](https://better-auth.com/docs)
