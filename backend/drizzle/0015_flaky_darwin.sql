CREATE TABLE "seat_add_ons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bachs_subscription_id" text NOT NULL,
	"bachs_product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"status" "subscription_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seat_add_ons_bachs_subscription_id_unique" UNIQUE("bachs_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "seat_add_ons" ADD CONSTRAINT "seat_add_ons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seat_add_ons_user_idx" ON "seat_add_ons" USING btree ("user_id");