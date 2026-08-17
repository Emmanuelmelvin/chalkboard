CREATE TYPE "public"."feedback_category" AS ENUM('bug_report', 'feature_request', 'general');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'acknowledged', 'resolved', 'closed');--> statement-breakpoint
CREATE TABLE "feedback_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "feedback_category" DEFAULT 'general' NOT NULL,
	"message" text NOT NULL,
	"contact_email" text,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"decided_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "room_session_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_session_feedback" ADD CONSTRAINT "room_session_feedback_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_session_feedback" ADD CONSTRAINT "room_session_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_submissions_status_idx" ON "feedback_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "feedback_submissions_user_idx" ON "feedback_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_session_feedback_room_user_idx" ON "room_session_feedback" USING btree ("room_id","user_id");--> statement-breakpoint
CREATE INDEX "room_session_feedback_room_idx" ON "room_session_feedback" USING btree ("room_id");