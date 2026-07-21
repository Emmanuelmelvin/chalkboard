CREATE TYPE "public"."platform_role" AS ENUM('user', 'admin', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."plugin_status" AS ENUM('draft', 'in_review', 'approved', 'published', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."plugin_plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "public"."plugin_version_status" AS ENUM('draft', 'in_review', 'approved', 'published', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."plugin_review_decision" AS ENUM('approved', 'rejected', 'suspended');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_role" "platform_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"author_id" uuid NOT NULL,
	"status" "plugin_status" DEFAULT 'draft' NOT NULL,
	"plan" "plugin_plan" DEFAULT 'free' NOT NULL,
	"current_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugins_plugin_id_unique" UNIQUE("plugin_id")
);--> statement-breakpoint
CREATE TABLE "plugin_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"changelog" text,
	"entry_url" text,
	"status" "plugin_version_status" DEFAULT 'draft' NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "plugin_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "plugin_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" "plugin_review_decision" NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "admin_two_factor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_two_factor_user_id_unique" UNIQUE("user_id")
);--> statement-breakpoint
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_versions" ADD CONSTRAINT "plugin_versions_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_versions" ADD CONSTRAINT "plugin_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_installations" ADD CONSTRAINT "plugin_installations_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_installations" ADD CONSTRAINT "plugin_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_reviews" ADD CONSTRAINT "plugin_reviews_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_reviews" ADD CONSTRAINT "plugin_reviews_version_id_plugin_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plugin_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_reviews" ADD CONSTRAINT "plugin_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_two_factor" ADD CONSTRAINT "admin_two_factor_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plugins_author_idx" ON "plugins" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "plugins_status_idx" ON "plugins" USING btree ("status");--> statement-breakpoint
CREATE INDEX "plugin_versions_plugin_idx" ON "plugin_versions" USING btree ("plugin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_versions_plugin_version_idx" ON "plugin_versions" USING btree ("plugin_id","version");--> statement-breakpoint
CREATE INDEX "plugin_installations_user_idx" ON "plugin_installations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_installations_user_plugin_idx" ON "plugin_installations" USING btree ("user_id","plugin_id");--> statement-breakpoint
CREATE INDEX "plugin_reviews_plugin_idx" ON "plugin_reviews" USING btree ("plugin_id");
