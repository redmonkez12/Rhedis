import { getLogger } from "@logtape/logtape";
import { Client } from "pg";
import { configureLogging } from "#src/logging";

const logger = getLogger(["redis-practice", "script", "run-tests"]);
configureLogging();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";

const testDatabaseName = `redis_practice_test_${crypto.randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(databaseUrl);
testUrl.pathname = `/${testDatabaseName}`;

const testEnv = {
  ...process.env,
  DATABASE_URL: testUrl.toString(),
  REDIS_PRACTICE_TEST_DATABASE: testDatabaseName,
};

async function run(args: string[]): Promise<void> {
  const command = Bun.spawn({
    cmd: [process.execPath, ...args],
    env: testEnv,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await command.exited;
  if (exitCode !== 0) throw new Error(`${args.join(" ")} exited with code ${exitCode}`);
}

const admin = new Client({ connectionString: adminUrl.toString() });
await admin.connect();
let databaseCreated = false;

try {
  await admin.query(`CREATE DATABASE "${testDatabaseName}"`);
  databaseCreated = true;
  await run(["run", "auth:migrate"]);
  await run(["run", "db:migrate"]);
  await run(["test", ...process.argv.slice(2)]);
} catch (error) {
  logger.error("Integration test setup or execution failed", { error });
  process.exitCode = 1;
} finally {
  try {
    if (databaseCreated) {
      await admin.query(`DROP DATABASE "${testDatabaseName}" WITH (FORCE)`);
    }
  } catch (error) {
    logger.error("Could not remove temporary test database", { error });
    process.exitCode = 1;
  } finally {
    await admin.end();
  }
}
