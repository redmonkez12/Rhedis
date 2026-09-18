import { db } from "#src/db/drizzle";
import { redis } from "#src/db/redis";
import { hallSeats } from "#src/db/schema";
import { layoutKey } from "#src/redis/keys";

export type VenueSeat = {
  id: string;
  category: string;
  accessible: boolean;
};

const seatPath = (seatId: string) =>
  `$.sections[*].seats[?(@.id == ${JSON.stringify(seatId)})]`;
const sectionSeatsPath = (sectionId: string) =>
  `$.sections[?(@.id == ${JSON.stringify(sectionId)})].seats`;

function venueError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

export async function getVenueLayout(venueId: string) {
  return redis.json.get(layoutKey(venueId));
}

export async function getAllSeats(venueId: string) {
  return redis.json.get(layoutKey(venueId), { path: "$.sections[*].seats[*]" });
}

export async function getAccessibleSeats(venueId: string) {
  return redis.json.get(layoutKey(venueId), {
    path: "$.sections[*].seats[?(@.accessible == true)]",
  });
}

export async function updateSeatCategory(venueId: string, seatId: string, category: string) {
  const key = layoutKey(venueId);
  const matches = await redis.json.get(key, { path: seatPath(seatId) });
  if (!Array.isArray(matches) || matches.length === 0) return false;
  if (matches.length > 1) throw venueError(409, "Seat ID is duplicated in the layout");

  const result = await redis.json.set(key, `${seatPath(seatId)}.category`, category, {
    condition: "XX",
  });

  return result === "OK";
}

export async function appendSeat(venueId: string, sectionId: string, seat: VenueSeat) {
  const key = layoutKey(venueId);
  const existingSeats = await redis.json.get(key, { path: seatPath(seat.id) });
  if (existingSeats === null) throw venueError(404, "Hall layout not found");
  if (!Array.isArray(existingSeats)) throw new Error("Invalid seat data in hall layout");
  if (existingSeats.length > 0) throw venueError(409, "Seat ID already exists in the layout");

  const path = sectionSeatsPath(sectionId);
  const sections = await redis.json.get(key, { path });
  if (!Array.isArray(sections) || sections.length === 0) {
    throw venueError(404, "Section not found");
  }
  if (sections.length > 1) throw venueError(409, "Section ID is duplicated in the layout");
  if (!Array.isArray(sections[0])) throw new Error("Section seats is not an array");

  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(hallSeats)
      .values({ hallId: venueId, seatId: seat.id })
      .onConflictDoNothing()
      .returning({ seatId: hallSeats.seatId });
    if (!inserted) throw venueError(409, "Seat ID already exists in the hall");

    const lengths = await redis.json.arrAppend(key, path, seat);
    if (!Array.isArray(lengths) || lengths.length === 0) {
      throw venueError(404, "Section not found");
    }
    if (lengths.length !== 1 || lengths[0] === null) {
      throw new Error("Section seats is not a single array");
    }
    return lengths;
  });
}
