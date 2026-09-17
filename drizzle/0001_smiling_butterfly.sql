CREATE TABLE "concert_favorites" (
	"user_id" text NOT NULL,
	"concert_id" text NOT NULL,
	CONSTRAINT "concert_favorites_user_id_concert_id_pk" PRIMARY KEY("user_id","concert_id")
);
--> statement-breakpoint
ALTER TABLE "concert_favorites" ADD CONSTRAINT "concert_favorites_concert_id_concerts_id_fk" FOREIGN KEY ("concert_id") REFERENCES "public"."concerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concert_favorites" ADD CONSTRAINT "concert_favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concert_favorites_concert_id_idx" ON "concert_favorites" USING btree ("concert_id");
