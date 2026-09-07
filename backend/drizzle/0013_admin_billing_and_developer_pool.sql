CREATE TYPE "public"."billing_audit_action" AS ENUM('cancel_subscription', 'refund', 'resync_subscription');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "billing_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"target_user_id" uuid,
	"action" "billing_audit_action" NOT NULL,
	"reason" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "developer_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"developer_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"usage_units" integer DEFAULT 0 NOT NULL,
	"pool_total" numeric(12, 2) NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "developer_pool_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"revenue_total" numeric(12, 2) NOT NULL,
	"pool_total" numeric(12, 2) NOT NULL,
	"pool_rate" numeric(5, 4) NOT NULL,
	"developer_count" integer DEFAULT 0 NOT NULL,
	"total_usage_units" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "developer_pool_runs_period_start_unique" UNIQUE("period_start")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bachs_refund_id" text,
	"bachs_payment_id" text NOT NULL,
	"user_id" uuid,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"reason" text,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"issued_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_bachs_refund_id_unique" UNIQUE("bachs_refund_id")
);
--> statement-breakpoint
CREATE TABLE "revenue_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bachs_invoice_id" text NOT NULL,
	"user_id" uuid,
	"bachs_subscription_id" text,
	"plan_id" "plan_id",
	"amount" numeric(12, 2) NOT NULL,
	"refunded_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"currency" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_ledger_bachs_invoice_id_unique" UNIQUE("bachs_invoice_id")
);
--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD CONSTRAINT "billing_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD CONSTRAINT "billing_audit_log_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_earnings" ADD CONSTRAINT "developer_earnings_developer_id_users_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_ledger" ADD CONSTRAINT "revenue_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_audit_actor_idx" ON "billing_audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "billing_audit_target_idx" ON "billing_audit_log" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "billing_audit_created_at_idx" ON "billing_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "developer_earnings_dev_period_idx" ON "developer_earnings" USING btree ("developer_id","period_start");--> statement-breakpoint
CREATE INDEX "developer_earnings_status_idx" ON "developer_earnings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "refunds_user_idx" ON "refunds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("bachs_payment_id");--> statement-breakpoint
CREATE INDEX "revenue_ledger_paid_at_idx" ON "revenue_ledger" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "revenue_ledger_user_idx" ON "revenue_ledger" USING btree ("user_id");