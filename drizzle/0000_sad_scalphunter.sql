CREATE TABLE "concerts" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"venue" text NOT NULL,
	"city" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL
);
