import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Better Auth owns its user/account tables and migrations.
export const concerts = pgTable("concerts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  venue: text("venue").notNull(),
  city: text("city").notNull(),
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
