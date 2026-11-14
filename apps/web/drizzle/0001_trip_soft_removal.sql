CREATE TABLE "trip_tombstones" (
	"trip_id" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_members" ADD COLUMN "removed_at" timestamp with time zone;