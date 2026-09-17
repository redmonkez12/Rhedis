CREATE TABLE "halls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	CONSTRAINT "halls_name_city_unique" UNIQUE("name","city")
);
--> statement-breakpoint
CREATE TABLE "hall_seats" (
	"hall_id" uuid NOT NULL,
	"seat_id" text NOT NULL,
	CONSTRAINT "hall_seats_hall_id_seat_id_pk" PRIMARY KEY("hall_id","seat_id")
);
--> statement-breakpoint
ALTER TABLE "concerts" ADD COLUMN "hall_id" uuid;--> statement-breakpoint
INSERT INTO "halls" ("name", "city")
SELECT DISTINCT "venue", "city" FROM "concerts"
ON CONFLICT ("name", "city") DO NOTHING;--> statement-breakpoint
UPDATE "concerts" AS concert
SET "hall_id" = hall."id"
FROM "halls" AS hall
WHERE concert."venue" = hall."name" AND concert."city" = hall."city";--> statement-breakpoint
ALTER TABLE "concerts" ALTER COLUMN "hall_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "hall_seats" ADD CONSTRAINT "hall_seats_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concerts" ADD CONSTRAINT "concerts_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concerts" DROP COLUMN "venue";--> statement-breakpoint
ALTER TABLE "concerts" DROP COLUMN "city";
