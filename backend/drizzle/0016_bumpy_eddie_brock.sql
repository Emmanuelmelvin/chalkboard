ALTER TABLE "seat_add_ons" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "seat_add_ons" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "seat_add_ons_expiry_idx" ON "seat_add_ons" USING btree ("cancel_at_period_end","current_period_end");