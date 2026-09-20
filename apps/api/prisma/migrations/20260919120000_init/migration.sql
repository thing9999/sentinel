-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "data_source_mode" AS ENUM ('mock', 'live');

-- CreateEnum
CREATE TYPE "cost_explorer_query_kind" AS ENUM ('month_to_date', 'service_breakdown', 'daily', 'last_month', 'forecast');

-- CreateEnum
CREATE TYPE "fetch_status" AS ENUM ('ok', 'error');

-- CreateEnum
CREATE TYPE "cost_explorer_operation" AS ENUM ('GetCostAndUsage', 'GetCostForecast');

-- CreateEnum
CREATE TYPE "cost_explorer_trigger" AS ENUM ('scheduled', 'manual', 'startup');

-- CreateEnum
CREATE TYPE "price_source" AS ENUM ('pricing_api', 'spot_price_history');

-- CreateEnum
CREATE TYPE "advisor_run_status" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "advisor_failure_reason" AS ENUM ('bridge_unavailable', 'login_required', 'usage_limit', 'timeout', 'invalid_response', 'interrupted', 'other');

-- CreateEnum
CREATE TYPE "suggestion_category" AS ENUM ('cost', 'reliability', 'performance', 'security', 'database');

-- CreateEnum
CREATE TYPE "severity" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "savings_source" AS ENUM ('server', 'llm');

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "cost_rate_samples" (
    "id" BIGSERIAL NOT NULL,
    "data_source" "data_source_mode" NOT NULL,
    "sampled_at" TIMESTAMPTZ(3) NOT NULL,
    "total_usd_per_hour" DECIMAL(14,6) NOT NULL,
    "ec2_usd_per_hour" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "ebs_usd_per_hour" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "lb_usd_per_hour" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "eks_usd_per_hour" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "ipv4_usd_per_hour" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "node_count" INTEGER NOT NULL,
    "unpriced_count" INTEGER NOT NULL DEFAULT 0,
    "resources" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_rate_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_explorer_cache" (
    "id" BIGSERIAL NOT NULL,
    "data_source" "data_source_mode" NOT NULL,
    "kind" "cost_explorer_query_kind" NOT NULL,
    "request_key" VARCHAR(64) NOT NULL,
    "request" JSONB NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "metric" VARCHAR(32) NOT NULL,
    "status" "fetch_status" NOT NULL,
    "result" JSONB,
    "data_through" DATE,
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(500),
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cost_explorer_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_explorer_call_logs" (
    "id" BIGSERIAL NOT NULL,
    "called_at" TIMESTAMPTZ(3) NOT NULL,
    "operation" "cost_explorer_operation" NOT NULL,
    "trigger" "cost_explorer_trigger" NOT NULL,
    "request_key" VARCHAR(64) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error_code" VARCHAR(100),
    "duration_ms" INTEGER NOT NULL,
    "estimated_cost_usd" DECIMAL(8,4) NOT NULL DEFAULT 0.01,

    CONSTRAINT "cost_explorer_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_cache" (
    "id" BIGSERIAL NOT NULL,
    "source" "price_source" NOT NULL,
    "region" VARCHAR(32) NOT NULL,
    "product_key" VARCHAR(200) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "usd_per_unit" DECIMAL(18,10),
    "found" BOOLEAN NOT NULL DEFAULT true,
    "attributes" JSONB,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisor_runs" (
    "id" UUID NOT NULL,
    "status" "advisor_run_status" NOT NULL DEFAULT 'queued',
    "failure_reason" "advisor_failure_reason",
    "error_message" VARCHAR(500),
    "active_lock" VARCHAR(16),
    "data_source" "data_source_mode" NOT NULL,
    "is_example" BOOLEAN NOT NULL DEFAULT false,
    "stage" VARCHAR(32),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,
    "snapshot_hash" CHAR(64) NOT NULL,
    "snapshot_summary" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshot_bytes" INTEGER NOT NULL,
    "redacted_count" INTEGER NOT NULL DEFAULT 0,
    "precheck_results" JSONB NOT NULL,
    "precheck_summary" JSONB NOT NULL,
    "suggestion_count" INTEGER NOT NULL DEFAULT 0,
    "high_count" INTEGER NOT NULL DEFAULT 0,
    "medium_count" INTEGER NOT NULL DEFAULT 0,
    "low_count" INTEGER NOT NULL DEFAULT 0,
    "dropped_count" INTEGER NOT NULL DEFAULT 0,
    "raw_response" TEXT,
    "model" VARCHAR(100),
    "usage" JSONB,

    CONSTRAINT "advisor_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisor_suggestions" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "category" "suggestion_category" NOT NULL,
    "severity" "severity" NOT NULL,
    "targets" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "precheck_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimated_monthly_savings_usd" DECIMAL(12,2),
    "savings_formula" VARCHAR(500),
    "savings_source" "savings_source",
    "steps" TEXT NOT NULL,
    "risk_level" "severity" NOT NULL,
    "risk_reason" VARCHAR(300) NOT NULL,
    "verification" TEXT,
    "unverified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "advisor_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_rate_samples_sampled_at_idx" ON "cost_rate_samples"("sampled_at");

-- CreateIndex
CREATE UNIQUE INDEX "cost_rate_samples_data_source_sampled_at_key" ON "cost_rate_samples"("data_source", "sampled_at");

-- CreateIndex
CREATE INDEX "cost_explorer_cache_data_source_kind_fetched_at_idx" ON "cost_explorer_cache"("data_source", "kind", "fetched_at" DESC);

-- CreateIndex
CREATE INDEX "cost_explorer_cache_fetched_at_idx" ON "cost_explorer_cache"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "cost_explorer_cache_data_source_request_key_key" ON "cost_explorer_cache"("data_source", "request_key");

-- CreateIndex
CREATE INDEX "cost_explorer_call_logs_called_at_idx" ON "cost_explorer_call_logs"("called_at");

-- CreateIndex
CREATE INDEX "cost_explorer_call_logs_trigger_called_at_idx" ON "cost_explorer_call_logs"("trigger", "called_at" DESC);

-- CreateIndex
CREATE INDEX "price_cache_expires_at_idx" ON "price_cache"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "price_cache_source_region_product_key_key" ON "price_cache"("source", "region", "product_key");

-- CreateIndex
CREATE UNIQUE INDEX "advisor_runs_active_lock_key" ON "advisor_runs"("active_lock");

-- CreateIndex
CREATE INDEX "advisor_runs_requested_at_idx" ON "advisor_runs"("requested_at" DESC);

-- CreateIndex
CREATE INDEX "advisor_runs_status_idx" ON "advisor_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "advisor_suggestions_run_id_priority_key" ON "advisor_suggestions"("run_id", "priority");

-- AddForeignKey
ALTER TABLE "advisor_suggestions" ADD CONSTRAINT "advisor_suggestions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "advisor_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
