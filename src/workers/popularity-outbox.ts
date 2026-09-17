import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { env } from "#src/config/env";
import { popularityOutboxChannel } from "#src/db/outbox-channel";
import { postgres } from "#src/db/postgres";
import { redis } from "#src/db/redis";
import { processNextPopularityOutboxEvent } from "#src/services/popularity-outbox";

const fallbackPollMs = 30_000;
const retryMs = 1_000;

// Single consumer: notifications are remembered even while it is processing.
function createWakeSignal(signal: AbortSignal) {
  let version = 0;
  let waiter: (() => void) | undefined;

  return {
    get version() { return version; },
    notify() {
      version++;
      waiter?.();
    },
    wait(observedVersion: number): Promise<void> {
      if (signal.aborted || version !== observedVersion) return Promise.resolve();
      if (waiter) throw new Error("Only one wake waiter is supported.");

      return new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          waiter = undefined;
          resolve();
        };
        const timer = setTimeout(finish, fallbackPollMs);
        waiter = finish;
        signal.addEventListener("abort", finish, { once: true });
      });
    },
  };
}

// Notifications cannot shorten retry delays; shutdown can.
async function waitBeforeRetry(signal: AbortSignal): Promise<void> {
  try {
    await delay(retryMs, undefined, { signal });
  } catch (error) {
    if (!(signal.aborted && error instanceof Error && error.name === "AbortError")) {
      throw error;
    }
  }
}

async function runListenerSession(signal: AbortSignal): Promise<void> {
  const listener = new Client({
    connectionString: env.databaseUrl,
    connectionTimeoutMillis: 3_000,
  });
  const wake = createWakeSignal(signal);
  let disconnected = false;
  const isRunning = () => !signal.aborted && !disconnected;

  const onDisconnect = () => {
    disconnected = true;
    wake.notify();
  };
  listener.on("notification", (message) => {
    if (message.channel === popularityOutboxChannel) wake.notify();
  });
  listener.on("error", (error) => {
    if (!signal.aborted) console.error("Outbox listener connection lost:", error);
    onDisconnect();
  });
  listener.on("end", onDisconnect);

  try {
    await listener.connect();
    if (!isRunning()) return;

    // LISTEN must be active before the first outbox scan.
    const channel = '"' + popularityOutboxChannel.replace(/"/g, '""') + '"';
    await listener.query(`LISTEN ${channel}`);
    console.info("Popularity outbox listener ready.");

    while (isRunning()) {
      const observedVersion = wake.version;

      try {
        // Keep processing immediately while there are pending events.
        if (await processNextPopularityOutboxEvent()) continue;
      } catch (error) {
        if (!isRunning()) break;
        console.error("Outbox delivery failed; will retry:", error);
        await waitBeforeRetry(signal);
        continue;
      }

      // If a notification arrived during the scan, this returns immediately.
      if (isRunning()) await wake.wait(observedVersion);
    }
  } finally {
    await listener.end().catch((error) => {
      console.error("Could not close outbox listener:", error);
    });
  }
}

async function closeConnections(): Promise<void> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => postgres.end()),
    Promise.resolve().then(async () => {
      if (redis.isReady) await redis.quit();
      else if (redis.isOpen) redis.destroy();
    }),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Could not close worker connection:", result.reason);
      process.exitCode = 1;
    }
  }
}

async function main(): Promise<void> {
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    await redis.connect();
    while (!shutdown.signal.aborted) {
      try {
        await runListenerSession(shutdown.signal);
      } catch (error) {
        if (!shutdown.signal.aborted) {
          console.error("Outbox listener failed; will reconnect:", error);
        }
      }
      if (!shutdown.signal.aborted) await waitBeforeRetry(shutdown.signal);
    }
  } catch (error) {
    console.error("Popularity outbox worker failed:", error);
    process.exitCode = 1;
  } finally {
    try {
      await closeConnections();
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  }
}

await main();
