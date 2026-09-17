import { index, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

// Better Auth owns its user/account tables and migrations.
export const halls = pgTable("halls", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  city: text("city").notNull(),
}, (table) => [
  unique("halls_name_city_unique").on(table.name, table.city),
]);

export const hallSeats = pgTable("hall_seats", {
  hallId: uuid("hall_id").notNull().references(() => halls.id, { onDelete: "cascade" }),
  seatId: text("seat_id").notNull(),
}, (table) => [
  primaryKey({ columns: [table.hallId, table.seatId] }),
]);

export const concerts = pgTable("concerts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  hallId: uuid("hall_id").notNull().references(() => halls.id, { onDelete: "restrict" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
});

// The user_id foreign key is added in the SQL migration because Better Auth owns the user table.
export const concertFavorites = pgTable("concert_favorites", {
  userId: text("user_id").notNull(),
  concertId: text("concert_id").notNull().references(() => concerts.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.userId, table.concertId] }),
  index("concert_favorites_concert_id_idx").on(table.concertId),
]);

// A committed favorite always has a durable job to refresh its Redis projection.
export const popularityOutbox = pgTable("popularity_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  concertId: text("concert_id").notNull().references(() => concerts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("popularity_outbox_created_at_idx").on(table.createdAt),
]);
