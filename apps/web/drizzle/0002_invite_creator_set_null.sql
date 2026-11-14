ALTER TABLE "trip_invites" DROP CONSTRAINT "trip_invites_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "trip_invites" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_invites" ADD CONSTRAINT "trip_invites_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;