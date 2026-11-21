BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "role_code" AS ENUM ('OWNER', 'ACCOUNTANT', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "locale_code" AS ENUM ('ENGLISH', 'URDU', 'PASHTO');

-- CreateEnum
CREATE TYPE "auth_challenge_purpose" AS ENUM ('PASSWORD_RESET', 'PASSWORD_CHANGE', 'TOTP_CHALLENGE', 'TOTP_ENROLLMENT');

-- CreateEnum
CREATE TYPE "bank_category" AS ENUM ('BANK', 'CASH');

-- CreateEnum
CREATE TYPE "weight_unit" AS ENUM ('TON', 'TONNE', 'MT');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING_PRICING', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "payment_direction" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CHEQUE', 'CASH', 'BANK_TRANSFER', 'ONLINE_IBFT', 'PAY_ORDER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('POSTED', 'RECEIVED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ledger_entry_kind" AS ENUM ('ORDER_SALE', 'ORDER_PURCHASE', 'CUSTOMER_RECEIPT', 'SUPPLIER_PAYMENT', 'CUSTOMER_OPENING', 'SUPPLIER_OPENING', 'CUSTOMER_ADJUSTMENT', 'SUPPLIER_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "number_sequence_kind" AS ENUM ('ORDER', 'VOUCHER', 'CUSTOMER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('USER', 'ANONYMOUS', 'SYSTEM');

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "backup_source" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "backup_state" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "roles" (
    "code" "role_code" NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(64) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "role_code" "role_code" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "locale" "locale_code" NOT NULL DEFAULT 'ENGLISH',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret_encrypted" BYTEA,
    "totp_key_id" VARCHAR(100),
    "last_totp_step" BIGINT,
    "recovery_code_digests" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_digest" VARCHAR(128) NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "purpose" "auth_challenge_purpose" NOT NULL,
    "token_digest" VARCHAR(128) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "scope" VARCHAR(80) NOT NULL,
    "identifier_digest" VARCHAR(128) NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("scope","identifier_digest","window_start")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "document_profile_id" UUID NOT NULL,
    "order_prefix" VARCHAR(16) NOT NULL DEFAULT 'ORD',
    "voucher_prefix" VARCHAR(16) NOT NULL DEFAULT 'VCH',
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(160) NOT NULL,
    "tagline" VARCHAR(250),
    "address" VARCHAR(500),
    "phone" VARCHAR(40),
    "email" VARCHAR(254),
    "logo_bytes" BYTEA,
    "logo_media_type" VARCHAR(32),
    "currency_symbol" VARCHAR(12) NOT NULL DEFAULT 'Rs.',
    "weight_unit" "weight_unit" NOT NULL DEFAULT 'TON',
    "date_format" VARCHAR(32) NOT NULL DEFAULT 'dd MMM yyyy',
    "number_format" VARCHAR(32) NOT NULL DEFAULT 'en-PK',
    "footer" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "name_key" VARCHAR(80) NOT NULL,
    "category" "bank_category" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "name_key" VARCHAR(160) NOT NULL,
    "industry" VARCHAR(120),
    "contact_person" VARCHAR(120),
    "phone" VARCHAR(40),
    "email" VARCHAR(254),
    "city" VARCHAR(120),
    "address" VARCHAR(500),
    "notes" VARCHAR(1500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "credit_limit" DECIMAL(14,2),
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "name_key" VARCHAR(160) NOT NULL,
    "contact_person" VARCHAR(120),
    "phone" VARCHAR(40),
    "email" VARCHAR(254),
    "city" VARCHAR(120),
    "region" VARCHAR(120),
    "address" VARCHAR(500),
    "notes" VARCHAR(1500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplier_id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "code_key" VARCHAR(60) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_no" VARCHAR(48) NOT NULL,
    "number_year" SMALLINT NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING_PRICING',
    "current_revision_no" INTEGER,
    "business_date" DATE NOT NULL,
    "customer_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "mine_id" UUID NOT NULL,
    "vehicle_no" VARCHAR(40) NOT NULL,
    "bilty_no" VARCHAR(80),
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "deleted_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "delete_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "business_date" DATE NOT NULL,
    "customer_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "mine_id" UUID NOT NULL,
    "vehicle_no" VARCHAR(40) NOT NULL,
    "bilty_no" VARCHAR(80),
    "notes" VARCHAR(1500),
    "weight" DECIMAL(12,3) NOT NULL,
    "purchase_rate" DECIMAL(12,2),
    "sell_rate" DECIMAL(12,2),
    "buy_amount" DECIMAL(14,2),
    "sell_amount" DECIMAL(14,2),
    "profit" DECIMAL(14,2),
    "document_profile_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "voucher_no" VARCHAR(48) NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "business_date" DATE NOT NULL,
    "customer_id" UUID,
    "supplier_id" UUID,
    "direction" "payment_direction" NOT NULL,
    "method" "payment_method" NOT NULL,
    "bank_id" UUID,
    "bank_name" VARCHAR(80),
    "reference_no" VARCHAR(100),
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" VARCHAR(1500),
    "document_profile_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "status" "payment_status" NOT NULL,
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheque_events" (
    "id" BIGSERIAL NOT NULL,
    "payment_id" UUID NOT NULL,
    "previous" "payment_status" NOT NULL,
    "resulting" "payment_status" NOT NULL,
    "business_date" DATE NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cheque_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "kind" "ledger_entry_kind" NOT NULL,
    "business_date" DATE NOT NULL,
    "customer_id" UUID,
    "supplier_id" UUID,
    "order_revision_id" UUID,
    "payment_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "reverses_id" BIGINT,
    "actor_id" UUID NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "kind" "number_sequence_kind" NOT NULL,
    "scope" INTEGER NOT NULL,
    "next_ordinal" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("kind","scope")
);

-- CreateTable
CREATE TABLE "period_locks" (
    "month" DATE NOT NULL,
    "is_month_locked" BOOLEAN NOT NULL DEFAULT false,
    "is_year_locked" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_locks_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "actor_id" UUID NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "request_digest" VARCHAR(128) NOT NULL,
    "response" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("actor_id","operation","key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "actor_type" "audit_actor_type" NOT NULL,
    "area" VARCHAR(80) NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(160),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" VARCHAR(128) NOT NULL,
    "ip_address" INET,
    "outcome" "audit_outcome" NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" "backup_source" NOT NULL,
    "actor_id" UUID,
    "state" "backup_state" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "byte_count" BIGINT,
    "archive_hash" VARCHAR(128),
    "archive_id" VARCHAR(120),
    "failure_code" VARCHAR(80),

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_code_is_active_idx" ON "users"("role_code", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_digest_key" ON "sessions"("token_digest");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_challenges_token_digest_key" ON "auth_challenges"("token_digest");

-- CreateIndex
CREATE INDEX "auth_challenges_user_id_purpose_expires_at_idx" ON "auth_challenges"("user_id", "purpose", "expires_at");

-- CreateIndex
CREATE INDEX "auth_challenges_expires_at_idx" ON "auth_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "banks_name_key_key" ON "banks"("name_key");

-- CreateIndex
CREATE INDEX "banks_is_active_name_key_id_idx" ON "banks"("is_active", "name_key", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_is_active_name_key_id_idx" ON "customers"("is_active", "name_key", "id");

-- CreateIndex
CREATE INDEX "customers_name_key_id_idx" ON "customers"("name_key", "id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE INDEX "suppliers_is_active_name_key_id_idx" ON "suppliers"("is_active", "name_key", "id");

-- CreateIndex
CREATE INDEX "suppliers_name_key_id_idx" ON "suppliers"("name_key", "id");

-- CreateIndex
CREATE INDEX "mines_supplier_id_is_active_code_key_idx" ON "mines"("supplier_id", "is_active", "code_key");

-- CreateIndex
CREATE UNIQUE INDEX "mines_supplier_id_id_key" ON "mines"("supplier_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mines_supplier_id_code_key_key" ON "mines"("supplier_id", "code_key");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");

-- CreateIndex
CREATE INDEX "orders_status_business_date_id_idx" ON "orders"("status", "business_date", "id");

-- CreateIndex
CREATE INDEX "orders_business_date_id_idx" ON "orders"("business_date", "id");

-- CreateIndex
CREATE INDEX "orders_customer_id_business_date_id_idx" ON "orders"("customer_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "orders_supplier_id_business_date_id_idx" ON "orders"("supplier_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "orders_mine_id_business_date_id_idx" ON "orders"("mine_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "orders_vehicle_no_business_date_idx" ON "orders"("vehicle_no", "business_date");

-- CreateIndex
CREATE INDEX "orders_created_by_id_business_date_id_idx" ON "orders"("created_by_id", "business_date", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_year_ordinal_key" ON "orders"("number_year", "ordinal");

-- CreateIndex
CREATE INDEX "order_revisions_business_date_id_idx" ON "order_revisions"("business_date", "id");

-- CreateIndex
CREATE INDEX "order_revisions_customer_id_business_date_id_idx" ON "order_revisions"("customer_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "order_revisions_supplier_id_business_date_id_idx" ON "order_revisions"("supplier_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "order_revisions_mine_id_business_date_id_idx" ON "order_revisions"("mine_id", "business_date", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_revisions_order_id_revision_no_key" ON "order_revisions"("order_id", "revision_no");

-- CreateIndex
CREATE UNIQUE INDEX "payments_voucher_no_key" ON "payments"("voucher_no");

-- CreateIndex
CREATE UNIQUE INDEX "payments_ordinal_key" ON "payments"("ordinal");

-- CreateIndex
CREATE INDEX "payments_direction_business_date_id_idx" ON "payments"("direction", "business_date", "id");

-- CreateIndex
CREATE INDEX "payments_customer_id_business_date_id_idx" ON "payments"("customer_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "payments_supplier_id_business_date_id_idx" ON "payments"("supplier_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "payments_status_business_date_id_idx" ON "payments"("status", "business_date", "id");

-- CreateIndex
CREATE INDEX "payments_business_date_id_idx" ON "payments"("business_date", "id");

-- CreateIndex
CREATE INDEX "cheque_events_payment_id_id_idx" ON "cheque_events"("payment_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reverses_id_key" ON "ledger_entries"("reverses_id");

-- CreateIndex
CREATE INDEX "ledger_entries_customer_id_business_date_id_idx" ON "ledger_entries"("customer_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "ledger_entries_supplier_id_business_date_id_idx" ON "ledger_entries"("supplier_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "ledger_entries_business_date_kind_id_idx" ON "ledger_entries"("business_date", "kind", "id");

-- CreateIndex
CREATE INDEX "ledger_entries_order_revision_id_idx" ON "ledger_entries"("order_revision_id");

-- CreateIndex
CREATE INDEX "ledger_entries_payment_id_idx" ON "ledger_entries"("payment_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_id_idx" ON "audit_logs"("occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_occurred_at_id_idx" ON "audit_logs"("actor_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_logs_action_occurred_at_id_idx" ON "audit_logs"("action", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_occurred_at_id_idx" ON "audit_logs"("target_type", "target_id", "occurred_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "backups_archive_id_key" ON "backups"("archive_id");

-- CreateIndex
CREATE INDEX "backups_state_completed_at_id_idx" ON "backups"("state", "completed_at", "id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_document_profile_id_fkey" FOREIGN KEY ("document_profile_id") REFERENCES "document_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mines" ADD CONSTRAINT "mines_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_supplier_id_mine_id_fkey" FOREIGN KEY ("supplier_id", "mine_id") REFERENCES "mines"("supplier_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_id_current_revision_no_fkey" FOREIGN KEY ("id", "current_revision_no") REFERENCES "order_revisions"("order_id", "revision_no") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_supplier_id_mine_id_fkey" FOREIGN KEY ("supplier_id", "mine_id") REFERENCES "mines"("supplier_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_document_profile_id_fkey" FOREIGN KEY ("document_profile_id") REFERENCES "document_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_document_profile_id_fkey" FOREIGN KEY ("document_profile_id") REFERENCES "document_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_revision_id_fkey" FOREIGN KEY ("order_revision_id") REFERENCES "order_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backups" ADD CONSTRAINT "backups_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Application roles are lookup data. Staff credentials are provisioned separately.
INSERT INTO roles (code) VALUES ('OWNER'), ('ACCOUNTANT'), ('OPERATOR'), ('VIEWER');

ALTER TABLE users ADD CONSTRAINT users_normalized_identity_check CHECK (
    username <> '' AND username = lower(btrim(username))
    AND email <> '' AND email = lower(btrim(email))
    AND btrim(display_name) <> ''
);
ALTER TABLE user_credentials ADD CONSTRAINT user_credentials_totp_shape_check CHECK (
    (totp_secret_encrypted IS NULL) = (totp_key_id IS NULL)
    AND (last_totp_step IS NULL OR (totp_key_id IS NOT NULL AND last_totp_step >= 0))
);
ALTER TABLE sessions ADD CONSTRAINT sessions_lifetime_check CHECK (
    expires_at > issued_at AND last_used_at >= issued_at
    AND (revoked_at IS NULL OR revoked_at >= issued_at)
);
ALTER TABLE auth_challenges ADD CONSTRAINT auth_challenges_lifetime_check CHECK (
    attempts >= 0 AND expires_at > created_at
    AND (consumed_at IS NULL OR consumed_at >= created_at)
);
ALTER TABLE rate_limit_buckets ADD CONSTRAINT rate_limit_buckets_window_check CHECK (
    attempt_count >= 0 AND expires_at > window_start
);
ALTER TABLE company_settings ADD CONSTRAINT company_settings_singleton_check CHECK (
    id = 1 AND order_prefix ~ '^[A-Z0-9]{1,16}$' AND voucher_prefix ~ '^[A-Z0-9]{1,16}$'
);
ALTER TABLE document_profiles ADD CONSTRAINT document_profiles_logo_shape_check CHECK (
    (logo_bytes IS NULL AND logo_media_type IS NULL)
    OR (logo_bytes IS NOT NULL AND logo_media_type IS NOT NULL
        AND logo_media_type IN ('image/png', 'image/jpeg', 'image/webp')
        AND octet_length(logo_bytes) BETWEEN 1 AND 2097152)
);
ALTER TABLE customers ADD CONSTRAINT customers_credit_limit_check CHECK (
    credit_limit IS NULL OR (credit_limit <> 'NaN'::numeric AND credit_limit >= 0)
);
ALTER TABLE mines ADD CONSTRAINT mines_default_is_active_check CHECK (is_active OR NOT is_default);
CREATE UNIQUE INDEX mines_one_default_per_supplier ON mines (supplier_id) WHERE is_default;

ALTER TABLE orders ADD CONSTRAINT orders_identity_and_date_check CHECK (
    number_year BETWEEN 1 AND 9999 AND ordinal > 0 AND isfinite(business_date)
    AND btrim(vehicle_no) <> '' AND (bilty_no IS NULL OR btrim(bilty_no) <> '')
);
ALTER TABLE orders ADD CONSTRAINT orders_void_shape_check CHECK (
    (status = 'VOIDED' AND deleted_by_id IS NOT NULL AND deleted_at IS NOT NULL
        AND delete_reason IS NOT NULL AND btrim(delete_reason) <> '')
    OR (status <> 'VOIDED' AND deleted_by_id IS NULL AND deleted_at IS NULL AND delete_reason IS NULL)
);
CREATE UNIQUE INDEX orders_active_bilty_key
    ON orders (supplier_id, business_date, bilty_no) WHERE bilty_no IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE order_revisions ADD CONSTRAINT order_revisions_input_check CHECK (
    revision_no > 0 AND isfinite(business_date) AND weight <> 'NaN'::numeric AND weight > 0
    AND btrim(vehicle_no) <> '' AND (bilty_no IS NULL OR btrim(bilty_no) <> '')
    AND (sell_rate IS NULL OR (sell_rate <> 'NaN'::numeric AND sell_rate >= 0))
);
ALTER TABLE order_revisions ADD CONSTRAINT order_revisions_snapshots_check CHECK (
    (purchase_rate IS NULL AND buy_amount IS NULL AND sell_amount IS NULL AND profit IS NULL)
    OR (purchase_rate IS NOT NULL AND purchase_rate <> 'NaN'::numeric AND purchase_rate >= 0
        AND sell_rate IS NOT NULL AND buy_amount IS NOT NULL AND sell_amount IS NOT NULL AND profit IS NOT NULL
        AND buy_amount = round(weight * purchase_rate, 2) AND sell_amount = round(weight * sell_rate, 2)
        AND profit = sell_amount - buy_amount)
);

ALTER TABLE payments ADD CONSTRAINT payments_party_and_amount_check CHECK (
    ordinal > 0 AND isfinite(business_date) AND amount <> 'NaN'::numeric AND amount > 0
    AND ((direction = 'IN' AND customer_id IS NOT NULL AND supplier_id IS NULL)
        OR (direction = 'OUT' AND supplier_id IS NOT NULL AND customer_id IS NULL))
);
ALTER TABLE payments ADD CONSTRAINT payments_method_and_status_check CHECK (
    ((bank_id IS NULL AND bank_name IS NULL) OR (bank_id IS NOT NULL AND bank_name IS NOT NULL AND btrim(bank_name) <> ''))
    AND ((method = 'CHEQUE' AND status IN ('RECEIVED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'VOIDED'))
        OR (method <> 'CHEQUE' AND status IN ('POSTED', 'VOIDED')))
    AND ((status = 'VOIDED' AND voided_by_id IS NOT NULL AND voided_at IS NOT NULL
            AND void_reason IS NOT NULL AND btrim(void_reason) <> '')
        OR (status <> 'VOIDED' AND voided_by_id IS NULL AND voided_at IS NULL AND void_reason IS NULL))
);
ALTER TABLE cheque_events ADD CONSTRAINT cheque_events_transition_check CHECK (
    isfinite(business_date)
    AND ((previous = 'RECEIVED' AND resulting = 'DEPOSITED')
        OR (previous = 'DEPOSITED' AND resulting IN ('CLEARED', 'BOUNCED')))
    AND (resulting <> 'BOUNCED' OR (reason IS NOT NULL AND btrim(reason) <> ''))
);

ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_party_and_source_check CHECK (
    isfinite(business_date) AND amount <> 'NaN'::numeric
    AND CASE kind
        WHEN 'ORDER_SALE' THEN customer_id IS NOT NULL AND supplier_id IS NULL AND order_revision_id IS NOT NULL AND payment_id IS NULL
        WHEN 'ORDER_PURCHASE' THEN supplier_id IS NOT NULL AND customer_id IS NULL AND order_revision_id IS NOT NULL AND payment_id IS NULL
        WHEN 'CUSTOMER_RECEIPT' THEN customer_id IS NOT NULL AND supplier_id IS NULL AND order_revision_id IS NULL AND payment_id IS NOT NULL
        WHEN 'SUPPLIER_PAYMENT' THEN supplier_id IS NOT NULL AND customer_id IS NULL AND order_revision_id IS NULL AND payment_id IS NOT NULL
        WHEN 'CUSTOMER_OPENING' THEN customer_id IS NOT NULL AND supplier_id IS NULL AND order_revision_id IS NULL AND payment_id IS NULL
        WHEN 'SUPPLIER_OPENING' THEN supplier_id IS NOT NULL AND customer_id IS NULL AND order_revision_id IS NULL AND payment_id IS NULL
        WHEN 'CUSTOMER_ADJUSTMENT' THEN customer_id IS NOT NULL AND supplier_id IS NULL AND order_revision_id IS NULL AND payment_id IS NULL
        WHEN 'SUPPLIER_ADJUSTMENT' THEN supplier_id IS NOT NULL AND customer_id IS NULL AND order_revision_id IS NULL AND payment_id IS NULL
    END
);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_sign_check CHECK (
    CASE
        WHEN reverses_id IS NOT NULL THEN reason IS NOT NULL AND btrim(reason) <> ''
        WHEN kind IN ('ORDER_SALE', 'ORDER_PURCHASE') THEN amount >= 0
        WHEN kind IN ('CUSTOMER_RECEIPT', 'SUPPLIER_PAYMENT') THEN amount < 0
        WHEN kind IN ('CUSTOMER_ADJUSTMENT', 'SUPPLIER_ADJUSTMENT') THEN amount <> 0 AND reason IS NOT NULL AND btrim(reason) <> ''
        ELSE amount <> 0
    END
);
CREATE UNIQUE INDEX ledger_one_original_per_order_revision_side
    ON ledger_entries (kind, order_revision_id) WHERE order_revision_id IS NOT NULL AND reverses_id IS NULL;
CREATE UNIQUE INDEX ledger_one_original_per_payment
    ON ledger_entries (payment_id) WHERE payment_id IS NOT NULL AND reverses_id IS NULL;
CREATE UNIQUE INDEX ledger_one_customer_opening
    ON ledger_entries (customer_id) WHERE kind = 'CUSTOMER_OPENING' AND reverses_id IS NULL;
CREATE UNIQUE INDEX ledger_one_supplier_opening
    ON ledger_entries (supplier_id) WHERE kind = 'SUPPLIER_OPENING' AND reverses_id IS NULL;

ALTER TABLE number_sequences ADD CONSTRAINT number_sequences_scope_check CHECK (
    next_ordinal > 0 AND ((kind = 'ORDER' AND scope BETWEEN 1 AND 9999) OR (kind <> 'ORDER' AND scope = 0))
);
ALTER TABLE period_locks ADD CONSTRAINT period_locks_month_boundary_check CHECK (
    isfinite(month) AND extract(day FROM month) = 1
    AND (updated_by_id IS NOT NULL OR NOT (is_month_locked OR is_year_locked))
);
ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_expiry_check CHECK (expires_at > created_at);
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_check CHECK ((actor_type = 'USER') = (actor_id IS NOT NULL));
ALTER TABLE backups ADD CONSTRAINT backups_job_shape_check CHECK (
    ((source = 'MANUAL') = (actor_id IS NOT NULL))
    AND (completed_at IS NULL OR completed_at >= started_at)
    AND CASE state
        WHEN 'RUNNING' THEN completed_at IS NULL AND byte_count IS NULL AND archive_hash IS NULL AND archive_id IS NULL AND failure_code IS NULL
        WHEN 'SUCCEEDED' THEN completed_at IS NOT NULL AND byte_count IS NOT NULL AND byte_count > 0 AND archive_hash IS NOT NULL AND archive_id IS NOT NULL AND failure_code IS NULL
        WHEN 'FAILED' THEN completed_at IS NOT NULL AND failure_code IS NOT NULL
    END
);

CREATE FUNCTION reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON ledger_entries
    FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER order_revisions_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON order_revisions
    FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER cheque_events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON cheque_events
    FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER document_profiles_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON document_profiles
    FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER orders_soft_delete_only BEFORE DELETE OR TRUNCATE ON orders
    FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER payments_soft_delete_only BEFORE DELETE OR TRUNCATE ON payments
    FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();

CREATE FUNCTION preserve_issued_order_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    IF ROW(NEW.id, NEW.order_no, NEW.number_year, NEW.ordinal, NEW.created_by_id, NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.order_no, OLD.number_year, OLD.ordinal, OLD.created_by_id, OLD.created_at)
        OR OLD.status = 'VOIDED' THEN
        RAISE EXCEPTION 'issued order identity or voided order cannot change' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER orders_keep_issued_identity BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION preserve_issued_order_identity();

CREATE FUNCTION preserve_issued_payment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    IF ROW(NEW.id, NEW.voucher_no, NEW.ordinal, NEW.business_date, NEW.customer_id, NEW.supplier_id,
           NEW.direction, NEW.method, NEW.bank_id, NEW.bank_name, NEW.reference_no, NEW.amount,
           NEW.notes, NEW.document_profile_id, NEW.created_by_id, NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.voucher_no, OLD.ordinal, OLD.business_date, OLD.customer_id, OLD.supplier_id,
           OLD.direction, OLD.method, OLD.bank_id, OLD.bank_name, OLD.reference_no, OLD.amount,
           OLD.notes, OLD.document_profile_id, OLD.created_by_id, OLD.created_at)
        OR OLD.status IN ('VOIDED', 'BOUNCED') THEN
        RAISE EXCEPTION 'issued payment fields or reversed payment cannot change' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER payments_keep_issued_values BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION preserve_issued_payment();

CREATE FUNCTION validate_order_projection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
    current_order orders%ROWTYPE;
    current_revision order_revisions%ROWTYPE;
BEGIN
    SELECT * INTO STRICT current_order FROM orders WHERE id = NEW.id;
    SELECT * INTO current_revision FROM order_revisions
    WHERE order_id = current_order.id AND revision_no = current_order.current_revision_no;

    IF NOT FOUND
        OR ROW(current_order.business_date, current_order.customer_id, current_order.supplier_id, current_order.mine_id,
               current_order.vehicle_no, current_order.bilty_no)
            IS DISTINCT FROM ROW(current_revision.business_date, current_revision.customer_id, current_revision.supplier_id,
               current_revision.mine_id, current_revision.vehicle_no, current_revision.bilty_no)
        OR (current_order.status = 'POSTED' AND current_revision.purchase_rate IS NULL)
        OR (current_order.status = 'PENDING_PRICING' AND current_revision.purchase_rate IS NOT NULL) THEN
        RAISE EXCEPTION 'order projection must match its current revision and pricing state' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER orders_require_current_revision AFTER INSERT OR UPDATE ON orders
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_order_projection();

CREATE FUNCTION validate_ledger_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
    original ledger_entries%ROWTYPE;
    revision order_revisions%ROWTYPE;
    voucher payments%ROWTYPE;
BEGIN
    IF NEW.reverses_id IS NOT NULL THEN
        SELECT * INTO original FROM ledger_entries WHERE id = NEW.reverses_id;
        IF NOT FOUND OR original.reverses_id IS NOT NULL OR NEW.amount <> -original.amount
            OR ROW(NEW.kind, NEW.customer_id, NEW.supplier_id, NEW.order_revision_id, NEW.payment_id)
                IS DISTINCT FROM ROW(original.kind, original.customer_id, original.supplier_id, original.order_revision_id, original.payment_id) THEN
            RAISE EXCEPTION 'reversal must negate the original posting and retain its source and party' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.order_revision_id IS NOT NULL THEN
        SELECT * INTO revision FROM order_revisions WHERE id = NEW.order_revision_id;
        IF NOT FOUND OR NEW.business_date <> revision.business_date OR revision.purchase_rate IS NULL
            OR (NEW.kind = 'ORDER_SALE' AND (NEW.customer_id <> revision.customer_id OR NEW.amount <> revision.sell_amount))
            OR (NEW.kind = 'ORDER_PURCHASE' AND (NEW.supplier_id <> revision.supplier_id OR NEW.amount <> revision.buy_amount)) THEN
            RAISE EXCEPTION 'order posting must match an immutable priced revision' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.payment_id IS NOT NULL THEN
        SELECT * INTO voucher FROM payments WHERE id = NEW.payment_id;
        IF NOT FOUND OR NEW.business_date <> voucher.business_date OR NEW.amount <> -voucher.amount
            OR ROW(NEW.customer_id, NEW.supplier_id) IS DISTINCT FROM ROW(voucher.customer_id, voucher.supplier_id) THEN
            RAISE EXCEPTION 'payment posting must match the issued voucher' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_entries_validate_source BEFORE INSERT ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION validate_ledger_source();

COMMIT;
