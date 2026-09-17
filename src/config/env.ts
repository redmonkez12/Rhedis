function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function url(name: string, protocols: string[]): string {
  const value = required(name);
  try {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol)) throw new Error("Invalid protocol");
  } catch {
    throw new Error(`${name} must be a valid ${protocols.join(" or ")} URL`);
  }
  return value;
}

function origin(name: string): string {
  const value = url(name, ["http:", "https:"]);
  const parsed = new URL(value);
  if (value !== parsed.origin) throw new Error(`${name} must be an origin without path or trailing slash`);
  return value;
}

const secret = required("BETTER_AUTH_SECRET");
if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");

const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

export const env = {
  port,
  databaseUrl: url("DATABASE_URL", ["postgres:", "postgresql:"]),
  redisUrl: url("REDIS_URL", ["redis:", "rediss:"]),
  authUrl: origin("BETTER_AUTH_URL"),
  frontendOrigin: origin("FRONTEND_ORIGIN"),
  authSecret: secret,
};

