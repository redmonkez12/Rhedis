import { createClient, createClientPool, WatchError } from "redis";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required");

const prefix = "app:exercise:pipelines-transactions";
const concertCount = 1_000;
const batchSize = 100;
const initialTickets = 10;
const purchaseAttempts = 50;
const maxAttempts = 50;
const testConcertId = "last-tickets";

const client = createClient({ url: redisUrl, disableOfflineQueue: true });
const pool = createClientPool(
  { url: redisUrl, disableOfflineQueue: true },
  { minimum: 1, maximum: purchaseAttempts },
);

client.on("error", (error) => console.error("Redis client error:", error));
pool.on("error", (error) => console.error("Redis pool error:", error));

const concert = (number: number) => JSON.stringify({
  id: `test-concert-${String(number).padStart(4, "0")}`,
  title: `Test concert ${number}`,
  startsAt: new Date(Date.UTC(2027, 0, 1 + number, 19)).toISOString(),
});

const concertKey = (method: "sequential" | "pipeline", number: number) =>
  `${prefix}:${method}:concert:${String(number).padStart(4, "0")}`;

const ticketKeys = (concertId: string) => ({
  available: `${prefix}:tickets:${encodeURIComponent(concertId)}:available`,
  sold: `${prefix}:tickets:${encodeURIComponent(concertId)}:sold`,
});

type PurchaseResult = {
  status: "bought" | "sold_out" | "retry_exhausted";
  attempts: number;
  conflicts: number;
};

async function writeSequentially(): Promise<number> {
  const start = performance.now();
  for (let number = 1; number <= concertCount; number++) {
    await client.set(concertKey("sequential", number), concert(number));
  }
  return performance.now() - start;
}

async function writeAsPipelines(): Promise<number> {
  const start = performance.now();
  for (let first = 1; first <= concertCount; first += batchSize) {
    const pipeline = client.multi();
    for (let number = first; number < first + batchSize && number <= concertCount; number++) {
      pipeline.set(concertKey("pipeline", number), concert(number));
    }
    await pipeline.execAsPipeline();
  }
  return performance.now() - start;
}

async function verifyConcerts(): Promise<void> {
  for (let first = 1; first <= concertCount; first += batchSize) {
    const numbers = Array.from(
      { length: Math.min(batchSize, concertCount - first + 1) },
      (_, index) => first + index,
    );
    const sequential = await client.mGet(numbers.map((number) => concertKey("sequential", number)));
    const pipelined = await client.mGet(numbers.map((number) => concertKey("pipeline", number)));

    for (const [index, number] of numbers.entries()) {
      const expected = concert(number);
      if (sequential[index] !== expected || pipelined[index] !== expected) {
        throw new Error(`Concert ${number} is missing or differs between the two writes`);
      }
    }
  }
}

// The entire WATCH -> read -> MULTI/EXEC sequence, including retries, owns one pool connection.
async function buyTicket(concertId: string): Promise<PurchaseResult> {
  const keys = ticketKeys(concertId);

  return pool.execute(async (connection) => {
    let conflicts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await connection.watch([keys.available, keys.sold]);
      try {
        const raw = await connection.get(keys.available);
        if (raw === null) throw new Error(`Ticket stock is not initialized for ${concertId}`);

        const available = Number(raw);
        if (!Number.isSafeInteger(available) || available < 0) {
          throw new Error(`Invalid ticket stock for ${concertId}: ${raw}`);
        }
        if (available === 0) return { status: "sold_out", attempts: attempt, conflicts };

        try {
          // exec() sends MULTI/EXEC. If a watched key changed, it throws WatchError.
          const [remaining] = await connection.multi().decr(keys.available).incr(keys.sold).exec();
          if (typeof remaining !== "number" || remaining < 0) {
            throw new Error(`Ticket stock became invalid after purchase: ${String(remaining)}`);
          }
          return { status: "bought", attempts: attempt, conflicts };
        } catch (error) {
          if (!(error instanceof WatchError)) throw error;
          conflicts++;
        }
      } finally {
        // In particular, clear WATCH when returning early because the concert sold out.
        await connection.unwatch();
      }
    }

    return { status: "retry_exhausted", attempts: maxAttempts, conflicts };
  });
}

try {
  await client.connect();
  await pool.connect();

  const sequentialMs = await writeSequentially();
  const pipelineMs = await writeAsPipelines();
  await verifyConcerts();
  console.log(`Verified ${concertCount} identical concerts in each prefix (${prefix}).`);
  console.log(`Sequential SET: ${sequentialMs.toFixed(1)} ms`);
  console.log(`Pipeline SET (${batchSize} per batch): ${pipelineMs.toFixed(1)} ms`);
  console.log(`Sequential / pipeline time ratio: ${(sequentialMs / pipelineMs).toFixed(1)}x`);

  const keys = ticketKeys(testConcertId);
  await client.multi().set(keys.available, String(initialTickets)).set(keys.sold, "0").exec();

  const results = await Promise.all(
    Array.from({ length: purchaseAttempts }, () => buyTicket(testConcertId)),
  );
  const bought = results.filter((result) => result.status === "bought").length;
  const soldOut = results.filter((result) => result.status === "sold_out").length;
  const retryExhausted = results.filter((result) => result.status === "retry_exhausted").length;
  const conflicts = results.reduce((total, result) => total + result.conflicts, 0);
  const [availableRaw, soldRaw] = await client.mGet([keys.available, keys.sold]);
  const available = Number(availableRaw);
  const sold = Number(soldRaw);

  if (
    bought + soldOut + retryExhausted !== purchaseAttempts ||
    bought > initialTickets ||
    available < 0 ||
    available !== initialTickets - bought ||
    sold !== bought
  ) {
    throw new Error(`Ticket invariants failed: ${JSON.stringify({ bought, soldOut, retryExhausted, available, sold })}`);
  }

  console.log(`Purchases: ${bought} bought, ${soldOut} sold out, ${retryExhausted} retry exhausted (${conflicts} WATCH conflicts)`);
  console.log(`Tickets: ${available} available, ${sold} sold (verified)`);
} finally {
  await pool.close();
  if (client.isReady) await client.quit();
  else if (client.isOpen) client.destroy();
}
