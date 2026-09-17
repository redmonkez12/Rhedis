import { betterAuth } from "better-auth";
import { env } from "#src/config/env";
import { postgres } from "#src/db/postgres";
import { secondaryStorage } from "#src/auth/secondary-storage";

export const auth = betterAuth({
  baseURL: env.authUrl,
  secret: env.authSecret,
  database: postgres,
  secondaryStorage,
  trustedOrigins: [env.frontendOrigin],
  emailAndPassword: { enabled: true },
  rateLimit: { storage: "secondary-storage" },
});

