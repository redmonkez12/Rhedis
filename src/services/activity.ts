import { getLogger } from "@logtape/logtape";
import { redis } from "#src/db/redis";
import { userActivityKey } from "#src/redis/keys";

const logger = getLogger(["redis-practice", "activity"]);

export type Activity = {
  id: string;
  type: "favorite_added" | "reservation_created" | "reservation_cancelled";
  concertId: string;
  createdAt: string;
};

export async function recordActivity(userId: string, activity: Activity): Promise<void> {
  const key = userActivityKey(userId);
  await redis.multi()
    .lPush(key, JSON.stringify(activity))
    .lTrim(key, 0, 19)
    .exec();
}

export async function recordCompletedActivity(userId: string, type: Activity["type"], concertId: string): Promise<void> {
  try {
    await recordActivity(userId, {
      id: crypto.randomUUID(), type, concertId, createdAt: new Date().toISOString(),
    });
  } catch (error) {
    // The action already succeeded; a missing history entry must not turn its response into a failure.
    logger.error("Could not record recent activity", { error, userId, type, concertId });
  }
}

export async function getRecentActivities(userId: string, offset: number, limit: number): Promise<Activity[]> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("Activity offset must be nonnegative and limit must be positive integers");
  }
  const entries = await redis.lRange(userActivityKey(userId), offset, offset + limit - 1);
  return entries.map((entry) => JSON.parse(entry) as Activity);
}
