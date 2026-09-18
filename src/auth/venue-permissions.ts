import { env } from "#src/config/env";

export function requireVenueAdmin(userId: string): void {
  if (!env.venueAdminUserIds.has(userId)) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }
}
